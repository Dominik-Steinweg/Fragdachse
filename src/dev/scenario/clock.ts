/** Only installed in the isolated offline tab. Real wall timers/workers are NOT deterministic. */
export class ScenarioClock {
  private isPaused = false;
  get paused(): boolean { return this.isPaused; }
  set paused(value: boolean) { this.isPaused = value; if (!value) this.queuedSteps = 0; }
  speed = 1;
  private queuedSteps = 0;
  private elapsed = 0;
  private simulationTime: number | null = null;
  private readonly nativeNow = Date.now;
  private readonly epoch = Date.now();
  private readonly original: (time: number, delta: number) => void;
  private readonly callback: (time: number, delta: number) => void;

  constructor(private readonly loop: { callback: (time: number, delta: number) => void }) {
    this.original = loop.callback;
    // Date.now's integer contract also underpins world/projectile revision IDs.
    Date.now = () => this.epoch + Math.floor(this.elapsed);
    this.callback = (time, delta) => {
      this.simulationTime ??= time;
      if (this.paused && this.queuedSteps === 0) return;
      const step = this.paused ? 1000 / 60 : Math.min(delta, 100) * this.speed;
      if (this.paused) this.queuedSteps--;
      this.elapsed += step;
      this.simulationTime += step;
      this.original(this.simulationTime, step);
    };
    loop.callback = this.callback;
  }
  step(frames = 1): void {
    if (!Number.isInteger(frames) || frames < 1 || frames > 600) throw new Error('Schritte: 1…600 Frames.');
    this.paused = true;
    this.queuedSteps = Math.min(600, this.queuedSteps + frames);
  }
  get now(): number { return this.elapsed; }
  destroy(): void {
    if (this.loop.callback === this.callback) this.loop.callback = this.original;
    Date.now = this.nativeNow;
  }
}
