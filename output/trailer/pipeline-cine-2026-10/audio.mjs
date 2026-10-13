// Mixes the trailer soundtrack: music bed, trailer accents, synthesized heartbeat and the game's own
// sound events re-timed through the edit (slow-motion segments keep sounds at natural pitch).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { EDL, CUES, DURATION } from './edl.mjs';
const ROOT = 'C:/Fragdachse/output/trailer/pipeline-cine-2026-10';
const MASTERS = `${ROOT}/${process.env.DRAFT ? 'masters-draft' : 'masters'}`;
const SR = 48000;
mkdirSync(`${ROOT}/audio_cache`, { recursive: true });

const decoded = new Map();
function decode(path) {
  if (decoded.has(path)) return decoded.get(path);
  const raw = `${ROOT}/audio_cache/${path.replace(/[^a-zA-Z0-9._-]/g, '_')}.f32`;
  if (!existsSync(raw)) {
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path, '-ac', '2', '-ar', String(SR), '-f', 'f32le', raw]);
    if (r.status) throw Error('decode ' + path + ' ' + r.stderr);
  }
  const b = readFileSync(raw), d = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  decoded.set(path, d); return d;
}
// Two buses: the music is ducked under accents and game sounds so hits cut through.
const N = Math.ceil(DURATION * SR);
const BUS = { music: [new Float32Array(N), new Float32Array(N)], fx: [new Float32Array(N), new Float32Array(N)],
  game: [new Float32Array(N), new Float32Array(N)] };
