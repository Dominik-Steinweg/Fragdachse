// Reconstructs in-game SFX from logged sound events and mixes them into a stereo float buffer.
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';

export const SR = 48000;
const cache = new Map();
const PUBLIC = 'C:/Fragdachse/public/';

/** Decode an audio file to interleaved stereo float32 at 48 kHz. */
export function decode(path) {
  if (cache.has(path)) return cache.get(path);
  mkdirSync('audio_cache', { recursive: true });
  const raw = 'audio_cache/' + path.replace(/[^a-zA-Z0-9._-]/g, '_') + '.f32';
  if (!existsSync(raw)) {
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path, '-ac', '2', '-ar', String(SR), '-f', 'f32le', raw]);
    if (r.status !== 0) throw new Error('decode failed ' + path + ' ' + r.stderr);
  }
  const b = readFileSync(raw);
  const data = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  cache.set(path, data);
  return data;
}

export function createBus(seconds) {
  return { L: new Float32Array(Math.ceil(seconds * SR)), R: new Float32Array(Math.ceil(seconds * SR)) };
}

/**
 * Add a sample to the bus.
 * start: seconds in bus; offset: seconds into sample; dur: max seconds (null = full; loops need dur)
 * gain envelope: function(tSecInBus) → gain multiplier (optional)
 */
export function addSample(bus, data, { start, offset = 0, dur = null, gain = 1, pan = 0, rate = 1, loop = false, env = null, fadeOut = 0.01 }) {
  const frames = data.length / 2;
  const pl = Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2, pr = Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
  const gl = Math.min(pl, 1.2), gr = Math.min(pr, 1.2);
  let n = dur === null ? Math.floor((frames / rate) - offset * SR) : Math.floor(dur * SR);
  const s0 = Math.floor(start * SR);
  const fadeN = Math.max(1, Math.floor(fadeOut * SR));
  for (let i = 0; i < n; i++) {
    const o = s0 + i; if (o < 0) continue; if (o >= bus.L.length) break;
    let pos = (offset * SR + i) * rate;
    if (loop) pos = pos % frames; else if (pos >= frames - 1) break;
    const p0 = Math.floor(pos), fr = pos - p0, p1 = loop ? (p0 + 1) % frames : p0 + 1;
    let l = data[p0 * 2] * (1 - fr) + data[p1 * 2] * fr;
    let r = data[p0 * 2 + 1] * (1 - fr) + data[p1 * 2 + 1] * fr;
    let g = gain;
    if (env) g *= env(o / SR);
    if (dur !== null && i > n - fadeN) g *= (n - i) / fadeN;
    if (i < 48) g *= i / 48; // 1 ms declick
    bus.L[o] += l * g * gl; bus.R[o] += r * g * gr;
  }
}

/**
 * Mix logged game sounds of one captured shot into the bus.
 * clip: { json, inFrame, outFrame, at (bus seconds of inFrame), gain, keyGain: {key: mult}, tail (s) }
 */
export function mixShotSounds(bus, clip) {
  const j = JSON.parse(readFileSync(clip.json, 'utf8'));
  const sim = j.simTimes; // sim ms at each frame (after stepping)
  const frameOfSim = (t) => { // first frame whose sim time >= t
    let lo = 0, hi = sim.length - 1;
    if (t <= sim[0]) return 0;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sim[m] >= t - 0.001) hi = m; else lo = m + 1; }
    return lo;
  };
  const speedFactor = clip.speedFactor ?? 1; // output time per frame
  const outT = (f) => clip.at + (f - clip.inFrame) / 60 * speedFactor;
  const endT = outT(clip.outFrame) + (clip.tail ?? 0.35);
  const cutT = outT(clip.outFrame);
  const byId = new Map();
  const lastByKey = new Map();
  const kg = clip.keyGain ?? {};
  let count = 0;
  const events = j.events.slice().sort((a, b) => a.t - b.t);
  // group loop instances
  for (const e of events) {
    if (e.e !== 'play' && e.e !== 'stop' && e.e !== 'set') continue;
    if (/^music/.test(e.key)) continue;
    const path = j.assets[e.key]; if (!path) continue;
    const f = frameOfSim(e.t);
    if (e.e === 'play') {
      if (f < clip.inFrame - 6 || f >= clip.outFrame) { if (e.loop) byId.set(e.id, { e, f, sets: [], startF: f }); continue; }
      if (e.loop) { byId.set(e.id, { e, f, sets: [], startF: f }); continue; }
      const g = (kg[e.key] ?? kg['*'] ?? 1);
      if (g <= 0) continue;
      // density limit per key: min spacing 35 ms in output time
      const t = outT(f);
      const last = lastByKey.get(e.key) ?? -1;
      if (t - last < (clip.minSpacing ?? 0.035)) continue;
      lastByKey.set(e.key, t);
      const data = decode(PUBLIC + path.replace(/^\.\//, ''));
      const rate = (e.rate || 1) * Math.pow(2, (e.detune || 0) / 1200);
      const offset = t < clip.at ? clip.at - t : 0;
      const tailEnv = (tt) => tt <= cutT ? 1 : Math.max(0, 1 - (tt - cutT) / Math.max(0.01, (clip.tail ?? 0.35)));
      addSample(bus, data, { start: Math.max(t, clip.at), offset, gain: e.v * g * (clip.gain ?? 1), pan: (e.pan || 0) * 0.7, rate, env: tailEnv, dur: Math.max(0.01, endT - Math.max(t, clip.at)) });
      count++;
    } else if (e.e === 'stop') {
      const inst = byId.get(e.id); if (inst && inst.stopF === undefined) inst.stopF = f;
    } else if (e.e === 'set') {
      const inst = byId.get(e.id); if (inst && e.prop === 'volume') inst.sets.push({ f, v: e.val });
    }
  }
  for (const inst of byId.values()) {
    const e = inst.e; const g = (kg[e.key] ?? kg['*'] ?? 1); if (g <= 0) continue;
    const s = Math.max(inst.startF, clip.inFrame), stop = Math.min(inst.stopF ?? Infinity, clip.outFrame);
    if (stop <= s) continue;
    const data = decode(PUBLIC + j.assets[e.key].replace(/^\.\//, ''));
    const sets = inst.sets;
    const volAt = (tt) => { const f = clip.inFrame + (tt - clip.at) * 60 / speedFactor; let v = e.v; for (const q of sets) { if (q.f <= f) v = q.v; else break; } return v; };
    addSample(bus, data, { start: outT(s), offset: (s - inst.startF) / 60, dur: (stop - s) / 60 * speedFactor, loop: true, gain: g * (clip.gain ?? 1), pan: (e.pan || 0) * 0.7, env: (tt) => volAt(tt), fadeOut: 0.05 });
    count++;
  }
  return count;
}

export function writeWav(bus, path) {
  const n = bus.L.length; const buf = Buffer.alloc(44 + n * 8);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 8, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 8, 28); buf.writeUInt16LE(8, 32); buf.writeUInt16LE(32, 34); buf.write('data', 36); buf.writeUInt32LE(n * 8, 40);
  for (let i = 0; i < n; i++) { buf.writeFloatLE(bus.L[i], 44 + i * 8); buf.writeFloatLE(bus.R[i], 48 + i * 8); }
  writeFileSync(path, buf);
}

export function peak(bus) { let p = 0; for (let i = 0; i < bus.L.length; i++) p = Math.max(p, Math.abs(bus.L[i]), Math.abs(bus.R[i])); return p; }
