export interface AudioSelection { start: number; end: number }
export interface ReferenceDraft { blob: Blob; buffer: AudioBuffer; selection: AudioSelection }
export type CutMarker = 'start' | 'end';

/** Keep the markers ordered and leave at least one millisecond of audio. */
export function moveCut(selection: AudioSelection, marker: CutMarker, seconds: number, duration: number): AudioSelection {
  if (!Number.isFinite(seconds) || !Number.isFinite(duration) || duration <= 0) return selection;
  const gap = Math.min(.001, duration);
  const position = Math.max(0, Math.min(duration, seconds));
  return marker === 'start'
    ? { start: Math.min(position, selection.end - gap), end: selection.end }
    : { start: selection.start, end: Math.max(position, selection.start + gap) };
}

/** Peak bins use a fixed full-scale amplitude, also for quiet recordings. */
export function waveformPeaks(samples: Float32Array, bins = 1000): Float32Array {
  const peaks = new Float32Array(Math.min(bins, samples.length));
  for (let i = 0; i < peaks.length; i++) {
    const from = Math.floor(i * samples.length / peaks.length);
    const to = Math.floor((i + 1) * samples.length / peaks.length);
    for (let j = from; j < to; j++) peaks[i] = Math.max(peaks[i], Math.abs(samples[j]));
  }
  return peaks;
}

export class WaveformEditor {
  private canvas = document.createElement('canvas');
  private summary = document.createElement('p');
  private start = document.createElement('input');
  private end = document.createElement('input');
  private marker: CutMarker = 'start';
  private markerButtons: HTMLButtonElement[] = [];
  private buttons: HTMLButtonElement[] = [];
  private draft: ReferenceDraft | null = null;
  private peaks = new Float32Array();
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private playbackRevision = 0;
  private frame = 0;
  private disposed = false;
  private generation = 0;
  private pending = false;
  private locked = false;
  private dragging: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private onChange: (draft: ReferenceDraft) => void;
  private onError: (text: string) => void;
  get busy(): boolean { return this.pending || this.locked || this.source !== null || this.dragging !== null; }
  setLocked(locked: boolean): void { this.locked = locked; this.stop(); this.draw(); }

