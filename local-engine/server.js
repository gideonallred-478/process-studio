import {createEngineOperations} from './engine-operations.js';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzeLocally } from './local-analysis.js';
import { createLocalRuntime } from './local-runtime.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(root, 'public');
const port = Number(process.env.PORT || 4173);
const runtime = await createLocalRuntime(root);

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.wav': 'audio/wav' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data: blob:; font-src 'self'; object-src 'none'; frame-ancestors 'none'" });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readBody(req, max = 32 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) { const error = new Error('Recording is too large for transcription (25 MB limit).'); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function transcribeWindowsWav(wav,{signal}={}) {
  signal?.throwIfAborted();
  if (process.platform !== 'win32') throw new Error('Local speech transcription is available on Windows only.');
  const temporary = path.join(os.tmpdir(), `process-studio-${randomUUID()}.wav`);
  await fs.writeFile(temporary, wav, { flag: 'wx' });
  try {
    const output = await new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'local-transcribe.ps1'), temporary], { windowsHide: true });
      let stdout = ''; let stderr = '';
      let timedOut=false;const abort=()=>child.kill();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();const timer=setTimeout(()=>{timedOut=true;child.kill()},120000);
      child.stdout.on('data', chunk => { stdout += chunk.toString(); if (stdout.length > 1_000_000) child.kill(); });
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
      child.on('error', error => { clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(error); });
      child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);signal?.aborted?reject(signal.reason):timedOut?reject(Error('Local transcription timed out.')):code===0?resolve(stdout):reject(Error(stderr.trim()||'Local speech engine exited.'))});
    });
    const result = JSON.parse(output);
    if (!result.transcript?.trim()) throw new Error('The local speech engine found no words in this recording.');
    return result;
  } finally { await fs.unlink(temporary).catch(() => {}); }
}

const localSpeechReady = process.platform === 'win32' ? new Promise(resolve => {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'local-transcribe.ps1'), '-Probe'], { windowsHide: true });
  let finished = false;
  const done = value => { if (!finished) { finished = true; resolve(value); } };
  const timer = setTimeout(() => { child.kill(); done(false); }, 8000);
  child.on('error', () => { clearTimeout(timer); done(false); });
  child.on('close', code => { clearTimeout(timer); done(code === 0); });
}) : Promise.resolve(false);

const engineOperations=createEngineOperations({runtime,readBody,send,analyze:analyzeLocally,windowsSpeechReady:localSpeechReady,transcribeWindowsWav});
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(req.headers.host)) return send(res, 403, { error: 'This app accepts local requests only.' });
    if (req.method === 'POST' && req.headers.origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(req.headers.origin)) return send(res, 403, { error: 'Request origin is not this local app.' });
    if (url.pathname === '/api/status' && req.method === 'GET') { const info = await runtime.status(); return send(res, 200, { ...info, localSpeech: info.localSpeech || await localSpeechReady, speechEngine: info.speechEngine || (await localSpeechReady ? 'Windows local speech' : null) }); }
    if(await engineOperations(req,res))return;
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed.' });
    if (['/shared.js', '/decision-policy.js', '/local-analysis.js'].includes(url.pathname)) {
      const bytes = await fs.readFile(path.join(root, url.pathname.slice(1)));
      return send(res, 200, bytes, mime['.js']);
    }
    const target = path.resolve(pub, `.${url.pathname === '/' ? '/index.html' : url.pathname}`);
    if (!target.startsWith(pub + path.sep)) return send(res, 404, { error: 'Not found.' });
    const bytes = await fs.readFile(target).catch(() => null);
    if (!bytes) return send(res, 404, { error: 'Not found.' });
    return send(res, 200, bytes, mime[path.extname(target)] || 'application/octet-stream');
  } catch (error) {
    return send(res, error.status || 500, { error: error.message || 'Unexpected server error.' });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Process Studio at http://localhost:${port} — local processing only`));
const stop = () => { runtime.stop(); server.close(); };
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });
