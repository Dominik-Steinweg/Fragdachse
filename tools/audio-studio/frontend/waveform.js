// Pointer coordinates and form units are kept separate from the audio processor.
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const milliseconds = seconds => Math.round(seconds * 10000) / 10;

export function moveMarker(selection, marker, fraction) {
  const next = {...selection};
  const position = Math.round(clamp(fraction, 0, 1) * next.duration_ms * 10) / 10;
  const gap = Math.min(1, next.duration_ms);
  if (marker === 'start') next.start_ms = clamp(position, 0, Math.min(24000, next.end_ms - gap));
  if (marker === 'end') next.end_ms = clamp(position, next.start_ms + gap, next.duration_ms);
  const length = next.end_ms - next.start_ms;
  if (marker === 'fade-in') next.fade_in_ms = clamp(position - next.start_ms, 0, Math.min(1000, length));
  if (marker === 'fade-out') next.fade_out_ms = clamp(next.end_ms - position, 0, Math.min(5000, length));
  next.fade_in_ms = clamp(next.fade_in_ms, 0, Math.min(1000, length));
  next.fade_out_ms = clamp(next.fade_out_ms, 0, Math.min(5000, length));
  return next;
}

export function processingOverrides(values) {
  const overrides = {output_gain_db: Number(values.gain), auto_trim: values.auto_trim, crossfade_curve: values.curve};
  for (const [field, parameter, scale] of [
    ['start', 'start_seconds', 0.001], ['end', 'end_seconds', 0.001],
    ['fade_in', 'fade_in_ms', 1], ['fade_out', 'fade_out_ms', 1], ['crossfade', 'crossfade_ms', 1],
  ]) {
    if (values[field] !== '') overrides[parameter] = Number(values[field]) * scale;
  }
  return overrides;
}

export function drawWaveform(canvas, waveform, {selection, title = '', color = '#bbdd81'} = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, bottom = h - 28;
  ctx.clearRect(0, 0, w, h);
  ctx.font = '13px Segoe UI';
  ctx.fillStyle = '#a1b5ac';
  if (!waveform) { ctx.fillText(title || 'Zuerst einen RAW-Kandidaten auswählen.', 18, h / 2); return; }
  const duration = waveform.duration_seconds * 1000;
  // Both source and result use a fixed full-scale amplitude, never auto-normalized.
  const mid = (bottom + 30) / 2, amplitude = (bottom - 42) / 2;
  ctx.strokeStyle = '#31433e';ctx.beginPath();ctx.moveTo(0, mid);ctx.lineTo(w, mid);ctx.stroke();
  ctx.strokeStyle = color;ctx.beginPath();
  waveform.peaks.forEach((peak, i) => {
    const x = i * w / waveform.peaks.length, height = Math.min(1, peak) * amplitude;
    ctx.moveTo(x, mid - height);ctx.lineTo(x, mid + height);
  });ctx.stroke();
  for (let i = 0; i <= 5; i++) {
    const x = i * w / 5;
    ctx.fillStyle = '#a1b5ac';ctx.textAlign = i === 0 ? 'left' : i === 5 ? 'right' : 'center';
    ctx.fillText(`${Math.round(duration * i / 5)} ms`, x, h - 7);
  }
  ctx.textAlign = 'left';ctx.fillText(title, 12, 19);
  if (!selection) return;
  const xFor = ms => clamp(ms / duration, 0, 1) * w;
  const start = xFor(selection.start_ms), end = xFor(selection.end_ms);
  ctx.fillStyle = '#0009';ctx.fillRect(0, 28, start, bottom - 28);ctx.fillRect(end, 28, w - end, bottom - 28);
  const markers = [
    [start, 'Start', '#bbdd81', 35], [end, 'Ende', '#f6c784', 35],
  ];
  if (!selection.loop) {
    const fadeIn = xFor(selection.start_ms + selection.fade_in_ms), fadeOut = xFor(selection.end_ms - selection.fade_out_ms);
    ctx.strokeStyle = '#92ccf3';ctx.beginPath();ctx.moveTo(start, bottom);ctx.lineTo(fadeIn, 55);ctx.lineTo(fadeOut, 55);ctx.lineTo(end, bottom);ctx.stroke();
    markers.push([fadeIn, 'In', '#92ccf3', 60], [fadeOut, 'Out', '#d5a6ef', 84]);
  }
  for (const [x, label, color, y] of markers) {
    ctx.strokeStyle = color;ctx.beginPath();ctx.moveTo(x, y);ctx.lineTo(x, bottom);ctx.stroke();
    ctx.fillStyle = color;ctx.beginPath();ctx.arc(clamp(x, 5, w - 5), y, 5, 0, Math.PI * 2);ctx.fill();
    ctx.fillText(label, clamp(x + 8, 8, w - 45), y + 4);
  }
}
