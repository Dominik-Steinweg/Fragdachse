// node accents.mjs <file> <phase> – onset strength per beat index (mod 4, mod 16) to find bar and phrase starts.
import { spawnSync } from 'node:child_process';
const [file, phase] = process.argv.slice(2), P = .5, SR = 22050, HOP = 64;
const dec = af => { const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', file, ...af, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 29 });
  return new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.length)); };
const env = d => { const n = Math.floor(d.length / HOP), e = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < HOP; j++) s += d[i * HOP + j] ** 2; e[i] = Math.sqrt(s / HOP); } return e; };
const full = env(dec([])), fps = SR / HOP;
const peak = t => { let m = 0; for (let i = Math.round((t - .02) * fps); i <= Math.round((t + .08) * fps); i++) m = Math.max(m, full[i] ?? 0); return m; };
const beats = []; for (let t = +phase; t < full.length / fps - .2; t += P) beats.push(peak(t));
const by = m => Array.from({ length: m }, (_, k) => { const v = beats.filter((_, i) => i % m === k); return (v.reduce((a, b) => a + b, 0) / v.length).toFixed(3); });
console.log('mod4 ', by(4).join(' ')); console.log('mod16', by(16).join(' '));
console.log('per beat', beats.map((v, i) => (i % 16 === 0 ? '| ' : '') + v.toFixed(2)).join(' '));
