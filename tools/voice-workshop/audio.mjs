import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

export function runEncoder(args, input, executable = process.env.VOICE_FFMPEG ?? 'ffmpeg') {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { windowsHide: true });
    const chunks = []; let size = 0; let error = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Audio-Aufbereitung: Zeitlimit.')); }, 60000);
    child.on('error', () => { clearTimeout(timer); reject(new Error('FFmpeg fehlt. VOICE_FFMPEG auf die lokale Programmdatei setzen.')); });
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-2000); });
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 32 * 1024 * 1024) child.kill(); else chunks.push(chunk); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`Audio kann nicht verarbeitet werden: ${error}`)); });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
export async function processAudio(input, output, { reference = false, start = 0, end = null } = {}) {
  if (!Number.isFinite(start) || start < 0 || (end !== null && (!Number.isFinite(end) || end <= start))) throw new Error('Ungültiger Schnittbereich.');
  const pcm = await runEncoder(['-protocol_whitelist', 'file,pipe', '-i', 'pipe:0', '-t', '31', '-f', 'f32le', '-ac', '1', '-ar', '24000', 'pipe:1'], input);
  const samples = new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
  const duration = samples.length / 24000;
  if (!duration || duration >= 30) throw new Error('Audio muss kürzer als 30 Sekunden sein.');
  let from = Math.floor(start * 24000); let to = Math.min(samples.length, Math.floor((end ?? duration) * 24000));
  if (to <= from) throw new Error('Leerer Schnittbereich.');
  if (!reference) {
    let first = from; let last = to - 1;
    while (first < last && Math.abs(samples[first]) < 0.002) first++;
    while (last > first && Math.abs(samples[last]) < 0.002) last--;
    from = Math.max(from, first - 1920); to = Math.min(to, last + 1921);
  }
  const trimmed = samples.slice(from, to);
  let energy = 0; let peak = 0; let silent = 0;
  for (const value of trimmed) { energy += value * value; peak = Math.max(peak, Math.abs(value)); if (Math.abs(value) < 0.002) silent++; }
  const rms = Math.sqrt(energy / trimmed.length);
  if (rms < 0.001 || !Number.isFinite(rms)) throw new Error('Aufnahme ist zu leise oder leer. Bitte neu aufnehmen.');
  const seconds = trimmed.length / 24000;
  if (!reference && seconds > 6) throw new Error('Spruch ist länger als sechs Sekunden. Kürzen oder neu erzeugen.');
  const warnings = [];
  if (peak > 0.99) warnings.push('Mögliche Übersteuerung');
  if (rms < 0.02) warnings.push('Leise Aufnahme');
  if (silent / trimmed.length > 0.5) warnings.push('Viel Stille');
  if (reference && (seconds < 10 || seconds > 20)) warnings.push('Empfohlen sind 10–20 Sekunden');
  const gain = reference ? 1 : Math.min(4, 0.1 / rms, 0.95 / peak);
  for (let i = 0; i < trimmed.length; i++) trimmed[i] *= gain;
  const data = await runEncoder(['-f', 'f32le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0',
    ...(reference ? ['-c:a', 'pcm_s16le', '-f', 'wav'] : ['-c:a', 'libvorbis', '-q:a', '5', '-f', 'ogg']), 'pipe:1'], Buffer.from(trimmed.buffer));
  await writeFile(output, data, { flag: 'wx' });
  return { duration: seconds, bytes: data.length, peak, rms, gain, warnings, trimStart: from / 24000, trimEnd: to / 24000 };
}
