import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { ANNOUNCER, announcerFilterGraph, dbGain, roomImpulse } from './announcer.mjs';

async function encode(args, input, executable = process.env.VOICE_FFMPEG ?? 'ffmpeg', { extraInput, logLevel = 'error' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-hide_banner', '-loglevel', logLevel, '-nostdin', ...args],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe', ...(extraInput ? ['pipe'] : [])] });
    const chunks = []; let size = 0; let error = ''; let oversized = false;
    const timer = setTimeout(() => { child.kill(); reject(new Error('Audio-Aufbereitung: Zeitlimit.')); }, 60000);
    child.on('error', () => { clearTimeout(timer); reject(new Error('FFmpeg fehlt. VOICE_FFMPEG auf die lokale Programmdatei setzen.')); });
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-12000); });
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 32 * 1024 * 1024) { oversized = true; child.kill(); } else chunks.push(chunk); });
    child.on('close', code => {
      clearTimeout(timer);
      if (oversized) reject(new Error('Audio-Aufbereitung: Ausgabe zu groß.'));
      else if (code === 0) resolve({ data: Buffer.concat(chunks), diagnostics: error });
      else reject(new Error(`Audio kann nicht verarbeitet werden: ${error}`));
    });
    child.stdin.on('error', () => {}); child.stdin.end(input);
    if (extraInput) { child.stdio[3].on('error', () => {}); child.stdio[3].end(extraInput); }
  });
}
export async function runEncoder(args, input, executable) { return (await encode(args, input, executable)).data; }

const capabilities = new Map();
export function requireAnnouncerFilters(list) {
  const names = new Set(list.split('\n').map(line => line.trim().split(/\s+/)[1]));
  const missing = ['highpass', 'lowpass', 'equalizer', 'deesser', 'acompressor', 'asoftclip', 'rubberband', 'afir', 'sidechaincompress', 'loudnorm', 'alimiter'].filter(name => !names.has(name));
  if (missing.length) throw new Error(`FFmpeg unterstützt den Action-Announcer nicht. Fehlende Filter: ${missing.join(', ')}. VOICE_FFMPEG auf eine vollständige FFmpeg-Version setzen.`);
}
export async function checkAnnouncerSupport(executable = process.env.VOICE_FFMPEG ?? 'ffmpeg') {
  if (!capabilities.has(executable)) {
    const pending = runEncoder(['-filters'], undefined, executable).then(bytes => requireAnnouncerFilters(bytes.toString()));
    capabilities.set(executable, pending);
    pending.catch(() => capabilities.delete(executable));
  }
  return capabilities.get(executable);
}
const pcmInput = rate => ['-f', 'f32le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0'];
const samplesOf = pcm => new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
export function audioStats(samples) {
  let energy = 0; let activeEnergy = 0; let peak = 0; let active = 0;
  for (const v of samples) {
    if (!Number.isFinite(v)) throw new Error('Audio enthält ungültige Samples. Bitte neu erzeugen.');
    energy += v * v; peak = Math.max(peak, Math.abs(v));
    if (Math.abs(v) >= ANNOUNCER.audio.silenceThreshold) { activeEnergy += v * v; active++; }
  }
  return { peak, rms: Math.sqrt(energy / (samples.length || 1)), activeRms: Math.sqrt(activeEnergy / (active || 1)), silentFraction: 1 - active / (samples.length || 1) };
}
async function decode(input, rate) {
  return samplesOf(await runEncoder(['-protocol_whitelist', 'file,pipe', '-i', 'pipe:0', '-t', '31', '-f', 'f32le', '-ac', '1', '-ar', String(rate), 'pipe:1'], input));
}
async function measureLoudness(pcm, rate) {
  const { diagnostics } = await encode([...pcmInput(rate), '-af', `loudnorm=I=${ANNOUNCER.audio.targetLufs}:TP=${ANNOUNCER.audio.limiterDb}:print_format=json`, '-f', 'null', '-'], pcm, undefined, { logLevel: 'info' });
  const json = diagnostics.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0];
  if (!json) throw new Error('FFmpeg konnte die Sprachlautheit nicht messen.');
  const value = Number(JSON.parse(json).input_i);
  return Number.isFinite(value) ? value : null;
}

