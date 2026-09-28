import { spawnSync } from 'node:child_process';
import { SR, decode, createBus, addSample, mixShotSounds, writeWav, peak } from './mixer.mjs';
import { EDL, TOTAL, END_AT } from './edl2.mjs';

const SND = 'C:/Fragdachse/public/assets/sounds/';
const VO = 'C:/Fragdachse/fragdachse_drive/Sprecher Trailer/VoxCPM2_Referenzstimme_';
const len = TOTAL + 0.5;
const env = (keys) => (t) => { // piecewise-linear gain envelope [[t, g], ...]
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [a, ga] = keys[i - 1], [b, gb] = keys[i]; return ga + (gb - ga) * (t - a) / (b - a); }
  return keys[keys.length - 1][1];
};
const db = (d) => Math.pow(10, d / 20);
const rmsDb = (b, a, z) => { let s = 0, n = 0; for (let i = Math.floor(a * SR); i < Math.floor(z * SR); i++) { s += b.L[i] ** 2 + b.R[i] ** 2; n += 2; } return 20 * Math.log10(Math.sqrt(s / n) + 1e-12); };

// ── Voice-over (normalised per line) ──
const vo = createBus(len);
const lines = [['00008', 1.0], ['00011', 17.5], ['00014', 28.4], ['00016', 34.2], ['00024', 79.6]];
for (const [id, at] of lines) {
  const norm = `audio_cache/vo_${id}.wav`;
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${VO}${id}.flac`, '-af', 'highpass=f=70,loudnorm=I=-16:TP=-2:LRA=7,aresample=48000', '-ac', '2', norm]);
  addSample(vo, decode(norm), { start: at, gain: 1 });
}
const voActive = (t) => lines.some(([id, at]) => t >= at - 0.15 && t <= at + ({ '00008': 16.2, '00011': 10.4, '00014': 5.3, '00016': 2.9, '00024': 3.9 })[id] + 0.2);

// ── Music: documentary (generated) → arena track from the drop ──
const mus = createBus(len);
addSample(mus, decode('music/morning_a.flac'), { start: 0, gain: db(-4), env: env([[0, 0], [0.8, 1], [16.6, 1], [18.3, 0]]) });
addSample(mus, decode('music/night_33.flac'), { start: 15.9, gain: db(-3), env: env([[15.9, 0], [17.9, 0.85], [33.0, 1], [37.9, 0.8], [38.02, 0]]) });
const arena = decode(SND + 'music_arena.ogg');
addSample(mus, arena, { start: 38.0, offset: 45.85, dur: TOTAL - 38.0, gain: db(-1), env: env([[38.0, 1], [79.3, 1], [79.7, db(-11)], [83.5, db(-11)], [84.2, db(-5)], [TOTAL - 1.2, db(-5)], [TOTAL - 0.1, 0]]) });

// ── Game SFX reconstructed from the capture logs ──
const sfx = createBus(len);
const KEY = { shot_bite: 0.22, shot_plasma: 0.3, shot_spore: 0.25, sfx_player_hit: 0.2, sfx_hit_feedback: 0.3, sfx_player_move: 0,
  sfx_nuke_countdown: 0, sfx_player_death: 0.7, sfx_enemy_death: 0.8, sfx_nuke_explosion: 1.4, sfx_train_explode: 1.4, sfx_bfg_laser: 0.7 };
let count = 0;
for (const e of EDL) {
  const doc = e.at < 38;
  count += mixShotSounds(sfx, { json: `shots/${e.clip}.sounds.json`, inFrame: e.in, outFrame: e.out, at: e.at,
    gain: doc && e.clip !== 'd7_bfg2' ? 0.55 : 1, keyGain: KEY, tail: e.clip.startsWith('n4') ? 3.5 : e.clip === 'd7_bfg2' ? 1.5 : 0.3 });
}
console.log('sfx instances', count);
addSample(sfx, decode(SND + 'sfx_bfg_charge.ogg'), { start: 22.1 + 230 / 60, gain: 0.8 });           // BFG charge before the release
addSample(sfx, decode(SND + 'sfx_explosion_he.ogg'), { start: 38.0, gain: 0.8 });                    // the drop
addSample(sfx, decode(SND + 'hallelujah.ogg'), { start: 62.95 - 3.0, gain: 1.0 });                   // choir lands on the holy blast
addSample(sfx, decode(SND + 'sfx_explosion_rocket_aftershock.ogg'), { start: END_AT, gain: 0.6 });   // final impact into the end card

// ── Balance ──
const sfxGain = db((rmsDb(mus, 38, 71) - 5) - rmsDb(sfx, 38, 71));
console.log('music', rmsDb(mus, 38, 71).toFixed(1), 'sfx', rmsDb(sfx, 38, 71).toFixed(1), 'sfx gain', sfxGain.toFixed(2), 'vo', rmsDb(vo, 1, 17).toFixed(1));
const mix = createBus(len);
let duck = 0; // smoothed ducking under the narrator
for (let i = 0; i < mix.L.length; i++) {
  const t = i / SR, target = voActive(t) ? 1 : 0;
  duck += (target - duck) * (target > duck ? 0.0006 : 0.00008);
  const mg = 1 - 0.45 * duck, sg = sfxGain * (1 - 0.5 * duck);
  mix.L[i] = mus.L[i] * mg + sfx.L[i] * sg + vo.L[i] * 1.15;
  mix.R[i] = mus.R[i] * mg + sfx.R[i] * sg + vo.R[i] * 1.15;
}
writeWav(mix, 'mix2_raw.wav'); writeWav(vo, 'bus2_vo.wav'); writeWav(mus, 'bus2_music.wav'); writeWav(sfx, 'bus2_sfx.wav');
const chain = 'acompressor=threshold=-18dB:ratio=1.8:attack=20:release=150:makeup=1,alimiter=limit=0.9:attack=4:release=60:level=disabled';
const p1 = spawnSync('ffmpeg', ['-hide_banner', '-i', 'mix2_raw.wav', '-af', `${chain},loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
const m = JSON.parse(p1.stderr.slice(p1.stderr.lastIndexOf('{'), p1.stderr.lastIndexOf('}') + 1));
const ln = `loudnorm=I=-14:TP=-1.0:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', 'mix2_raw.wav', '-af', `${chain},${ln},alimiter=limit=0.89:level=disabled,aresample=48000`, '-t', TOTAL.toFixed(3), '-c:a', 'pcm_s24le', 'trailer2_audio.wav'], { stdio: 'inherit' });
const chk = spawnSync('ffmpeg', ['-hide_banner', '-i', 'trailer2_audio.wav', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
console.log(chk.stderr.split('Summary:')[1]?.replace(/\s+/g, ' ').trim().slice(0, 200));
