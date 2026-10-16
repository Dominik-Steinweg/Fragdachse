// node kickphase.mjs <file> [period] – kick-band beat phase per 6 s window for a fixed period (drift check).
import { spawnSync } from 'node:child_process';
const [file, per = '0.5'] = process.argv.slice(2), P = +per, SR = 22050, HOP = 64;
const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-af', 'lowpass=f=120,lowpass=f=120', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 29 });
const d = new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.length));
const n = Math.floor(d.length / HOP), e = new Float32Array(n);
for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < HOP; j++) s += d[i * HOP + j] ** 2; e[i] = Math.sqrt(s / HOP); }
const fps = SR / HOP, on = new Float32Array(n); for (let i = 1; i < n; i++) on[i] = Math.max(0, e[i] - e[i - 1]);
const out = [];
for (let w = 0; w + 6 <= n / fps; w += 6) {
  let best = 0, bv = -1;
  for (let k = 0; k < 250; k++) { const ph = P * k / 250; let s = 0; for (let t = w + ph; t < w + 6; t += P) { const i = Math.round(t * fps); s += Math.max(on[i - 1] ?? 0, on[i] ?? 0, on[i + 1] ?? 0); } if (s > bv) { bv = s; best = ph; } }
  out.push(`${w}s:${best.toFixed(3)}`);
}
console.log(file.split('/').pop(), P, out.join(' '));
