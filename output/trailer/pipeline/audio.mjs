import { spawnSync } from 'node:child_process';
import { SR, decode, createBus, addSample, mixShotSounds, writeWav, peak } from './mixer.mjs';
import { EDL, TOTAL } from './edl.mjs';

const SND = 'C:/Fragdachse/public/assets/sounds/';
const music = decode(SND + 'music_arena.ogg');
const len = TOTAL + 0.5;

// ── Music edit (120 BPM; downbeats at 1.85 + 2k s in the source) ──
const mus = createBus(len);
const seg = (src0, src1, at, { fadeIn = 0.012, fadeOut = 0.012, gain = 1, tail = 0 } = {}) => {
  const dur = src1 - src0 + tail;
  addSample(mus, music, { start: at, offset: src0, dur, gain, fadeOut: tail > 0 ? tail : fadeOut,
    env: (t) => Math.min(1, (t - at) / fadeIn) });
};
seg(81.35, 89.85, 0, { fadeIn: 0.2, tail: 1.6 });          // cold open: breakdown booms at T 0.5 / 4.5, boom 3 rings under the drop
seg(45.85, 69.85, 8.5, { fadeIn: 0.004 });                 // the drop: full-energy section, 12 bars
seg(81.85, 88.85, 32.5, { fadeIn: 0.004, tail: 0 });        // title: booms at T 32.5 / 36.5
// Final fade-out
for (let i = Math.floor(38.0 * SR); i < mus.L.length; i++) { const g = Math.max(0, 1 - (i / SR - 38.0) / 1.5); mus.L[i] *= g * g; mus.R[i] *= g * g; }
// Duck the music under the "Halleluja" (T 18.5–19.5)
for (let i = Math.floor(18.35 * SR); i < Math.floor(19.7 * SR); i++) {
  const t = i / SR; const d = t < 18.5 ? (t - 18.35) / 0.15 : t > 19.5 ? 1 - (t - 19.5) / 0.2 : 1;
  const g = 1 - 0.45 * Math.max(0, Math.min(1, d)); mus.L[i] *= g; mus.R[i] *= g;
}

// ── Game SFX, reconstructed from the capture logs ──
const sfx = createBus(len);
const KEY = { shot_bite: 0.22, shot_plasma: 0.3, shot_spore: 0.25, sfx_player_hit: 0.2, sfx_hit_feedback: 0.35, sfx_player_move: 0,
  sfx_nuke_countdown: 0, sfx_player_death: 0, sfx_enemy_death: 0.8, sfx_explosion_base_destruction: 0.8, sfx_nuke_explosion: 1.4 };
let total = 0;
for (const e of EDL) {
  const clipGain = e.clip === 'cold_open' ? 0.75 : 1;
  const keyGain = { ...KEY, ...(e.clip === 'cold_open' ? { shot_shotgun: 1.6 } : {}) };
  total += mixShotSounds(sfx, { json: `shots/${e.clip}.sounds.json`, inFrame: e.in, outFrame: e.out, at: e.at, gain: clipGain, keyGain, tail: e.clip === 'nuke' ? 3.5 : 0.3 });
}
console.log('sfx instances', total);
// Extra impacts
addSample(sfx, decode(SND + 'sfx_explosion_he.ogg'), { start: 8.5, gain: 0.8 });                        // the drop
addSample(sfx, decode(SND + 'hallelujah.ogg'), { start: 18.5, offset: 1.0, gain: 1.0 });              // choir lands on the holy blast (T 19.5)
addSample(sfx, decode(SND + 'sfx_explosion_rocket_aftershock.ogg'), { start: 32.5, gain: 0.5 });      // title hit

// ── Balance & render ──
const rms = (b, a = 8.5, z = 32.5) => { let s = 0, n = 0; for (let i = Math.floor(a * SR); i < Math.floor(z * SR); i++) { s += b.L[i] ** 2 + b.R[i] ** 2; n += 2; } return 20 * Math.log10(Math.sqrt(s / n)); };
console.log('music rms', rms(mus).toFixed(1), 'dB, sfx rms', rms(sfx).toFixed(1), 'dB, sfx peak', peak(sfx).toFixed(2));
const sfxGain = Math.pow(10, ((rms(mus) - 5) - rms(sfx)) / 20); // SFX bus sits ~5 dB under the music on average
console.log('sfx gain', sfxGain.toFixed(2));
const mix = createBus(len);
for (let i = 0; i < mix.L.length; i++) { mix.L[i] = mus.L[i] * 0.9 + sfx.L[i] * sfxGain; mix.R[i] = mus.R[i] * 0.9 + sfx.R[i] * sfxGain; }
writeWav(mus, 'bus_music.wav'); writeWav(sfx, 'bus_sfx.wav'); writeWav(mix, 'mix_raw.wav');

// Master: glue compression, limiter, two-pass loudness normalisation to −14 LUFS / −1 dBTP.
const chain = 'acompressor=threshold=-18dB:ratio=1.8:attack=20:release=150:makeup=1,alimiter=limit=0.9:attack=4:release=60:level=disabled';
const p1 = spawnSync('ffmpeg', ['-hide_banner', '-i', 'mix_raw.wav', '-af', `${chain},loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
const m = JSON.parse(p1.stderr.slice(p1.stderr.lastIndexOf('{'), p1.stderr.lastIndexOf('}') + 1));
console.log('measured', m.input_i, 'LUFS, TP', m.input_tp);
const ln = `loudnorm=I=-14:TP=-1.0:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', 'mix_raw.wav', '-af', `${chain},${ln},alimiter=limit=0.89:level=disabled,aresample=48000`, '-t', TOTAL.toFixed(3), '-c:a', 'pcm_s24le', 'trailer_audio.wav'], { stdio: 'inherit' });
const chk = spawnSync('ffmpeg', ['-hide_banner', '-i', 'trailer_audio.wav', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
console.log(chk.stderr.split('Summary:')[1]?.replace(/\s+/g, ' ').trim());
