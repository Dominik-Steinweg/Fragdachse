// node analyze.mjs <file...> – loudness profile (1 s RMS dBFS), tempo (onset autocorrelation) and beat phase.
import { spawnSync } from 'node:child_process';
for (const file of process.argv.slice(2)) {
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-ac', '1', '-ar', '11025', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const d = new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.length));
  const SR = 11025, hop = 110, n = Math.floor(d.length / hop), e = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < hop; j++) s += d[i * hop + j] ** 2; e[i] = Math.sqrt(s / hop); }
  const on = new Float32Array(n); for (let i = 1; i < n; i++) on[i] = Math.max(0, Math.log(e[i] + 1e-4) - Math.log(e[i - 1] + 1e-4));
  const sec = []; for (let t = 0; t < d.length / SR; t++) { let s = 0, c = 0; for (let i = t * SR; i < Math.min(d.length, (t + 1) * SR); i++) { s += d[i] ** 2; c++; } sec.push(Math.round(10 * Math.log10(s / c + 1e-12))); }
  let best = [0, 0]; for (let lag = 35; lag <= 75; lag++) { let s = 0; for (let i = lag; i < n; i++) s += on[i] * on[i - lag]; if (s > best[1]) best = [lag, s]; }
  const bpm = 60 / (best[0] * hop / SR);
  // beat phase: offset (s) within one 0.5 s beat that collects most onset energy
  const P = Math.round(.5 * SR / hop); let ph = [0, 0]; for (let o = 0; o < P; o++) { let s = 0; for (let i = o; i < n; i += P) s += on[i]; if (s > ph[1]) ph = [o, s]; }
  console.log(file.split('/').pop(), 'bpm~', bpm.toFixed(1), 'phase', (ph[0] * hop / SR).toFixed(3), 'dB/s', sec.join(' '));
}
