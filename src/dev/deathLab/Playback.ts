/** One presentation clock. Rebuild on seek, including all quality carry and source lifetimes. */
export interface PlaybackPort { reset(): void; spawn(): void; advance(deltaMs: number): void; sample(timeMs: number): void }
export class DeathPlayback {
  timeMs = 0;
  playing = false;
  speed = 1;
  constructor(private readonly port: PlaybackPort) {}
  seek(timeMs: number): void {
    if (!Number.isFinite(timeMs) || timeMs < 0 || timeMs > 1500) throw new Error('seek: 0–1500 ms.');
    this.port.reset(); this.port.spawn(); this.port.advance(timeMs); this.port.sample(timeMs);
    this.timeMs = timeMs;
  }
  tick(deltaMs: number): void {
    if (!this.playing) return;
    const next = Math.min(1500, this.timeMs + Math.max(0, deltaMs) * this.speed);
    this.port.advance(next - this.timeMs); this.port.sample(next); this.timeMs = next;
    if (next === 1500) this.playing = false;
  }
}
