// node shoot.mjs <shot> [frames]  – records one shot master, then writes a frame sheet for review.
// node shoot.mjs --sheet <shot>   – only rebuilds the sheet.
import { shots } from './shots.mjs';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { ROOT, FPS, MASTERS, DRAFT } from './harness.mjs';
import { mkdirSync } from 'node:fs';
const args = process.argv.slice(2), sheetOnly = args[0] === '--sheet';
const [name, frames] = sheetOnly ? args.slice(1) : args;
if (!sheetOnly) {
  if (!shots[name]) throw Error('unknown shot ' + name + '; known: ' + Object.keys(shots).join(', '));
  // Shots may ask for a new take (e.g. a random event landed in a bad spot).
  for (let take = 1; ; take++) {
    try { await shots[name](frames ? +frames : undefined); break; }
    catch (e) { if (!/^retry:/.test(e.message) || take >= 6) throw e; console.log(`  take ${take}: ${e.message}`); }
  }
}
// Review sheet: one frame every 0.5 s, 6 columns, with timestamps.
const total = JSON.parse(readFileSync(`${MASTERS}/${name}.json`, 'utf8')).frames;
const rows = Math.ceil(total / FPS * 2 / 6);
mkdirSync(`${ROOT}/review`, { recursive: true });
const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${MASTERS}/${name}.mp4`, '-vf',
  `fps=2,scale=640:-1,drawtext=text='%{pts\\:hms}':x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.5,tile=6x${rows}:padding=4`,
  '-frames:v', '1', `${ROOT}/review/${name}${DRAFT ? '-draft' : ''}.jpg`]);
if (r.status) console.log(String(r.stderr));
