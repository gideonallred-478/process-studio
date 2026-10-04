import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { assertLoopbackEndpoint } from './local-analysis.js';

export async function findExecutable(directory, name) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const file = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === name) return file;
    if (entry.isDirectory()) { const found = await findExecutable(file, name); if (found) return found; }
  }
  return null;
}
export async function createLocalRuntime(root) {
  const endpoint = assertLoopbackEndpoint(process.env.LOCAL_LLM_URL || 'http://127.0.0.1:4174').origin;
  const apiKey = process.env.LOCAL_LLM_KEY || randomUUID();
  const model = path.join(root, 'models', 'Qwen3-8B-Q4_K_M.gguf');
  const manifest = await fs.readFile(path.join(root, 'runtime', 'manifest.json'), 'utf8').then(content => JSON.parse(content.replace(/^\uFEFF/, ''))).catch(() => null);
  const modelSha256 = manifest?.artifacts?.find(item => item.name === path.basename(model))?.sha256 || null;
  const llama = await findExecutable(path.join(root, 'runtime', 'llama'), 'llama-server.exe');
  const whisper = await findExecutable(path.join(root, 'runtime', 'whisper'), 'whisper-cli.exe');
  const speechModel = path.join(root, 'models', 'ggml-small.en.bin');
  const present = async file => Boolean(file && await fs.stat(file).then(stat => stat.size > 0).catch(() => false));
  const speechReady = await present(whisper) && await present(speechModel);
  let child = null, starting = false, error = null;
  const health = async () => {
    try { const res = await fetch(`${endpoint}/v1/models`, { headers: { Authorization: `Bearer ${apiKey}` }, redirect: 'error', signal: AbortSignal.timeout(1000) }); return res.ok && (await res.json()).data?.some(model => model.id === 'process-local'); } catch { return false; }
  };
  if (!await health() && !process.env.LOCAL_LLM_URL && await present(llama) && await present(model)) {
    const log = await fs.open(path.join(root, 'runtime', 'llama.log'), 'a');
    child = spawn(llama, ['--model', model, '--alias', 'process-local', '--api-key', apiKey, '--host', '127.0.0.1', '--port', '4174', '--ctx-size', '12288', '--parallel', '1', '--n-gpu-layers', '0', '--jinja', '--no-webui', '--reasoning-budget', '0'], { cwd: path.dirname(llama), windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
    starting = true;
    child.on('error', event => { error = event.message; starting = false; });
    child.on('exit', code => { starting = false; if (code) error = `Local model process exited (${code}). See runtime/llama.log.`; });
    await log.close();
  }
  return { endpoint, apiKey, speechReady, modelSha256,
    async status() { const ai = await health(); return { ai, localSpeech: speechReady, speechEngine: speechReady ? 'whisper.cpp small.en' : null, model: ai ? 'Qwen3-8B Q4_K_M' : null, localOnly: true, modelState: ai ? 'ready' : error ? 'error' : starting ? 'starting' : 'not-installed', modelError: error, trust: 'review-required' }; },
    stop() { child?.kill(); },
    async transcribe(wav) {
      if (!speechReady) throw new Error('Local Whisper files are not installed. Run setup-local.ps1.');
      if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('The audio is not a valid WAV file.');
      const folder = path.join(root, 'runtime', 'temporary'); await fs.mkdir(folder, { recursive: true });
      const base = path.join(folder, randomUUID()), audio = `${base}.wav`;
      await fs.writeFile(audio, wav, { flag: 'wx' });
      try {
        await new Promise((resolve, reject) => {
          const process = spawn(whisper, ['-m', speechModel, '-f', audio, '-oj', '-of', base, '-l', 'en', '-t', '8', '-ng', '-nt'], { cwd: path.dirname(whisper), windowsHide: true });
          let stderr = '', settled = false;
          const finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(); };
          const timer = setTimeout(() => { process.kill(); finish(new Error('Local transcription timed out.')); }, 360000);
          process.stdout.resume(); process.stderr.on('data', part => { stderr = (stderr + part).slice(-4000); });
          process.on('error', finish); process.on('close', code => finish(code === 0 ? null : new Error(stderr || `Whisper exited (${code}).`)));
        });
        const json = JSON.parse(await fs.readFile(`${base}.json`, 'utf8'));
        const segments = (json.transcription || []).map(item => ({ text: String(item.text || '').trim(), time: Number(item.offsets?.from || 0) / 1000, end: Number.isFinite(item.offsets?.to) ? item.offsets.to / 1000 : null })).filter(item => item.text);
        const transcript = segments.map(item => item.text).join(' ').trim();
        if (!transcript) throw new Error('Local Whisper found no speech.');
        return { transcript, segments, source: 'Local Whisper', timestamped: true };
      } finally { await Promise.all([audio, `${base}.json`].map(file => fs.unlink(file).catch(() => {}))); }
    }
  };
}
