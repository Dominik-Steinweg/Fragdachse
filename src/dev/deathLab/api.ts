import type { DeathLabScene } from './Scene';
import { C1_DEATH_TUNING, DEATH_TUNING_DEFAULTS, deathPhaseBands, resolveDeathTuning } from '../../effects/gpu/DeathTuning';
import { bool, finite, keys, object, resolveSettings, fixtureSnapshot } from './State';
import { contactSheet, decodePng, downloadExport, frameTimes, type CapturedFrame, type LabExport } from './Export';

interface Baseline { metadata: Record<string, unknown>; frames: CapturedFrame[]; images: HTMLImageElement[] }
declare global { interface Window { deathLab?: DeathLabApi } }

/** UI and automation use the same validated, serialized command boundary. No gameplay bridge. */
export class DeathLabApi {
  readonly version = 1;
  private ready = false;
  private busy = false;
  private disposed = false;
  private error: string | null = null;
  private identity: Record<string, unknown> = {};
  private baseline: Baseline | null = null;
  private requestedTimeMs = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private readonly readyPromise: Promise<void>;

  constructor(private readonly scene: DeathLabScene, identity: Promise<Record<string, unknown>>) {
    this.readyPromise = identity.then(value => { this.identity = value; this.ready = true; this.notify(); })
      .catch(error => { this.error = String(error); this.notify(); throw error; });
    void this.readyPromise.catch(() => {});
  }
  async whenReady(): Promise<ReturnType<DeathLabApi['status']>> { await this.readyPromise; return this.status(); }
  status() {
    return { ready: this.ready, busy: this.busy, error: this.error,
      playing: this.scene.playback.playing, speed: this.scene.playback.speed,
      timeMs: this.scene.playback.timeMs, requestedTimeMs: this.requestedTimeMs,
      settings: structuredClone(this.scene.settings), tuning: { ...this.scene.tuning },
      phaseBands: deathPhaseBands(this.scene.tuning),
      baseline: this.baseline ? { metadata: structuredClone(this.baseline.metadata), timesMs: this.baseline.frames.map(f => f.timeMs) } : null };
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); listener(); return () => this.listeners.delete(listener); }
  private notify(): void { for (const listener of this.listeners) listener(); }
  dispose(): void { this.disposed = true; this.scene.playback.playing = false; this.baseline = null; this.listeners.clear(); }
  private readonly assertActive = (): void => {
    if (this.disposed) throw new Error('Death-Lab wurde beendet.');
  };

  run(command: unknown): Promise<unknown> {
    // Clone now: callers cannot mutate a queued command while a capture is pending.
    const input = structuredClone(command);
    const work = this.queue.then(async () => {
      await this.readyPromise;
      this.assertActive();
      this.busy = true; this.error = null; this.notify();
      try { return await this.execute(object(input)); }
      catch (error) { this.error = String(error); throw error; }
      finally { this.busy = false; this.notify(); }
    });
    this.queue = work.catch(() => {});
    return work;
  }

  private metadata(): Record<string, unknown> {
    return { schema: 1, capturedAt: new Date().toISOString(), ...structuredClone(this.identity),
      settings: structuredClone(this.scene.settings), tuning: { ...this.scene.tuning },
      snapshot: fixtureSnapshot(this.scene.settings), phaseBands: deathPhaseBands(this.scene.tuning),
      timing: 'manual GPU+pool+ghost+postfx; reset and deterministic replay on seek',
      audio: 'disabled; no morph-stage audio in production' };
  }
  private baselineIndex(time: number): number {
    if (!this.baseline) return -1;
    let best = 0;
    for (let i = 1; i < this.baseline.frames.length; i++) {
      if (Math.abs(this.baseline.frames[i].timeMs - time) < Math.abs(this.baseline.frames[best].timeMs - time)) best = i;
    }
    return best;
  }
  private seek(time: number): void {
    this.requestedTimeMs = time;
    const index = this.baselineIndex(time);
    // A and B are always shown at the SAME sampled time, never nearest A against unsnapped B.
    this.scene.playback.seek(index < 0 ? time : this.baseline!.frames[index].timeMs);
  }
  drawBaseline(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const index = this.baselineIndex(this.scene.playback.timeMs);
    if (index >= 0) ctx.drawImage(this.baseline!.images[index], 0, 0, canvas.width, canvas.height);
  }
  tick(deltaMs: number): void {
    if (!this.ready || this.busy || this.disposed || !this.scene.playback.playing) return;
    if (this.baseline) {
      const requested = Math.min(1500, this.requestedTimeMs + Math.max(0, deltaMs) * this.scene.playback.speed);
      const sampled = this.baseline.frames[this.baselineIndex(requested)].timeMs;
      if (sampled !== this.scene.playback.timeMs) this.scene.playback.seek(sampled);
      this.requestedTimeMs = requested;
      if (requested === 1500) this.scene.playback.playing = false;
    } else {
      this.scene.playback.tick(deltaMs); this.requestedTimeMs = this.scene.playback.timeMs;
    }
    this.notify();
  }

  private async captureFrames(times: readonly number[]): Promise<CapturedFrame[]> {
    const frames: CapturedFrame[] = [];
    for (const timeMs of times) {
      this.assertActive();
      this.scene.playback.seek(timeMs);
      const png = await this.scene.capture();
      this.assertActive();
      frames.push({ timeMs: this.scene.playback.timeMs, png });
    }
    return frames;
  }

  private async execute(c: Record<string, unknown>): Promise<unknown> {
    switch (c.action) {
      case 'status': keys(c, ['action']); return this.status();
      case 'configure': {
        keys(c, ['action', 'values']);
        const settings = resolveSettings(c.values, this.scene.settings);
        this.scene.playback.playing = false;
        this.scene.applySettings(settings);
        // A fixture/quality/view change makes image comparison misleading; the old A is explicitly invalidated.
        this.baseline = null; this.seek(this.scene.playback.timeMs); break;
      }
      case 'tuning': {
        keys(c, ['action', 'values', 'reset', 'preset']);
        if (c.reset !== undefined && c.reset !== true) throw new Error('reset: true erwartet.');
        if (c.reset === true && c.values !== undefined) throw new Error('reset oder values angeben.');
        if (c.preset !== undefined && (c.preset !== 'c1' || c.values !== undefined || c.reset !== undefined)) {
          throw new Error('preset: "c1" ohne values/reset angeben.');
        }
        const tuning = c.preset === 'c1' ? C1_DEATH_TUNING
          : c.reset === true ? DEATH_TUNING_DEFAULTS : resolveDeathTuning(c.values, this.scene.tuning);
        this.scene.playback.playing = false;
        this.scene.applyTuning(tuning); this.seek(this.scene.playback.timeMs); break;
      }
      case 'seek': keys(c, ['action', 'timeMs']); this.scene.playback.playing = false; this.seek(finite(c.timeMs, 0, 1500)); break;
      case 'step': {
        keys(c, ['action', 'deltaMs']);
        const delta = c.deltaMs === undefined ? 25 : finite(c.deltaMs, -1500, 1500);
        this.scene.playback.playing = false; this.seek(Math.max(0, Math.min(1500, this.scene.playback.timeMs + delta))); break;
      }
      case 'play': {
        keys(c, ['action', 'playing', 'speed']);
        const playing = c.playing === undefined ? true : bool(c.playing);
        const speed = c.speed === undefined ? this.scene.playback.speed : finite(c.speed, 0.1, 1);
        if (![0.1, 0.25, 0.5, 1].includes(speed)) throw new Error('Tempo: 0.1, 0.25, 0.5 oder 1.');
        if (playing && this.scene.playback.timeMs >= 1500) this.seek(0);
        this.scene.playback.speed = speed; this.scene.playback.playing = playing; break;
      }
      case 'freeze': {
        keys(c, ['action', 'frames', 'stepMs']);
        const times = frameTimes(c.frames === undefined ? 61 : finite(c.frames, 2, 181),
          c.stepMs === undefined ? 25 : finite(c.stepMs, 1, 1500));
        if (Math.abs(times[times.length - 1] - 1500) > 1e-6) throw new Error('Baseline muss 0–1500 ms vollständig abdecken, z.B. 61 × 25 ms.');
        const saved = this.scene.playback.timeMs; this.scene.playback.playing = false;
        try {
          const metadata = this.metadata(), frames = await this.captureFrames(times);
          const images = await Promise.all(frames.map(f => decodePng(f.png)));
          this.assertActive();
          this.baseline = { metadata, frames, images };
        } finally { if (!this.disposed) this.seek(saved); }
        break;
      }
      case 'clearBaseline': keys(c, ['action']); this.baseline = null; break;
      case 'export': {
        keys(c, ['action', 'frames', 'stepMs', 'download', 'includeBaseline']);
        const times = frameTimes(c.frames === undefined ? 60 : finite(c.frames, 1, 181),
          c.stepMs === undefined ? 25 : finite(c.stepMs, 1, 1500));
        const download = c.download === undefined ? false : bool(c.download);
        const includeBaseline = c.includeBaseline === undefined ? true : bool(c.includeBaseline);
        let reference: CapturedFrame[] | undefined;
        if (includeBaseline && this.baseline) {
          reference = times.map(time => {
            const frame = this.baseline!.frames.find(f => Math.abs(f.timeMs - time) < 1e-6);
            if (!frame) throw new Error('A besitzt diesen Zeitschritt nicht. Passende Baseline aufnehmen oder includeBaseline:false.');
            return { ...frame };
          });
        }
        const saved = this.scene.playback.timeMs; this.scene.playback.playing = false;
        try {
          const frames = await this.captureFrames(times);
          const result: LabExport = { metadata: { ...this.metadata(), timesMs: times },
            frames, contactSheet: await contactSheet(frames) };
          this.assertActive();
          if (reference) result.baseline = { metadata: structuredClone(this.baseline!.metadata), frames: reference,
            contactSheet: await contactSheet(reference) };
          this.assertActive();
          if (download) await downloadExport(result, this.assertActive);
          return result;
        } finally { if (!this.disposed) this.seek(saved); }
      }
      default: throw new Error('action: status, configure, tuning, seek, step, play, freeze, clearBaseline oder export.');
    }
    return this.status();
  }
}
