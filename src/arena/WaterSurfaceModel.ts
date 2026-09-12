import { AutoTiler } from './AutoTiler';
import { CELL_SIZE } from '../config';
import type { WaterCell } from '../types';

export const WATER_COLOR = 0x285d61;
export const WATER_SHORE_DISTANCE = 48;
export const WATER_MASK_STEP = 2;
export const WATER_MASK_HALO = 52;

/** Positive inside the 47-Blob contour. Connected edges are never independently rounded. */
export function waterBlobDistance(mask: number, x: number, y: number): number {
  const size = CELL_SIZE;
  const inset = size * .18;
  const radius = size * .32;
  const n = !!(mask & 1), e = !!(mask & 4), s = !!(mask & 16), w = !!(mask & 64);
  let d = WATER_SHORE_DISTANCE;
  if (!n) d = Math.min(d, y - inset);
  if (!e) d = Math.min(d, size - x - inset);
  if (!s) d = Math.min(d, size - y - inset);
  if (!w) d = Math.min(d, x - inset);
  for (const [cx, cy, a, b, diagonal] of [
    [x, y, n, w, !!(mask & 128)], [size - x, y, n, e, !!(mask & 2)],
    [size - x, size - y, s, e, !!(mask & 8)], [x, size - y, s, w, !!(mask & 32)],
  ] as const) {
    if (!a && !b && cx < radius + inset && cy < radius + inset)
      d = Math.min(d, radius - Math.hypot(cx - radius - inset, cy - radius - inset));
    // The concave arc must meet the neighboring exposed edges at their same inset.
    if (a && b && !diagonal) d = Math.min(d, Math.hypot(cx, cy) - inset);
  }
  return d;
}

/** Static topology is shared by all chunks; neither mask generation nor waves own gameplay. */
export class WaterSurfaceModel {
  readonly masks = new Map<string, number>();
  constructor(cells: readonly WaterCell[]) {
    const occupied = new Set(cells.map(c => `${c.gridX},${c.gridY}`));
    for (const cell of cells) this.masks.set(`${cell.gridX},${cell.gridY}`,
      AutoTiler.computeMask(cell.gridX, cell.gridY, (x, y) => occupied.has(`${x},${y}`)));
  }

  sample(x: number, y: number): number {
    const gx = Math.floor(x / CELL_SIZE), gy = Math.floor(y / CELL_SIZE);
    const mask = this.masks.get(`${gx},${gy}`);
    return mask === undefined ? -WATER_SHORE_DISTANCE : waterBlobDistance(mask, x - gx * CELL_SIZE, y - gy * CELL_SIZE);
  }

  /** Packed opaque texture: R shore distance, B coverage. Halo keeps neighboring chunks seamless. */
  bake(x: number, y: number, chunkSize: number): { size: number; data: Uint8ClampedArray } {
    const step = WATER_MASK_STEP, halo = WATER_MASK_HALO;
    const size = (chunkSize + halo * 2) / step;
    const distance = new Float32Array(size * size);
    const data = new Uint8ClampedArray(size * size * 4);
    for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
      const i = py * size + px;
      const d = this.sample(x - halo + (px + 0.5) * step, y - halo + (py + 0.5) * step);
      distance[i] = d > 0 ? Math.min(WATER_SHORE_DISTANCE, d) : 0;
      data[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, 0.5 + d / step)) * 255);
      data[i * 4 + 3] = 255;
    }
    // Two chamfer passes propagate shore distance into cells without exposed edges.
    for (const direction of [1, -1]) {
      const start = direction === 1 ? 0 : size - 1, end = direction === 1 ? size : -1;
      for (let py = start; py !== end; py += direction) for (let px = start; px !== end; px += direction) {
        const i = py * size + px;
        for (const [dx, dy, cost] of [[-direction, 0, step], [0, -direction, step],
          [-direction, -direction, step * Math.SQRT2], [direction, -direction, step * Math.SQRT2]]) {
          const nx = px + dx, ny = py + dy;
          if (nx >= 0 && ny >= 0 && nx < size && ny < size) distance[i] = Math.min(distance[i], distance[ny * size + nx] + cost);
        }
      }
    }
    for (let i = 0; i < distance.length; i++) data[i * 4] = Math.round(distance[i] / WATER_SHORE_DISTANCE * 255);
    return { size, data };
  }
}
