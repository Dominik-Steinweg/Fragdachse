// node assemble.mjs [16x9|9x16] – cuts the 4K masters into the trailer with grade, titles, flashes and sound.
import { spawnSync } from 'node:child_process';
import { EDL, TITLES, FLASHES, LETTERBOX, DURATION } from './edl.mjs';
const ROOT = 'C:/Fragdachse/output/trailer/pipeline-cine-2026-10';
const mode = process.argv[2] ?? '16x9', vertical = mode === '9x16';
const [W, H] = vertical ? [1080, 1920] : [1920, 1080];
const CROP_W = 1215; // 9:16 window inside the 3840x2160 master (2160 * 9/16)

const inputs = [], filters = [];
const input = (args) => { inputs.push(...args); return inputs.filter(a => a === '-i').length - 1; };
// Segments: seek, retime (speed 2 on overcranked masters = real time), frame / reframe.
EDL.forEach((s, i) => {
  const k = input(['-ss', String(s.from), '-t', String(s.to - s.from), '-i', `${ROOT}/masters/${s.shot}.mp4`]);
  const cx = s.cx ?? .5, x0 = Math.round((3840 - CROP_W) * Math.max(0, Math.min(1, (cx * 3840 - CROP_W / 2) / (3840 - CROP_W))));
  const frame = vertical ? `crop=${CROP_W}:2160:${x0}:0,scale=${W}:${H}:flags=lanczos` : `scale=${W}:${H}:flags=lanczos`;
  // Optional digital push inside the 4K master: zoom [from, to] around (zx, zy), lossless up to 2x at 1080p.
  const dur = (s.to - s.from) / s.speed, [z0, z1] = s.zoom ?? [1, 1], zx = s.zx ?? .5, zy = s.zy ?? .5;
  const ease = `(1-pow(1-min(1,on/${Math.max(1, Math.round(dur * 60))}),2))`;
  const push = z0 === 1 && z1 === 1 ? '' : `zoompan=z='${z0}+(${z1 - z0})*${ease}':x='iw*${zx}-iw/zoom/2':y='ih*${zy}-ih/zoom/2':d=1:s=3840x2160:fps=60,`;
  filters.push(`[${k}:v]setpts=(PTS-STARTPTS)/${s.speed},fps=60,${push}${frame},setsar=1,format=yuv420p[s${i}]`);
});
filters.push(`${EDL.map((_, i) => `[s${i}]`).join('')}concat=n=${EDL.length}:v=1:a=0[cut]`);
// Grade: a touch more contrast and saturation, cooler shadows / warmer highlights, vignette and grain.
filters.push(`[cut]eq=contrast=1.07:saturation=1.12:gamma=.97,colorbalance=rs=-.03:bs=.04:rh=.04:bh=-.03,`
  + `vignette=angle=PI/4.6,noise=alls=3:allf=t+u,format=yuv420p[g0]`);
let last = 'g0';
// Cinematic bars that open on the first hit.
if (LETTERBOX && !vertical) {
  const end = LETTERBOX.open + LETTERBOX.duration;
  const k = input(['-f', 'lavfi', '-t', String(end + .1), '-i', `color=c=black:s=${W}x140:r=60`]);
  const slide = `140*min(1,max(0,(t-${LETTERBOX.open})/${LETTERBOX.duration}))^2`;
  filters.push(`[${k}:v]split[bt][bb]`);
  filters.push(`[${last}][bt]overlay=x=0:y='-${slide}':enable='lt(t,${end})':eof_action=pass[lb1]`);
  filters.push(`[lb1][bb]overlay=x=0:y='H-140+${slide}':enable='lt(t,${end})':eof_action=pass[lb]`);
  last = 'lb';
}
// Flash frames (white or black dips).
FLASHES.forEach((f, i) => {
  const k = input(['-f', 'lavfi', '-t', String(f.d), '-i', `color=c=${f.color ?? 'white'}:s=${W}x${H}:r=60`]);
  filters.push(`[${k}:v]format=rgba,fade=t=in:st=0:d=${f.in ?? .02}:alpha=1,fade=t=out:st=${f.in ?? .02}:d=${f.d - (f.in ?? .02)}:alpha=1,setpts=PTS+${f.at}/TB[f${i}]`);
  filters.push(`[${last}][f${i}]overlay=enable='between(t,${f.at},${f.at + f.d})':eof_action=pass[fl${i}]`); last = `fl${i}`;
});
// Titles: fade, optional slam (scale from 1.18 to 1 over 0.22 s).
TITLES.forEach((t, i) => {
  const k = input(['-loop', '1', '-t', String(t.d), '-i', `${ROOT}/titles/${t.name}-${mode}.png`]);
  const slam = t.slam ? `,scale=w='iw*(1+.18*max(0,1-t/.22))':h=-1:eval=frame` : '';
  filters.push(`[${k}:v]format=rgba${slam},fade=t=in:st=0:d=${t.in ?? .25}:alpha=1,fade=t=out:st=${t.d - (t.out ?? .35)}:d=${t.out ?? .35}:alpha=1,setpts=PTS+${t.at}/TB[t${i}]`);
  filters.push(`[${last}][t${i}]overlay=x='(W-w)/2':y='(H-h)/2':enable='between(t,${t.at},${t.at + t.d})':eof_action=pass[tl${i}]`); last = `tl${i}`;
});
filters.push(`[${last}]fade=t=in:st=0:d=0.7,fade=t=out:st=${(DURATION - .7).toFixed(3)}:d=0.7,trim=0:${DURATION},format=yuv420p[vout]`);
const audio = input(['-i', `${ROOT}/mix.wav`]);
const out = `${ROOT}/Fragdachse_Neu_${mode}.mp4`;
const args = ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', '[vout]', '-map', `${audio}:a`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '60',
  '-c:a', 'aac', '-b:a', '256k', '-t', String(DURATION), '-movflags', '+faststart', out];
const t0 = Date.now(), r = spawnSync('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'], maxBuffer: 1 << 26 });
if (r.status) throw Error('ffmpeg failed');
console.log(`${out} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
