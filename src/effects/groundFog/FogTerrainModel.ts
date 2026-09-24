import { CELL_SIZE } from '../../config';
import { WATER_SHORE_DISTANCE, WaterSurfaceModel } from '../../arena/WaterSurfaceModel';
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
  /** World cells within the shoreline ramp of any water cell; everything else skips the search. */
  private readonly nearWater: Uint8Array;
  constructor(readonly frame: FogFrame, water: readonly WaterCell[]) {
    this.cols = Math.ceil(frame.width / CELL_SIZE); this.rows = Math.ceil(frame.height / CELL_SIZE);
    this.blocked = new Uint16Array(this.cols * this.rows);
    this.opened = new Uint8Array(this.blocked.length);
    this.water = new WaterSurfaceModel(water, frame);
    this.nearWater = new Uint8Array(this.cols * this.rows);
    const reach = Math.ceil(FOG.waterRamp / CELL_SIZE) + 1;
    for (const c of water) for (let y = Math.max(0, c.gridY - reach); y <= Math.min(this.rows - 1, c.gridY + reach); y++)
      for (let x = Math.max(0, c.gridX - reach); x <= Math.min(this.cols - 1, c.gridX + reach); x++) this.nearWater[y * this.cols + x] = 1;
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
    return [this.blocked[i] ? 0 : 255, Math.round(this.waterWeight(x, y, i) * 255), this.opened[i] ? 255 : 0, this.changed.has(i) ? 255 : 0];
  }
  /** One smooth ramp over the signed shore distance: fades out over land, full over open water. */
  private waterWeight(x: number, y: number, cell: number): number {
    if (!this.nearWater[cell]) return 0;
    const signed = this.water.sample(x, y);
    const inside = signed > -WATER_SHORE_DISTANCE ? signed : -this.distanceToWater(x, y);
    const t = Math.max(0, Math.min(1, (inside + FOG.waterRamp) / (FOG.waterRamp + WATER_SHORE_DISTANCE)));
    return t * t * (3 - 2 * t);
  }
  private distanceToWater(x: number, y: number): number {
    const r = FOG.waterRamp;
    let best = Infinity;
    for (let gy = Math.floor((y - r) / CELL_SIZE); gy <= Math.floor((y + r) / CELL_SIZE); gy++)
      for (let gx = Math.floor((x - r) / CELL_SIZE); gx <= Math.floor((x + r) / CELL_SIZE); gx++) {
        if (this.water.getMask(gx, gy) === undefined) continue;
        const dx = Math.max(gx * CELL_SIZE - x, 0, x - (gx + 1) * CELL_SIZE);
        const dy = Math.max(gy * CELL_SIZE - y, 0, y - (gy + 1) * CELL_SIZE);
        best = Math.min(best, Math.hypot(dx, dy));
      }
    return best;
  }
  acknowledge(): void { this.changed.clear(); this.dirtyChunks.clear(); }
  clear(): void { this.sources.clear(); this.changed.clear(); this.dirtyChunks.clear(); }
}
