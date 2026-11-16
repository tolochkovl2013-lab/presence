/**
 * Нейронный голос (Piper, локально, без интернета).
 * POST /api/tts  { text, voice, rate, pitch, pause } -> audio/wav
 */
'use strict';

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PIPER = path.join(ROOT, 'vendor', 'piper', 'piper', 'piper.exe');
const VOICES_DIR = path.join(ROOT, 'voices');

/* ---- WAV helpers (16-bit PCM mono) ---- */
function readWav(buf) {
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = buf.subarray(body, body + size);
    }
    pos = body + size + (size % 2);
  }
  if (!fmt || !data) return null;
  const n = Math.floor(data.length / 2);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = data.readInt16LE(i * 2) / 32768;
  return { samples, rate: fmt.rate, channels: fmt.channels };
}

function writeWav(samples, rate) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

/* ---- «человечность»: питч (ресемплинг) + пауза + лёгкий вдох ---- */
function shiftPitch(samples, rate, pitch) {
  if (!pitch || Math.abs(pitch - 1) < 0.01) return { samples, rate };
  const outN = Math.floor(samples.length / pitch);
  const out = new Float32Array(outN);
  for (let i = 0; i < outN; i++) {
    const src = i * pitch;
    const i0 = Math.floor(src), f = src - i0;
    out[i] = (samples[i0] || 0) * (1 - f) + (samples[i0 + 1] || 0) * f;
  }
  return { samples: out, rate };
}

function addBreath(samples, rate, { amp = 0.0016, ms = 170 } = {}) {
  const n = Math.floor(rate * ms / 1000);
  const pre = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const env = Math.sin(Math.PI * (i / n)) ** 2;
    pre[i] = (Math.random() * 2 - 1) * amp * env;
  }
  const out = new Float32Array(n + samples.length);
  out.set(pre, 0);
  out.set(samples, n);
  return out;
}

function silence(ms, rate) {
  return new Float32Array(Math.max(0, Math.floor(rate * ms / 1000)));
}

function normalize(samples, target = 0.92) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak < 0.0001 || peak >= target) return samples;
  const k = target / peak;
  for (let i = 0; i < samples.length; i++) samples[i] *= k;
  return samples;
}

/* ---- разбивка на фразы ---- */
function cleanText(s) {
  return String(s || '')
    .replace(/```[\s\S]*?```/g, ' . ')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/[*_`#>~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function splitPhrases(text, on) {
  const t = cleanText(text);
  if (!on) return [t];
  return t.split(/(?<=[.!?…])\s+/)
    .flatMap(p => (p.length > 200 ? p.split(/(?<=[,;:])\s+/) : [p]))
    .map(p => p.trim()).filter(Boolean);
}

/* ---- запуск piper ---- */
function piper(text, voicePath, { lengthScale = 1.0, noiseScale = 0.667, noiseW = 0.8 } = {}) {
  return new Promise((resolve, reject) => {
    const out = path.join(os.tmpdir(), `piper-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
    const p = spawn(PIPER, [
      '--model', voicePath,
      '--output_file', out,
      '--length_scale', String(lengthScale),
      '--noise_scale', String(noiseScale),
      '--noise_w', String(noiseW),
    ], { windowsHide: true, cwd: path.dirname(PIPER) });

    p.on('error', reject);
    p.stderr.on('data', () => {});
    p.on('close', async code => {
      try {
        if (code !== 0 || !fs.existsSync(out)) return resolve(null);
        const buf = await fsp.readFile(out);
        fsp.unlink(out).catch(() => {});
        resolve(readWav(buf));
      } catch (e) { reject(e); }
    });
    p.stdin.write(text + '\n');
    p.stdin.end();
  });
}

function availableVoices() {
  try {
    return fs.readdirSync(VOICES_DIR)
      .filter(f => f.endsWith('.onnx'))
      .map(f => ({
        id: f.replace(/\.onnx$/, ''),
        name: f.replace(/\.onnx$/, '')
          .replace(/^ru_RU-/, '')
          .replace(/-medium$/, '')
          .replace(/^./, c => c.toUpperCase()),
        lang: 'ru',
      }));
  } catch { return []; }
}

async function synthesize({ text, voice = 'irina', rate = 1.0, pitch = 1.06, pauseMs = 260,
  splitPhrases: split = true, breath = true }) {
  const voices = availableVoices();
  const pick = voices.find(v => v.id === voice) || voices[0];
  if (!pick) return null;
  const voicePath = path.join(VOICES_DIR, pick.id + '.onnx');

  const phrases = splitPhrases(text, split);
  if (!phrases.length) return null;

  const lengthScale = Math.max(0.6, Math.min(1.8, 1 / Math.max(0.5, rate)));
  let rateHz = 22050;
  const parts = [];

  for (let i = 0; i < phrases.length; i++) {
    let phrase = phrases[i];
    if (breath && phrase.length > 60) phrase = '… ' + phrase;
    const wav = await piper(phrase, voicePath, { lengthScale });
    if (!wav) continue;
    rateHz = wav.rate;
    let smp = wav.samples;
    const shifted = shiftPitch(smp, wav.rate, pitch);
    smp = shifted.samples;
    if (breath) smp = addBreath(smp, rateHz);
    parts.push(smp);
    if (i < phrases.length - 1) parts.push(silence(pauseMs, rateHz));
  }

  if (!parts.length) return null;
  const total = parts.reduce((a, b) => a + b.length, 0);
  const joined = new Float32Array(total);
  let off = 0;
  for (const p of parts) { joined.set(p, off); off += p.length; }

  return writeWav(normalize(joined), rateHz);
}

module.exports = { synthesize, availableVoices, cleanText };
