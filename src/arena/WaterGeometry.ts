import { CELL_SIZE } from '../config';
import type { WaterCell } from '../types';
import type { WorldMetrics } from '../world/WorldMetrics';
import { segmentRectInterval } from '../systems/ObstacleRules';

/** Immutable, renderer-free water occupancy. Fire consumers never query this geometry. */
export class WaterGeometry {
  private readonly cells = new Set<number>();
  constructor(readonly water: readonly WaterCell[], readonly metrics: WorldMetrics) {
    for (const cell of water) this.cells.add(cell.gridY * metrics.gridCols + cell.gridX);
  }

  hasCell(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.metrics.gridCols && y < this.metrics.gridRows
      && this.cells.has(y * this.metrics.gridCols + x);
  }

  private visit(left: number, top: number, right: number, bottom: number,
    visitor: (x: number, y: number, size: number) => boolean): boolean {
    const m = this.metrics;
    for (let y = Math.max(0, Math.floor((top - m.offsetY) / CELL_SIZE));
      y <= Math.min(m.gridRows - 1, Math.floor((bottom - m.offsetY) / CELL_SIZE)); y++) {
      for (let x = Math.max(0, Math.floor((left - m.offsetX) / CELL_SIZE));
        x <= Math.min(m.gridCols - 1, Math.floor((right - m.offsetX) / CELL_SIZE)); x++) {
        if (this.hasCell(x, y) && visitor(m.offsetX + x * CELL_SIZE, m.offsetY + y * CELL_SIZE, CELL_SIZE)) return true;
      }
    }
    return false;
  }

  isCircleBlocked(x: number, y: number, radius: number): boolean {
    if (!this.cells.size) return false;
    return this.visit(x - radius, y - radius, x + radius, y + radius, (left, top, size) => {
      const dx = x - Math.max(left, Math.min(x, left + size));
      const dy = y - Math.max(top, Math.min(y, top + size));
      return radius === 0 ? x >= left && x < left + size && y >= top && y < top + size
        : dx * dx + dy * dy < Math.max(0, radius - 0.000001) ** 2;
    });
  }

  /** Deterministic dry landing for spawns originating on water (e.g. death-spawn offsets). */
  resolveDryPoint(x: number, y: number, radius: number): { x: number; y: number } | null {
    if (!this.isCircleBlocked(x, y, radius)) return { x, y };
    const m = this.metrics;
    const gx = Math.floor((x - m.offsetX) / CELL_SIZE), gy = Math.floor((y - m.offsetY) / CELL_SIZE);
    for (let ring = 1; ring <= Math.max(m.gridCols, m.gridRows); ring++) {
      for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx += Math.abs(dy) === ring ? 1 : 2 * ring) {
        const px = m.offsetX + (gx + dx + .5) * CELL_SIZE, py = m.offsetY + (gy + dy + .5) * CELL_SIZE;
        if (px - radius < m.offsetX || py - radius < m.offsetY || px + radius > m.maxX || py + radius > m.maxY) continue;
        if (!this.isCircleBlocked(px, py, radius)) return { x: px, y: py };
      }
    }
    return null;
  }

  /** Swept body extent prevents tunnelling, including below ground. Tangential travel stays free. */
  sweep(sx: number, sy: number, ex: number, ey: number, halfWidth: number, halfHeight = halfWidth): number {
    if (!this.cells.size || sx === ex && sy === ey) return 1;
    let fraction = 1;
    this.visit(Math.min(sx, ex) - halfWidth, Math.min(sy, ey) - halfHeight,
      Math.max(sx, ex) + halfWidth, Math.max(sy, ey) + halfHeight, (x, y, size) => {
        const inset = 0.00001;
        const hit = segmentRectInterval(sx, sy, ex, ey, x - halfWidth + inset,
          y - halfHeight + inset, x + size + halfWidth - inset, y + size + halfHeight - inset);
        if (hit && hit.exit > 0 && hit.enter >= -0.000001) fraction = Math.min(fraction, Math.max(0, hit.enter));
        return false;
      });
    return fraction < 1 ? Math.max(0, fraction - 0.01 / Math.max(0.01, Math.hypot(ex - sx, ey - sy))) : 1;
  }
}
