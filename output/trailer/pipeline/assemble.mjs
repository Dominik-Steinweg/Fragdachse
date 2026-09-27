// node assemble.mjs [rough|final]
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { EDL, TITLE, TOTAL, FPS } from './edl.mjs';

const mode = process.argv[2] ?? 'rough';
console.log('segments', EDL.map(e => `${e.clip}@${e.at.toFixed(2)}`).join(' '), 'title@', TITLE.at.toFixed(2), 'total', TOTAL.toFixed(2));
const args = ['-y', '-loglevel', 'warning'];
const filters = [];
EDL.forEach((e, i) => {
  args.push('-i', `shots/${e.clip}.mp4`);
  filters.push(`[${i}:v]trim=start_frame=${e.in}:end_frame=${e.out},setpts=PTS-STARTPTS,${e.grade},setsar=1,format=yuv420p[s${i}]`);
});
const ti = EDL.length;
args.push('-i', `shots/${TITLE.clip}.mp4`);
const dur = (TITLE.out - TITLE.in) / FPS;
// Crop away the black world-edge strip, then a slow lanczos push-in towards the rock title.
filters.push(`[${ti}:v]trim=start_frame=${TITLE.in}:end_frame=${TITLE.out},setpts=PTS-STARTPTS,crop=3796:2136:22:24,`
  + `scale=w='2*trunc(960*(1.0+0.035*t/${dur}))':h='2*trunc(540*(1.0+0.035*t/${dur}))':eval=frame:flags=lanczos,`
  + `crop=1920:1080:'(iw-1920)/2':'(ih-1080)*0.1',eq=contrast=1.1:saturation=1.18:brightness=0.015,setsar=1,format=yuv420p[s${ti}]`);
const n = EDL.length + 1;
filters.push(`${Array.from({ length: n }, (_, i) => `[s${i}]`).join('')}concat=n=${n}:v=1:a=0,fps=${FPS}[cat]`);
let last = 'cat';
if (mode === 'final') {
  const oi = n; args.push('-i', 'overlay.mov');
  filters.push(`[cat]vignette=angle=0.42:mode=forward[vig]`);
  filters.push(`[vig][${oi}:v]overlay=0:0:format=auto,format=yuv420p[vout]`);
  last = 'vout';
  if (existsSync('trailer_audio.wav')) args.push('-i', 'trailer_audio.wav');
}
args.push('-filter_complex', filters.join(';'), '-map', `[${last}]`);
if (mode === 'final' && existsSync('trailer_audio.wav')) args.push('-map', `${n + 1}:a`, '-c:a', 'aac', '-b:a', '320k', '-ar', '48000');
const out = mode === 'final' ? 'Fragdachse_Trailer.mp4' : 'rough_cut.mp4';
args.push('-c:v', 'libx264', '-preset', mode === 'final' ? 'slow' : 'veryfast', '-crf', mode === 'final' ? '15' : '22',
  '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', '-t', TOTAL.toFixed(3), out);
const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
console.log('ffmpeg exit', r.status, out);
