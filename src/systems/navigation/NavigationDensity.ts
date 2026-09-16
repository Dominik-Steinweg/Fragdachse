import type { FlowFieldMetrics } from '../flowfield/FlowFieldKernel';

/** Optional finite congestion penalties. Hard connectivity never reads this raster. */
export class NavigationDensity {
  private readonly occupied: Float32Array;
  private readonly smoothed: Float32Array;
  private nextAt = 0;
  constructor(private readonly metrics: FlowFieldMetrics) {
    this.occupied = new Float32Array(metrics.cols * metrics.rows);
    this.smoothed = new Float32Array(this.occupied.length);
  }
  sample(positions: Iterable<{ x: number; y: number }>, now: number): Float32Array | null {
    if (now < this.nextAt) return null;
    this.nextAt = now + 500; this.occupied.fill(0);
    const m = this.metrics;
    for (const point of positions) {
      const col = Math.round((point.x - m.arenaOffsetX) / m.cellSize), row = Math.round((point.y - m.arenaOffsetY) / m.cellSize);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = col + dx, y = row + dy;
        if (x < 0 || y < 0 || x >= m.cols || y >= m.rows) continue;
        this.occupied[y * m.cols + x] += 1 / (1 + dx * dx + dy * dy);
      }
    }
    let changed = false;
    for (let i = 0; i < this.smoothed.length; i++) {
      const next = Math.min(2, this.occupied[i] * .3) * .3 + this.smoothed[i] * .7;
      changed ||= Math.abs(next - this.smoothed[i]) > .02;
      this.smoothed[i] = next;
    }
    return changed ? this.smoothed.slice() : null;
  }
}
