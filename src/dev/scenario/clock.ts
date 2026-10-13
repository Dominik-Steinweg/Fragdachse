import { visualTest } from './visualTest';

/** Only installed in the isolated offline tab. Real wall timers/workers are NOT deterministic. */
export class ScenarioClock {
  private isPaused = false;
  get paused(): boolean { return this.isPaused; }
  set paused(value: boolean) {
    if (value) this.cancelFastForward();
    this.isPaused = value; if (!value) this.queuedSteps = 0;
  }
  speed = 1;
  private queuedSteps = 0;
  private settling = false;
  private visualFrame = 0;
  /** The visual runner pumps loading/render work without advancing presentation time. */
  preparing = visualTest.enabled;
  holdLoadingTime = () => true;
  get pendingSteps(): number { return this.queuedSteps; }
  private elapsed = 0;
  private fixedFrames = 0;
  private simulationTime: number | null = null;
  private readonly nativeNow = Date.now;
  private readonly epoch = Date.now();
  private readonly original: (time: number, delta: number) => void;
  private readonly callback: (time: number, delta: number) => void;
  private forwarding: { remaining: () => number; resolve: () => void; reject: (error: Error) => void } | null = null;
  get fastForwarding(): boolean { return this.forwarding !== null; }

  constructor(private readonly loop: { callback: (time: number, delta: number) => void }) {
    this.original = loop.callback;
    // Date.now's integer contract also underpins world/projectile revision IDs.
    Date.now = () => this.epoch + Math.floor(this.elapsed);
    const tick = (time: number, delta: number, forwardStep?: number) => {
      this.simulationTime ??= visualTest.enabled ? 0 : time;
      if (this.paused && this.queuedSteps === 0) return;
      const step = forwardStep ?? ((this.paused && this.settling) || (this.preparing && this.holdLoadingTime()) ? 0
        : this.paused || visualTest.enabled ? 1000 / 60 : Math.min(delta, 100) * this.speed);
      if (this.paused) this.queuedSteps--;
      if (visualTest.enabled) {
        // Multiplication keeps integral frame boundaries independent of how many loading
        // frames preceded them. Repeated += 1000/60 can floor Date.now one ms early.
        if (step > 0) this.fixedFrames++;
        this.elapsed = this.fixedFrames * 1000 / 60;
        this.simulationTime = this.elapsed;
      } else {
        this.elapsed += step;
        this.simulationTime += step;
      }
      if (visualTest.enabled) {
        // Loading can take a different number of frames. Effect randomness starts at the
        // ready barrier, and zero-delta worker publication must not consume another frame.
        if (this.preparing) this.visualFrame = 0;
        else if (step > 0) this.visualFrame++;
        visualTest.reseed(this.preparing ? Math.round(this.elapsed * 60 / 1000) : this.visualFrame);
      }
      this.original(this.simulationTime, step);
    };
    this.callback = (time, delta) => {
      if (!this.forwarding) { tick(time, delta); return; }
      // Bounded batches yield to input, workers and the browser between simulation steps.
      // Every owner receives the same ordinary delta, including independent mission clocks.
      for (let frame = 0; frame < 30 && this.forwarding; frame++) {
        const pending = this.forwarding;
        try {
          const remaining = pending.remaining();
          if (!Number.isFinite(remaining)) throw new Error('Invalid fast-forward target');
          if (remaining <= 0) {
            this.forwarding = null; pending.resolve(); return;
          }
          tick(time, delta, visualTest.enabled ? 1000 / 60 : Math.min(1000 / 60, remaining));
        } catch (error) {
          this.forwarding = null;
          pending.reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
      }
    };
    loop.callback = this.callback;
  }
  fastForward(remaining: () => number): Promise<void> {
    if (this.forwarding || this.queuedSteps || this.preparing) throw new Error('Wait for pending scenario work.');
    this.paused = false;
    return new Promise((resolve, reject) => { this.forwarding = { remaining, resolve, reject }; });
  }
  cancelFastForward(): void {
    const pending = this.forwarding;
    this.forwarding = null;
    pending?.reject(new Error('Fast-forward cancelled.'));
  }
  step(frames = 1): void {
    if (!Number.isInteger(frames) || frames < 1 || frames > 600) throw new Error('Schritte: 1…600 Frames.');
    this.paused = true;
    this.settling = false;
    this.queuedSteps = Math.min(600, this.queuedSteps + frames);
  }
  settle(frames: number): void {
    if (this.queuedSteps) throw new Error('Wait for pending steps before settling.');
    this.step(frames);
    this.settling = true;
  }
  get now(): number { return this.elapsed; }
  destroy(): void {
    this.cancelFastForward();
    if (this.loop.callback === this.callback) this.loop.callback = this.original;
    Date.now = this.nativeNow;
  }
}
