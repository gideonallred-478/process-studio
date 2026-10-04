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
let analyzing = false, transcribing = false;
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

async function transcribeWindowsWav(wav) {
  if (process.platform !== 'win32') throw new Error('Local speech transcription is available on Windows only.');
  const temporary = path.join(os.tmpdir(), `process-studio-${randomUUID()}.wav`);
  await fs.writeFile(temporary, wav, { flag: 'wx' });
  try {
    const output = await new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'local-transcribe.ps1'), temporary], { windowsHide: true });
      let stdout = ''; let stderr = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('Local transcription timed out.')); }, 120_000);
      child.stdout.on('data', chunk => { stdout += chunk.toString(); if (stdout.length > 1_000_000) child.kill(); });
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `Local speech engine exited with code ${code}.`)); });
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(req.headers.host)) return send(res, 403, { error: 'This app accepts local requests only.' });
    if (req.method === 'POST' && req.headers.origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(req.headers.origin)) return send(res, 403, { error: 'Request origin is not this local app.' });
    if (url.pathname === '/api/status' && req.method === 'GET') { const info = await runtime.status(); return send(res, 200, { ...info, localSpeech: info.localSpeech || await localSpeechReady, speechEngine: info.speechEngine || (await localSpeechReady ? 'Windows local speech' : null) }); }
    if (url.pathname === '/api/transcribe-local' && req.method === 'POST') {
      if (!runtime.speechReady && !await localSpeechReady) return send(res, 503, { error: 'Local transcription is unavailable. Run setup-local.ps1.' });
      if (transcribing) return send(res, 409, { error: 'A local transcription is already running.' });
      if (!['audio/wav', 'audio/x-wav'].includes(String(req.headers['content-type'] || '').split(';')[0])) return send(res, 415, { error: 'Local transcription requires a WAV audio track.' });
      const wav = await readBody(req, 25 * 1024 * 1024);
      if (!wav.length) return send(res, 400, { error: 'The audio track is empty.' });
      transcribing = true;
      try { return send(res, 200, runtime.speechReady ? await runtime.transcribe(wav) : { ...await transcribeWindowsWav(wav), source: 'Windows local speech' }); }
      finally { transcribing = false; }
    }
    if (url.pathname === '/api/transcribe' && req.method === 'POST') {
      return send(res, 410, { error: 'Cloud transcription has been removed. Use the local WAV transcription route.' });
    }
    if (url.pathname === '/api/analyze' && req.method === 'POST') {
      const data = JSON.parse((await readBody(req, 250_000)).toString('utf8'));
      const transcript = String(data.transcript || '').trim();
      if (transcript.length < 20) return send(res, 400, { error: 'Add at least a short spoken walkthrough before generating.' });
      if (analyzing) return send(res, 409, { error: 'A local analysis is already running.' });
      if (transcript.length > 12000) return send(res, 400, { error: 'Split this walkthrough into sections under 12,000 characters.' });
      if (!await runtime.status().then(status => status.ai)) return send(res, 503, { error: 'The local model is not ready. The app can show a basic draft while it starts.' });
      analyzing = true;
      try { return send(res, 200, { ...await analyzeLocally(transcript, { endpoint: runtime.endpoint, apiKey: runtime.apiKey }), modelSha256: runtime.modelSha256 }); }
      finally { analyzing = false; }
    }
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