// Constant gunfire and hit clicks would bury the music; accents and big game sounds stay up front.
const KEY_GAIN = [[/^shot_/, .45], [/^sfx_hit_feedback$/, .25], [/^sfx_player_hit$/, .45]];
const keyGain = key => KEY_GAIN.find(([re]) => re.test(key))?.[1] ?? 1;
/** Adds a sample (interleaved stereo) at `at` seconds with gain/offset/duration and short fades. */
function add(data, at, { gain = 1, offset = 0, dur = Infinity, fadeIn = .004, fadeOut = .02, pan = 0, env = null, bus = 'fx' } = {}) {
  const [L, R] = BUS[bus];
  const frames = data.length / 2, start = Math.round(at * SR), off = Math.round(offset * SR);
  const n = Math.min(frames - off, Math.round(Math.min(dur, 1e6) * SR), L.length - start);
  const gl = Math.min(1, 1 - pan), gr = Math.min(1, 1 + pan), fi = fadeIn * SR, fo = fadeOut * SR;
  for (let i = Math.max(0, -start); i < n; i++) {
    let g = gain * Math.min(1, (i + 1) / fi, (n - i) / fo);
    if (env) g *= env((start + i) / SR);
    L[start + i] += data[(off + i) * 2] * g * gl; R[start + i] += data[(off + i) * 2 + 1] * g * gr;
  }
}
// Game sound keys → files, read from the game's own audio catalog.
const catalog = new Map([...readFileSync('C:/Fragdachse/src/audio/AudioCatalog.ts', 'utf8')
  .matchAll(/^\s*([a-z0-9_]+):\s*'\.\/(assets\/[^']+)'/gm)].map(m => [m[1], 'C:/Fragdachse/public/' + m[2]]));

// 1) Game sounds through the edit.
let placed = 0, missing = new Set();
for (const seg of EDL) {
  const meta = JSON.parse(readFileSync(`${MASTERS}/${seg.shot}.json`, 'utf8'));
  const simAt = f => f <= 0 ? 0 : meta.sim[Math.min(meta.sim.length - 1, f - 1)];
  const simFrom = simAt(Math.round(seg.from * 60)), simTo = simAt(Math.round(seg.to * 60));
  const toTrailer = simMs => { // sim time → master frame → trailer time
    let f = meta.sim.findIndex(s => s >= simMs); if (f < 0) f = meta.sim.length - 1;
    return seg.at + (f / 60 - seg.from) / seg.speed;
  };
  const end = seg.at + (seg.to - seg.from) / seg.speed;
  for (const e of meta.sounds) {
    if (e.e !== 'play' || e.t < simFrom || e.t >= simTo || /music/.test(e.key)) continue;
    const file = catalog.get(e.key); if (!file || !existsSync(file)) { missing.add(e.key); continue; }
    const at = toTrailer(e.t);
    add(decode(file), at, { bus: 'game', gain: (e.v ?? 1) * keyGain(e.key) * (seg.sfxGain ?? .55), dur: e.loop ? end - at : end - at + 1.2, fadeOut: .08, pan: (e.pan ?? 0) * .6 });
    placed++;
  }
}
// 2) Heartbeat for the cold open (two thumps per beat).
function thump(at, gain) {
  const n = Math.round(.32 * SR), d = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { const t = i / SR, f = 46 + 30 * Math.exp(-t * 18);
    const v = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 11) * (1 - Math.exp(-t * 400)); d[i * 2] = d[i * 2 + 1] = v; }
  add(d, at, { gain, fadeOut: .05 });
}
for (const c of CUES) {
  if (c.heartbeat) { for (const t of c.heartbeat) { thump(t, c.gain ?? .9); thump(t + .28, (c.gain ?? .9) * .65); } continue; }
  add(decode(`${ROOT}/music/${c.file}.flac`), c.at, { bus: /^(bed|beat)-/.test(c.file) ? 'music' : 'fx', gain: c.gain ?? 1, offset: c.offset ?? 0, dur: c.dur ?? Infinity,
    fadeIn: c.fadeIn ?? .004, fadeOut: c.fadeOut ?? .05,
    env: c.envelope ? t => { const k = c.envelope; for (let i = 1; i < k.length; i++) if (t <= k[i][0]) return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * (t - k[i - 1][0]) / (k[i][0] - k[i - 1][0]); return k[k.length - 1][1]; } : null });
}
// 3) Sidechain: an envelope follower on the fx bus ducks the music by up to DUCK.depth.
const DUCK = { depth: .45, threshold: .25, attack: .004, release: .3 };
const [ML, MR] = BUS.music, [FL, FR] = BUS.fx, [GL, GR] = BUS.game, L = new Float32Array(N), R = new Float32Array(N);
const ka = 1 - Math.exp(-1 / (DUCK.attack * SR)), kr = 1 - Math.exp(-1 / (DUCK.release * SR));
let envelope = 0, deepest = 1;
for (let i = 0; i < N; i++) {
  const x = Math.max(Math.abs(FL[i]), Math.abs(FR[i]));
  envelope += (x - envelope) * (x > envelope ? ka : kr);
  const k = Math.min(1, envelope / DUCK.threshold), g = 1 - DUCK.depth * k * k * (3 - 2 * k);
  deepest = Math.min(deepest, g);
  L[i] = ML[i] * g + FL[i] + GL[i]; R[i] = MR[i] * g + FR[i] + GR[i];
}
console.log(`duck: deepest ${(20 * Math.log10(deepest)).toFixed(1)} dB`);
// 4) Write float WAV, then master: gentle glue compression, limiter, -14 LUFS for social platforms.
const pcm = Buffer.alloc(L.length * 8);
for (let i = 0; i < L.length; i++) { pcm.writeFloatLE(L[i], i * 8); pcm.writeFloatLE(R[i], i * 8 + 4); }
writeFileSync(`${ROOT}/mix.f32`, pcm);
// Mastering keeps the dynamics: glue compression, measure, one fixed gain to -14 LUFS, true-peak limiter.
const glue = 'acompressor=threshold=-20dB:ratio=1.6:attack=15:release=250:makeup=1';
const probe = spawnSync('ffmpeg', ['-hide_banner', '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', `${ROOT}/mix.f32`, '-af', glue + ',ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
const measured = +[...probe.stderr.matchAll(/I:\s+(-?[0-9.]+) LUFS/g)].pop()[1];
const gain = (-14 - measured).toFixed(2);
const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', `${ROOT}/mix.f32`,
  '-af', `${glue},volume=${gain}dB,alimiter=limit=0.8:attack=3:release=60:level=0`, '-ar', String(SR), `${ROOT}/mix.wav`]);
if (r.status) throw Error(String(r.stderr));
console.log(`master: measured ${measured} LUFS, gain ${gain} dB`);
console.log(`mix: ${placed} game sounds placed${missing.size ? ', unmapped keys: ' + [...missing].join(' ') : ''}`);