export async function processAudio(input, output, { reference = false, start = 0, end = null } = {}) {
  if (!Number.isFinite(start) || start < 0 || (end !== null && (!Number.isFinite(end) || end <= start))) throw new Error('Ungültiger Schnittbereich.');
  const a = ANNOUNCER.audio; const rate = reference ? 24000 : a.sampleRate;
  if (!reference) await checkAnnouncerSupport();
  const samples = await decode(input, rate); audioStats(samples);
  const duration = samples.length / rate;
  if (!duration || duration >= 30) throw new Error('Audio muss kürzer als 30 Sekunden sein.');
  let from = Math.floor(start * rate); let to = Math.min(samples.length, Math.floor((end ?? duration) * rate));
  if (to <= from) throw new Error('Leerer Schnittbereich.');
  if (!reference) {
    let first = from; let last = to - 1;
    while (first < last && Math.abs(samples[first]) < a.silenceThreshold) first++;
    while (last > first && Math.abs(samples[last]) < a.silenceThreshold) last--;
    const padding = Math.round(a.edgePaddingSeconds * rate);
    from = Math.max(from, first - padding); to = Math.min(to, last + padding + 1);
  }
  const trimmed = samples.slice(from, to); const source = audioStats(trimmed);
  if (source.rms < 0.001) throw new Error('Aufnahme ist zu leise oder leer. Bitte neu aufnehmen.');
  const seconds = trimmed.length / rate;
  if (!reference && seconds > a.maxSpeechSeconds) throw new Error(`Sprache ist länger als ${a.maxSpeechSeconds.toLocaleString('de-DE')} Sekunden. Kürzen oder neu erzeugen, damit der Hall in den sechssekündigen Clip passt.`);
  const warnings = [];
  if (source.peak > 0.99) warnings.push('Mögliche Übersteuerung im Original');
  if (source.rms < 0.02) warnings.push('Leise Aufnahme');
  if (source.silentFraction > 0.5) warnings.push('Viel Stille');
  if (reference && (seconds < 10 || seconds > 20)) warnings.push('Empfohlen sind 10–20 Sekunden');
  const gain = reference ? 1 : Math.min(a.maxGain, a.inputRms / source.activeRms, 0.95 / source.peak);
  for (let i = 0; i < trimmed.length; i++) trimmed[i] *= gain;
  let pcm = Buffer.from(trimmed.buffer); let data; let finalSamples; let loudness = null; let outputGain = 1;
  if (reference) {
    data = await runEncoder([...pcmInput(rate), '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'], pcm);
    finalSamples = trimmed;
  } else {
    pcm = (await encode([...pcmInput(rate), '-f', 'f32le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:3',
      '-filter_complex', announcerFilterGraph(trimmed.length), '-map', '[out]', '-f', 'f32le', '-ar', String(rate), '-ac', '1', 'pipe:1'],
    pcm, undefined, { extraInput: roomImpulse() })).data;
    const wet = audioStats(samplesOf(pcm));
    loudness = await measureLoudness(pcm, rate);
    // The 400 ms loudness window includes the tail: very short speech uses active RMS instead.
    outputGain = Math.min(a.maxGain, seconds >= 0.4 && loudness !== null ? dbGain(a.targetLufs - loudness) : a.fallbackRms / wet.activeRms);
    if (!Number.isFinite(outputGain) || !wet.peak) throw new Error('Announcer-Bearbeitung ergab leeres Audio.');
    for (let attempt = 0; attempt < 2; attempt++) {
      data = await runEncoder([...pcmInput(rate), '-af', `volume=${outputGain},alimiter=limit=${dbGain(a.limiterDb)}:attack=${a.limiterAttackMs}:release=${a.limiterReleaseMs}:level=0:latency=1`,
        '-map_metadata', '-1', '-c:a', 'libvorbis', '-q:a', String(a.vorbisQuality), '-f', 'ogg', 'pipe:1'], pcm);
      finalSamples = await decode(data, rate);
      const final = audioStats(finalSamples);
      if (final.peak <= 0.95) break;
      if (attempt === 1) throw new Error('Export überschreitet den sicheren Spitzenpegel. Bitte neu erzeugen.');
      outputGain *= dbGain(a.limiterDb) / final.peak;
    }
    if (finalSamples.length / rate > a.maxClipSeconds || !finalSamples.length) throw new Error('Announcer-Export überschreitet sechs Sekunden. Sprache kürzen und erneut bearbeiten.');
  }
  const final = audioStats(finalSamples);
  await writeFile(output, data, { flag: 'wx' });
  return { duration: finalSamples.length / rate, bytes: data.length, peak: final.peak, rms: final.rms, gain, warnings,
    trimStart: from / rate, trimEnd: to / rate, sampleRate: rate,
    ...(!reference ? { processingVersion: ANNOUNCER.processingVersion, speechDuration: seconds, inputPeak: source.peak, measuredLufs: loudness, outputGain } : {}) };
}
