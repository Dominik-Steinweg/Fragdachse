// node sheet.mjs <video> [cols=4] [rows=2] [start] [end]
import { spawnSync } from 'node:child_process';
export function sheet(video, cols = 4, rows = 2, start = 0, end = null) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', video]).stdout.toString().trim();
  const n = end ?? (parseInt(probe, 10) - 1); const k = cols * rows;
  const picks = Array.from({ length: k }, (_, i) => Math.round(start + i * (n - start) / (k - 1)));
  const out = video.replace(/\.mp4$/, '_sheet.jpg');
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vf', `select='${picks.map(p => `eq(n\,${p})`).join('+')}',scale=640:360,tile=${cols}x${rows}`, '-frames:v', '1', out], { stdio: 'inherit' });
  console.log(out, 'frames', picks.join(','));
  return out;
}
if (process.argv[1].endsWith('sheet.mjs')) sheet(process.argv[2], Number(process.argv[3] ?? 4), Number(process.argv[4] ?? 2), Number(process.argv[5] ?? 0), process.argv[6] ? Number(process.argv[6]) : null);
