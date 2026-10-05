import { readFile } from 'node:fs/promises';

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export const ANNOUNCER = freeze(JSON.parse(await readFile(new URL('./announcer.json', import.meta.url), 'utf8')));

export function announcerDirection(event, hint = '') {
  if (!Object.hasOwn(ANNOUNCER.events, event)) throw new Error('Unbekannter Spielanlass für die Announcer-Regie.');
  return [ANNOUNCER.direction, ANNOUNCER.events[event], hint.trim()
    ? `Zusätzlicher Hinweis: ${hint.trim()}\nDieser Hinweis ergänzt die Betonung; die kraftvolle, klare Announcer-Darbietung hat immer Vorrang.` : ''].filter(Boolean).join('\n');
}

export const dbGain = db => 10 ** (db / 20);

/** Diffused, damped feedback-delay room. No noise bed, pitch modulation or external IR. */
export function roomImpulse() {
  const { sampleRate, reverb: r } = ANNOUNCER.audio;
  const offset = Math.round(r.predelaySeconds * sampleRate);
  const count = Math.round(r.decaySeconds * sampleRate);
  const ir = new Float32Array(offset + count);
  const diffusers = r.diffuserMs.map(ms => ({ buffer: new Float64Array(Math.round(ms * sampleRate / 1000)), position: 0 }));
  const delays = r.delayMs.map(ms => {
    const length = Math.round(ms * sampleRate / 1000);
    return { buffer: new Float64Array(length), position: 0, damped: 0, feedback: 10 ** (-3 * length / count) };
  });
  const channels = delays.length;
  if (channels < 2 || (channels & (channels - 1))) throw new Error('Hallnetz benötigt eine Zweierpotenz an Verzögerungen.');
  const scale = 1 / Math.sqrt(channels);
  const damping = Math.exp(-2 * Math.PI * r.dampingHz / sampleRate);
  const feedback = new Float64Array(channels);
  for (let i = 0; i < count; i++) {
    let excitation = i === 0 ? 1 : 0;
    for (const d of diffusers) {
      const output = d.buffer[d.position] - r.diffuserGain * excitation;
      d.buffer[d.position] = excitation + r.diffuserGain * output;
      d.position = (d.position + 1) % d.buffer.length;
      excitation = output;
    }
    let room = 0;
    for (let j = 0; j < channels; j++) {
      const d = delays[j]; const sample = d.buffer[d.position];
      room += sample * (j % 2 ? -scale : scale);
      d.damped = (1 - damping) * sample + damping * d.damped;
      feedback[j] = d.damped;
    }
    // Orthonormal Hadamard mixing diffuses energy without amplifying the feedback loop.
    for (let stride = 1; stride < channels; stride *= 2) {
      for (let base = 0; base < channels; base += stride * 2) {
        for (let j = base; j < base + stride; j++) {
          const left = feedback[j]; const right = feedback[j + stride];
          feedback[j] = left + right; feedback[j + stride] = left - right;
        }
      }
    }
    for (let j = 0; j < channels; j++) {
      const d = delays[j];
      d.buffer[d.position] = excitation * scale + feedback[j] * scale * d.feedback;
      d.position = (d.position + 1) % d.buffer.length;
    }
    // Fade the residual response before the fixed export boundary, never the spoken words.
    ir[offset + i] = room * Math.min(1, (count - i - 1) / (sampleRate * 0.035));
  }
  for (const [time, gain] of r.reflections) ir[offset + Math.round(time * sampleRate)] += gain;
  const energy = Math.sqrt(ir.reduce((sum, v) => sum + v * v, 0));
  for (let i = 0; i < ir.length; i++) ir[i] /= energy;
  return Buffer.from(ir.buffer);
}

export function announcerRoomGraph() {
  const r = ANNOUNCER.audio.reverb; const duck = r.duck;
  return [
    `[send][1:a]afir=dry=1:wet=1:irnorm=-1:irgain=1:minp=64:maxp=1024,highpass=f=${r.highpassHz},lowpass=f=${r.lowpassHz}[ambience]`,
    `[ambience][key]sidechaincompress=threshold=${duck.threshold}:ratio=${duck.ratio}:attack=${duck.attackMs}:release=${duck.releaseMs}:knee=${duck.knee}:level_sc=${duck.sidechainGain}:mix=${duck.mix}[room]`,
  ].join(';');
}

export function announcerFilterGraph(speechSamples) {
  const a = ANNOUNCER.audio; const c = a.compressor; const d = a.distortion; const o = a.octave; const r = a.reverb;
  const total = speechSamples + Math.ceil((r.predelaySeconds + r.decaySeconds) * a.sampleRate);
  return [
    `[0:a]highpass=f=${a.highpassHz},equalizer=f=${a.mudHz}:t=q:w=0.8:g=${a.mudDb},equalizer=f=${a.presenceHz}:t=q:w=0.8:g=${a.presenceDb},deesser=i=${a.deesserIntensity},acompressor=threshold=${c.threshold}:ratio=${c.ratio}:attack=${c.attackMs}:release=${c.releaseMs}:knee=${c.knee},asplit=4[clean][drive][low][space]`,
    // Filter before saturation too: sibilants and bass must not drive broadband distortion.
    `[drive]highpass=f=${d.highpassHz},lowpass=f=${d.lowpassHz},volume=${d.drive},asoftclip=type=tanh:threshold=${d.threshold}:output=${d.output}:oversample=${d.oversample},lowpass=f=${d.lowpassHz}[grit]`,
    `[low]rubberband=tempo=1:pitch=${o.pitch}:transients=mixed:formant=preserved:pitchq=quality,highpass=f=${o.highpassHz},lowpass=f=${o.lowpassHz}:p=2[octave]`,
    `[clean][grit][octave]amix=inputs=3:weights='${dbGain(a.cleanMixDb)} ${dbGain(d.mixDb)} ${dbGain(o.mixDb)}':normalize=0:duration=longest,apad=whole_len=${total},atrim=end_sample=${total}[dry]`,
    // Reverb only receives the unshifted voice; duck it under words, release into their gaps.
    `[space]apad=whole_len=${total},atrim=end_sample=${total},asplit=2[send][key]`,
    announcerRoomGraph(),
    `[dry][room]amix=inputs=2:weights='1 ${dbGain(r.mixDb)}':normalize=0:duration=first,atrim=end_sample=${total},afade=t=out:st=${(total / a.sampleRate - 0.01).toFixed(6)}:d=0.01[out]`,
  ].join(';');
}
