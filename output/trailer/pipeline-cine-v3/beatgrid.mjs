// node beatgrid.mjs <file...> – precise tempo, beat phase, downbeat phase and a beat-clarity score per music file.
// Exported beatGrid(file) returns { bpm, period, phase, downbeat, clarity, low } in seconds (file time).
import { spawnSync } from 'node:child_process';
const SR = 22050, HOP = 128;

function decode(file, lowpass) {
  const af = lowpass ? ['-af', `lowpass=f=${lowpass},lowpass=f=${lowpass}`] : [];
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', file, ...af, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 29 });
  return new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.length));
}
/** Half-wave rectified log-energy flux per hop. */
function onsets(d) {
  const n = Math.floor(d.length / HOP), e = new Float32Array(n), o = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < HOP; j++) s += d[i * HOP + j] ** 2; e[i] = Math.log(1e-6 + Math.sqrt(s / HOP)); }
  for (let i = 1; i < n; i++) o[i] = Math.max(0, e[i] - e[i - 1]);
  return o;
}
export function beatGrid(file, { from = 0, to = Infinity, minBpm = 100, maxBpm = 140 } = {}) {
  const full = onsets(decode(file)), low = onsets(decode(file, 160));
  const a = Math.floor(from * SR / HOP), b = Math.min(full.length, Math.floor(Math.min(to, 1e6) * SR / HOP));
  const fps = SR / HOP, center = arr => { let m = 0; for (const v of arr) m += v; m /= arr.length; return arr.map(v => v - m); };
  const o = center(full.subarray(a, b)), lo = low.subarray(a, b), oRaw = full.subarray(a, b);
  let energy = 0; for (const v of o) energy += v * v; energy /= o.length;
  // Autocorrelation over the tempo range, parabolic peak refinement.
  const ac = lag => { let s = 0; for (let i = lag; i < o.length; i++) s += o[i] * o[i - lag]; return s / (o.length - lag); };
  const l0 = Math.floor(fps * 60 / maxBpm), l1 = Math.ceil(fps * 60 / minBpm);
  let best = l0, bv = -1, sum = 0, cnt = 0;
  for (let l = l0; l <= l1; l++) { const v = ac(l); sum += v; cnt++; if (v > bv) { bv = v; best = l; } }
  const y0 = ac(best - 1), y2 = ac(best + 1), shift = .5 * (y0 - y2) / (y0 - 2 * bv + y2 || 1);
  const period = (best + shift) / fps;
  // Beat phase: comb over all beats (sub-hop resolution by linear interpolation).
  const at = (arr, t) => { const x = t * fps, i = Math.floor(x), f = x - i; return i + 1 < arr.length && i >= 0 ? arr[i] * (1 - f) + arr[i + 1] * f : 0; };
  const comb = (arr, ph, step) => { let s = 0; for (let t = ph; t < arr.length / fps; t += step) s += Math.max(at(arr, t - .006), at(arr, t), at(arr, t + .006)); return s; };
  let phase = 0, pv = -1;
  for (let k = 0; k < 400; k++) { const ph = period * k / 400, v = comb(o, ph, period); if (v > pv) { pv = v; phase = ph; } }
  // Downbeat: the beat of the 4-beat bar with the strongest kick-band onsets.
  let downbeat = phase, dv = -1;
  for (let k = 0; k < 4; k++) { const ph = phase + k * period, v = comb(lo, ph, period * 4); if (v > dv) { dv = v; downbeat = ph; } }
  const clarity = bv / energy;
  let le = 0; for (let i = 0; i < lo.length; i++) le += lo[i];
  return { bpm: +(60 / period).toFixed(3), period: +period.toFixed(5), phase: +(phase + from).toFixed(4), downbeat: +(downbeat + from).toFixed(4),
    clarity: +clarity.toFixed(3), low: +(le / lo.length).toFixed(4) };
}
if (process.argv[1]?.endsWith('beatgrid.mjs')) for (const f of process.argv.slice(2)) console.log(f.split('/').pop(), JSON.stringify(beatGrid(f, { from: 1 })));
