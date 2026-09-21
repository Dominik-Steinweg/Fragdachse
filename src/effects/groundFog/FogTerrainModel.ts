import { CELL_SIZE } from '../../config';
import { WaterSurfaceModel } from '../../arena/WaterSurfaceModel';
import type { WaterCell } from '../../types';
import { FOG, type FogFrame } from './FogConfig';

/** Derived terrain, not a second collision owner. Changes are bounded by world cells. */
export class FogTerrainModel {
  readonly cols: number;
  readonly rows: number;
  readonly blocked: Uint16Array;
  readonly opened: Uint8Array;
  readonly changed = new Set<number>();
  readonly dirtyChunks = new Set<string>();
  private readonly sources = new Map<string, Set<number>>();
  private readonly water: WaterSurfaceModel;
  constructor(readonly frame: FogFrame, water: readonly WaterCell[]) {
    this.cols = Math.ceil(frame.width / CELL_SIZE); this.rows = Math.ceil(frame.height / CELL_SIZE);
    this.blocked = new Uint16Array(this.cols * this.rows);
    this.opened = new Uint8Array(this.blocked.length);
    this.water = new WaterSurfaceModel(water, frame);
  }
  setObstacle(id: string, cells: Iterable<{ gridX: number; gridY: number }>, baseline = false): void {
    const next = new Set<number>();
    for (const c of cells) if (c.gridX >= 0 && c.gridY >= 0 && c.gridX < this.cols && c.gridY < this.rows)
      next.add(c.gridY * this.cols + c.gridX);
    const previous = this.sources.get(id);
    if (previous) for (const i of previous) if (!next.has(i)) this.adjust(i, -1, baseline);
    for (const i of next) if (!previous?.has(i)) this.adjust(i, 1, baseline);
    if (next.size) this.sources.set(id, next); else this.sources.delete(id);
  }
  removeObstacle(id: string): void { this.setObstacle(id, []); }
  /** Late join: known destroyed authored cells must not acquire a fresh ambient baseline. */
  markOpened(cells: Iterable<{ gridX: number; gridY: number }>): void {
    for (const c of cells) {
      if (c.gridX < 0 || c.gridY < 0 || c.gridX >= this.cols || c.gridY >= this.rows) continue;
      const i = c.gridY * this.cols + c.gridX;
      this.opened[i] = 1; this.markDirty(i);
    }
  }
  private adjust(i: number, change: number, baseline: boolean): void {
    const before = this.blocked[i] > 0;
    this.blocked[i] = Math.max(0, this.blocked[i] + change);
    if (before === (this.blocked[i] > 0)) return;
    if (before && !baseline) this.opened[i] = 1;
    if (!baseline) this.changed.add(i);
    this.markDirty(i);
  }
  private markDirty(i: number): void {
    const x = (i % this.cols) * CELL_SIZE, y = Math.floor(i / this.cols) * CELL_SIZE;
    this.dirtyChunks.add(`${Math.floor(x / FOG.chunkSize)},${Math.floor(y / FOG.chunkSize)}`);
  }
  sample(x: number, y: number): readonly [number, number, number, number] {
    if (x < 0 || y < 0 || x >= this.frame.width || y >= this.frame.height) return [0, 0, 0, 0];
    const i = Math.floor(y / CELL_SIZE) * this.cols + Math.floor(x / CELL_SIZE);
    const water = Math.max(0, Math.min(1, .5 + this.water.sample(x, y) / 80));
    return [this.blocked[i] ? 0 : 255, Math.round(water * 255), this.opened[i] ? 255 : 0, this.changed.has(i) ? 255 : 0];
  }
  acknowledge(): void { this.changed.clear(); this.dirtyChunks.clear(); }
  clear(): void { this.sources.clear(); this.changed.clear(); this.dirtyChunks.clear(); }
}