  constructor(parent: HTMLElement, draft: ReferenceDraft | null, onChange: (draft: ReferenceDraft) => void, onError: (text: string) => void) {
    this.onChange = onChange; this.onError = onError;
    const root = document.createElement('section'); root.className = 'wave-editor'; parent.append(root);
    const help = document.createElement('details'); const helpTitle = document.createElement('summary'); helpTitle.textContent = 'Schnittsteuerung';
    const helpText = document.createElement('p'); helpText.textContent = 'Start und Ende ziehen oder eine Schnittmarke wählen und in die Wellenform klicken. Pfeiltasten: 10 ms, mit Umschalt: 100 ms.';
    help.append(helpTitle, helpText); root.append(help);
    const toolbar = document.createElement('div'); toolbar.className = 'row'; root.append(toolbar);
    for (const marker of ['start', 'end'] as const) {
      const b = this.button(toolbar, marker === 'start' ? 'Start setzen' : 'Ende setzen', () => this.selectMarker(marker));
      this.markerButtons.push(b);
    }
    this.canvas.width = 1100; this.canvas.height = 240; this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Referenz-Wellenform mit Schnittmarken'); root.append(this.canvas);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(entries => {
        const width = Math.round(entries[0].contentRect.width);
        if (width > 0 && this.canvas.width !== width) { this.canvas.width = width; this.draw(); }
      });
      this.resizeObserver.observe(this.canvas);
    }
    this.canvas.onpointerdown = event => {
      if (event.button !== 0 || !this.draft || this.pending || this.locked) return;
      const rect = this.canvas.getBoundingClientRect(); const x = event.clientX - rect.left;
      const startX = this.draft.selection.start / this.draft.buffer.duration * rect.width;
      const endX = this.draft.selection.end / this.draft.buffer.duration * rect.width;
      if (Math.min(Math.abs(x - startX), Math.abs(x - endX)) < 18) this.selectMarker(Math.abs(x - startX) < Math.abs(x - endX) ? 'start' : 'end');
      this.dragging = event.pointerId; this.canvas.setPointerCapture(event.pointerId); this.canvas.focus(); this.fromPointer(event); event.preventDefault();
    };
    this.canvas.onpointermove = event => { if (this.dragging === event.pointerId) this.fromPointer(event); };
    this.canvas.onpointerup = this.canvas.onpointercancel = event => {
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      this.dragging = null;
    };
    this.canvas.onlostpointercapture = () => { this.dragging = null; };
    this.canvas.onkeydown = event => {
      if (!this.draft || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      this.move(this.marker, this.draft.selection[this.marker] + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? .1 : .01)); event.preventDefault();
    };
    const fields = document.createElement('div'); fields.className = 'row'; root.append(fields);
    for (const [marker, input, text] of [['start', this.start, 'Start (s)'], ['end', this.end, 'Ende (s)']] as const) {
      const label = document.createElement('label'); label.textContent = text; input.type = 'number'; input.min = '0'; input.step = '.01';
      input.onfocus = () => this.stop();
      input.onchange = () => this.move(marker, input.valueAsNumber); label.append(input); fields.append(label);
    }
    this.button(fields, 'Alles auswählen', () => { if (this.draft) { this.draft.selection = { start: 0, end: this.draft.buffer.duration }; this.changed(); } });
    root.append(this.summary);
    const playback = document.createElement('div'); playback.className = 'row'; root.append(playback);
    this.button(playback, 'Auswahl anhören', () => { void this.play(false).catch(error => this.onError(error.message)); });
    this.button(playback, 'Ganze Aufnahme anhören', () => { void this.play(true).catch(error => this.onError(error.message)); });
    this.button(playback, 'Wiedergabe stoppen', () => { this.stop(); this.draw(); });
    this.selectMarker('start'); if (draft) this.setDraft(draft); else this.draw();
  }
  private button(parent: HTMLElement, text: string, action: () => void): HTMLButtonElement {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = action; parent.append(b); this.buttons.push(b); return b;
  }
  private selectMarker(marker: CutMarker): void {
    this.marker = marker; this.markerButtons.forEach((b, index) => b.setAttribute('aria-pressed', String(index === (marker === 'start' ? 0 : 1))));
  }
  private fromPointer(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    if (this.draft && rect.width > 0) this.move(this.marker, (event.clientX - rect.left) / rect.width * this.draft.buffer.duration);
  }
  private move(marker: CutMarker, position: number): void {
    if (!this.draft || this.pending || this.locked) return;
    this.draft.selection = moveCut(this.draft.selection, marker, position, this.draft.buffer.duration); this.changed();
  }
  private changed(): void { this.stop(); if (this.draft) this.onChange(this.draft); this.draw(); }
  private setDraft(draft: ReferenceDraft): void {
    this.draft = draft; this.peaks = waveformPeaks(draft.buffer.getChannelData(0)); this.draw();
  }
  async load(blob: Blob): Promise<void> {
    if (this.disposed || this.locked) return;
    if (blob.size > 28 * 1024 * 1024) throw new Error('Referenzdatei ist zu groß.');
    const generation = ++this.generation; this.pending = true; this.stop(); this.draw();
    try {
      this.context ??= new AudioContext();
      const buffer = await this.context.decodeAudioData(await blob.arrayBuffer());
      if (this.disposed || generation !== this.generation) return;
      if (!buffer.duration || buffer.duration >= 30) throw new Error('Referenz muss kürzer als 30 Sekunden sein.');
      const draft = { blob, buffer, selection: { start: 0, end: buffer.duration } };
      this.setDraft(draft); this.onChange(draft);
    } catch (error) {
      if (!this.disposed && generation === this.generation) throw error;
    } finally { if (!this.disposed && generation === this.generation) { this.pending = false; this.draw(); } }
  }
  private async play(full: boolean): Promise<void> {
    if (!this.draft || this.pending || this.locked || this.disposed) return;
    this.stop(); this.context ??= new AudioContext();
    const generation = this.generation;
    const playbackRevision = this.playbackRevision;
    await this.context.resume();
    if (this.disposed || generation !== this.generation || playbackRevision !== this.playbackRevision) return;
    this.stop();
    const { buffer, selection } = this.draft;
    const start = full ? 0 : selection.start; const end = full ? buffer.duration : selection.end;
    const source = this.context.createBufferSource(); source.buffer = buffer; source.connect(this.context.destination); this.source = source;
    source.onended = () => { source.disconnect(); if (this.source === source) { this.source = null; cancelAnimationFrame(this.frame); this.draw(); } };
    const began = this.context.currentTime; source.start(0, start, end - start);
    const tick = () => { if (this.source !== source || this.disposed) return; this.draw(Math.min(end, start + this.context!.currentTime - began)); this.frame = requestAnimationFrame(tick); }; tick();
  }
  stop(): void { this.playbackRevision++; cancelAnimationFrame(this.frame); const source = this.source; this.source = null; if (source) { source.stop(); source.disconnect(); } }
  private draw(cursor?: number): void {
    if (this.disposed) return;
    for (const b of this.buttons) b.disabled = !this.draft || this.pending || this.locked;
    this.start.disabled = this.end.disabled = !this.draft || this.pending || this.locked;
    const ctx = this.canvas.getContext('2d'); if (!ctx) return;
    const w = this.canvas.width, h = this.canvas.height, left = 12, width = w - left * 2;
    // Time coordinates occupy the full canvas, matching pointer and marker positions.
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#101712'; ctx.fillRect(0, 0, w, h); ctx.font = '13px system-ui';
    if (!this.draft) { ctx.fillStyle = '#b2bcae'; ctx.fillText(this.pending ? 'Wellenform wird geladen …' : 'Aufnehmen oder Datei wählen.', left, h / 2, width); this.summary.textContent = ''; return; }
    const { buffer, selection } = this.draft; const xFor = (seconds: number) => seconds / buffer.duration * w;
    ctx.strokeStyle = '#9bc778'; ctx.beginPath();
    this.peaks.forEach((peak, i) => { const x = i / this.peaks.length * w; const amplitude = Math.min(1, peak) * 75; ctx.moveTo(x, 124 - amplitude); ctx.lineTo(x, 124 + amplitude); }); ctx.stroke();
    const from = xFor(selection.start), to = xFor(selection.end);
    ctx.fillStyle = '#0009'; ctx.fillRect(0, 38, from, 166); ctx.fillRect(to, 38, w - to, 166);
    ctx.fillStyle = '#bddd8118'; ctx.fillRect(from, 38, to - from, 166);
    for (const [x, label, color] of [[from, 'Start', '#bbdd81'], [to, 'Ende', '#f6c784']] as const) {
      ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, 36); ctx.lineTo(x, 204); ctx.stroke();
      ctx.fillStyle = color; ctx.fillRect(Math.max(0, Math.min(w - 12, x - 6)), 28, 12, 20);
      ctx.fillText(label, Math.max(left, Math.min(w - 70, x - 25)), 22);
    }
    ctx.lineWidth = 1; ctx.fillStyle = '#b2bcae';
    const ticks = w < 400 ? 3 : 5;
    for (let i = 0; i <= ticks; i++) { ctx.textAlign = i === 0 ? 'left' : i === ticks ? 'right' : 'center'; ctx.fillText(`${(buffer.duration * i / ticks).toFixed(1)} s`, left + width * i / ticks, h - 8); } ctx.textAlign = 'left';
    if (cursor !== undefined) { ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(xFor(cursor), 38); ctx.lineTo(xFor(cursor), 204); ctx.stroke(); }
    this.start.value = selection.start.toFixed(3); this.end.value = selection.end.toFixed(3); this.start.max = this.end.max = String(buffer.duration);
    this.summary.textContent = this.pending ? 'Wellenform wird geladen …' : `Auswahl: ${selection.start.toFixed(2)}–${selection.end.toFixed(2)} s · ${(selection.end - selection.start).toFixed(2)} s von ${buffer.duration.toFixed(2)} s`;
  }
  destroy(): void { this.disposed = true; this.generation++; this.resizeObserver?.disconnect(); this.stop(); void this.context?.close(); this.context = null; }
}
