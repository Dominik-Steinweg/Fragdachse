// node assemble2.mjs [rough|final]
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { EDL, TOTAL, END_CARD, FPS } from './edl2.mjs';

const mode = process.argv[2] ?? 'rough';
const args = ['-y', '-loglevel', 'warning'];
const filters = [];
EDL.forEach((e, i) => {
  args.push('-i', `shots/${e.clip}.mp4`);
  filters.push(`[${i}:v]trim=start_frame=${e.in}:end_frame=${e.out},setpts=PTS-STARTPTS,${e.grade},setsar=1,format=yuv420p[s${i}]`);
});
const n = EDL.length;
// End card background: black (the overlay paints the card itself).
filters.push(`color=c=black:s=1920x1080:r=${FPS}:d=${END_CARD},setsar=1,format=yuv420p[s${n}]`);
filters.push(`${Array.from({ length: n + 1 }, (_, i) => `[s${i}]`).join('')}concat=n=${n + 1}:v=1:a=0,fps=${FPS}[cat]`);
let last = 'cat';
if (mode === 'final') {
  args.push('-i', 'overlay2.mov');
  filters.push(`[cat]vignette=angle=0.42:mode=forward[vig]`);
  filters.push(`[vig][${n}:v]overlay=0:0:format=auto,format=yuv420p[vout]`);
  last = 'vout';
  args.push('-i', 'trailer2_audio.wav');
}
args.push('-filter_complex', filters.join(';'), '-map', `[${last}]`);
if (mode === 'final') args.push('-map', `${n + 1}:a`, '-c:a', 'aac', '-b:a', '320k', '-ar', '48000');
const out = mode === 'final' ? 'Fragdachse_Trailer_DachsLAN.mp4' : 'rough2.mp4';
args.push('-c:v', 'libx264', '-preset', mode === 'final' ? 'slow' : 'veryfast', '-crf', mode === 'final' ? '16' : '22',
  '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', '-t', TOTAL.toFixed(3), out);
const r = spawnSync('ffmpeg', args, { stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8' });
console.log((r.stderr || '').split('\n').filter(l => !/deprecated|Last message|accelerated/.test(l)).join('\n').slice(0, 1500));
console.log('ffmpeg exit', r.status, out);
