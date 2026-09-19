import { AutoTiler } from './AutoTiler';
import { CELL_SIZE } from '../config';
import type { WaterCell } from '../types';

export const WATER_COLOR = 0x285d61;
export const WATER_SHORE_DISTANCE = 64;
export const WATER_MASK_STEP = 2;
export const WATER_VISUAL_EXPANSION = 12;
const WATER_MASK_BLUR_RADIUS = 10;
const WATER_BLUR_WEIGHTS = Array.from({ length: WATER_MASK_BLUR_RADIUS * 2 + 1 },
  (_, i) => Math.exp(-.5 * ((i - WATER_MASK_BLUR_RADIUS) / 4.5) ** 2));
const WATER_BLUR_SUM = WATER_BLUR_WEIGHTS.reduce((a, b) => a + b, 0);
export interface WaterMask { size: number; data: Uint8ClampedArray }
export interface WaterMaskView { readonly size: number; readonly data: Readonly<ArrayLike<number>> }
export const WATER_MASK_HALO = WATER_SHORE_DISTANCE + WATER_VISUAL_EXPANSION + (WATER_MASK_BLUR_RADIUS + 2) * WATER_MASK_STEP;
// The shader displaces the mask lookup by at most 4 world pixels per axis.
const WATER_RENDER_MARGIN = WATER_VISUAL_EXPANSION + WATER_MASK_BLUR_RADIUS * WATER_MASK_STEP + 4 + WATER_MASK_STEP;

/** Positive inside the 47-Blob contour. Connected edges are never independently rounded. */
export function waterBlobDistance(mask: number, x: number, y: number): number {
  const size = CELL_SIZE;
  const inset = size * .10;
  const radius = size * .40;
  const n = !!(mask & 1), e = !!(mask & 4), s = !!(mask & 16), w = !!(mask & 64);
  let d = WATER_SHORE_DISTANCE;
  if (!n) d = Math.min(d, y - inset);
  if (!e) d = Math.min(d, size - x - inset);
  if (!s) d = Math.min(d, size - y - inset);
  if (!w) d = Math.min(d, x - inset);
  for (let corner = 0; corner < 4; corner++) {
    const cx = corner === 0 || corner === 3 ? x : size - x;
    const cy = corner < 2 ? y : size - y;
    const a = corner < 2 ? n : s;
    const b = corner === 0 || corner === 3 ? w : e;
    const diagonal = !!(mask & (corner === 0 ? 128 : corner === 1 ? 2 : corner === 2 ? 8 : 32));
    if (!a && !b && cx < radius + inset && cy < radius + inset)
      d = Math.min(d, radius - Math.hypot(cx - radius - inset, cy - radius - inset));
    // The concave arc must meet the neighboring exposed edges at their same inset.
    if (a && b && !diagonal) d = Math.min(d, Math.hypot(cx, cy) - inset);
  }
  return d;
}

/** Static topology is shared by all chunks; neither mask generation nor waves own gameplay. */
export class WaterSurfaceModel {
  private readonly masks: Int16Array;
  private readonly columns: number;
  private readonly rows: number;
  constructor(private readonly cells: readonly WaterCell[], private readonly dimensions: { width: number; height: number }) {
    this.columns = Math.ceil(dimensions.width / CELL_SIZE);
    this.rows = Math.ceil(dimensions.height / CELL_SIZE);
    // Sampling touches every mask pixel, including the halo. Index the immutable topology
    // directly instead of allocating and hashing a coordinate string for every pixel.
    this.masks = new Int16Array(this.columns * this.rows).fill(-1);
    const occupied = new Set(cells.map(c => `${c.gridX},${c.gridY}`));
    for (const cell of cells) this.masks[cell.gridY * this.columns + cell.gridX] =
      AutoTiler.computeMask(cell.gridX, cell.gridY, (x, y) =>
        x < 0 || y < 0 || x * CELL_SIZE >= dimensions.width || y * CELL_SIZE >= dimensions.height
        || occupied.has(`${x},${y}`));
  }

  getMask(gridX: number, gridY: number): number | undefined {
    if (gridX < 0 || gridY < 0 || gridX >= this.columns || gridY >= this.rows) return undefined;
    const mask = this.masks[gridY * this.columns + gridX];
    return mask < 0 ? undefined : mask;
  }

  sample(x: number, y: number): number {
    // Extend the boundary field into the bake halo so blur and shader displacement
    // cannot introduce a shore at the map edge. Dry boundary cells stay dry.
    x = Math.max(0, Math.min(x, this.dimensions.width));
    y = Math.max(0, Math.min(y, this.dimensions.height));
    const gx = Math.min(Math.floor(x / CELL_SIZE), this.columns - 1);
    const gy = Math.min(Math.floor(y / CELL_SIZE), this.rows - 1);
    const mask = this.masks[gy * this.columns + gx];
    return mask === undefined || mask < 0 ? -WATER_SHORE_DISTANCE : waterBlobDistance(mask, x - gx * CELL_SIZE, y - gy * CELL_SIZE);
  }

  /** Include the soft bank in neighboring chunks, clipped to the presentation world. */
  getChunkOrigins(chunkSize: number, width: number, height: number): { x: number; y: number }[] {
    const occupied = new Map<string, { x: number; y: number }>();
    for (const cell of this.cells) {
      const left = Math.max(0, Math.floor((cell.gridX * CELL_SIZE - WATER_RENDER_MARGIN) / chunkSize));
      const top = Math.max(0, Math.floor((cell.gridY * CELL_SIZE - WATER_RENDER_MARGIN) / chunkSize));
      const right = Math.min(Math.ceil(width / chunkSize) - 1,
        Math.floor(((cell.gridX + 1) * CELL_SIZE + WATER_RENDER_MARGIN) / chunkSize));
      const bottom = Math.min(Math.ceil(height / chunkSize) - 1,
        Math.floor(((cell.gridY + 1) * CELL_SIZE + WATER_RENDER_MARGIN) / chunkSize));
      for (let cy = top; cy <= bottom; cy++) for (let cx = left; cx <= right; cx++)
        occupied.set(`${cx},${cy}`, { x: cx * chunkSize, y: cy * chunkSize });
    }
    return [...occupied.values()];
  }

  /** Packed opaque texture: R shore distance, B coverage. Halo keeps neighboring chunks seamless. */
  bake(x: number, y: number, chunkSize: number): WaterMask {
    const work = this.bakeSteps(x, y, chunkSize);
    let result = work.next();
    while (!result.done) result = work.next();
    return result.value;
  }

  /** Same arithmetic as bake(), resumable between small row batches during loading. */
  *bakeSteps(x: number, y: number, chunkSize: number): Generator<void, WaterMask> {
    const step = WATER_MASK_STEP, halo = WATER_MASK_HALO;
    const size = (chunkSize + halo * 2) / step;
    const distance = new Float32Array(size * size);
    const outside = new Float32Array(size * size);
    const data = new Uint8ClampedArray(size * size * 4);
    for (let py = 0; py < size; py++) {
      if (py % 8 === 0) yield;
      const sampleY = y - halo + (py + 0.5) * step;
      for (let px = 0; px < size; px++) {
        const i = py * size + px;
        const d = this.sample(x - halo + (px + 0.5) * step, sampleY);
        distance[i] = d > 0 ? Math.min(WATER_SHORE_DISTANCE, d) : 0;
        outside[i] = d > 0 ? 0 : Math.min(WATER_SHORE_DISTANCE, -d);
        data[i * 4 + 3] = 255;
      }
    }
    // Preserve the existing inward distance and extend the field onto dry cells.
    // Analytic distances seed subpixel shore contacts on both sides of the contour.
    for (const direction of [1, -1]) {
      const start = direction === 1 ? 0 : size - 1, end = direction === 1 ? size : -1;
      const diagonalCost = step * Math.SQRT2;
      for (let py = start; py !== end; py += direction) {
        if (py % 8 === 0) yield;
        const row = py * size, previousRow = row - direction * size;
        const hasPreviousRow = py !== start;
        for (let px = start; px !== end; px += direction) {
          const i = row + px;
          // Keep the original neighbor order and Float32 stores exactly. The four fixed
          // neighbors do not need nested iterable/destructuring work for each pixel.
          if (px !== start) {
            distance[i] = Math.min(distance[i], distance[i - direction] + step);
            outside[i] = Math.min(outside[i], outside[i - direction] + step);
          }
          if (hasPreviousRow) {
            const above = previousRow + px;
            distance[i] = Math.min(distance[i], distance[above] + step);
            outside[i] = Math.min(outside[i], outside[above] + step);
            if (px !== start) {
              distance[i] = Math.min(distance[i], distance[above - direction] + diagonalCost);
              outside[i] = Math.min(outside[i], outside[above - direction] + diagonalCost);
            }
            if (px + direction !== end) {
              distance[i] = Math.min(distance[i], distance[above + direction] + diagonalCost);
              outside[i] = Math.min(outside[i], outside[above + direction] + diagonalCost);
            }
          }
        }
      }
    }
    // Move the whole material profile outwards before applying the unchanged blur.
    for (let i = 0; i < distance.length; i++) {
      if (i % (size * 8) === 0) yield;
      const d = (distance[i] > 0 ? distance[i] : -outside[i]) + WATER_VISUAL_EXPANSION;
      data[i * 4] = Math.round(Math.max(0, Math.min(WATER_SHORE_DISTANCE, d)) / WATER_SHORE_DISTANCE * 255);
      data[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, 0.5 + d / step)) * 255);
    }
    // Smooth coverage AND shore distance together: an unsmoothed distance channel would
    // stamp the cell corners back into opacity, depth and receding water even with soft coverage.
    // The halo includes the filter support beyond the distance propagation range.
    const radius = WATER_MASK_BLUR_RADIUS, weights = WATER_BLUR_WEIGHTS, sum = WATER_BLUR_SUM;
    const horizontal = new Float32Array(size * size);
    for (const channel of [0, 2]) {
      for (let py = radius; py < size - radius; py++) {
        if (py % 8 === 0) yield;
        const row = py * size;
        for (let px = radius; px < size - radius; px++) {
          let value = 0;
          const first = (row + px - radius) * 4 + channel;
          for (let tap = 0; tap < weights.length; tap++) value += data[first + tap * 4] * weights[tap];
          horizontal[row + px] = value / sum;
        }
      }
      for (let py = radius * 2; py < size - radius * 2; py++) {
        if (py % 8 === 0) yield;
        const row = py * size;
        for (let px = radius * 2; px < size - radius * 2; px++) {
          let value = 0;
          const first = row + px - radius * size;
          for (let tap = 0; tap < weights.length; tap++) value += horizontal[first + tap * size] * weights[tap];
          data[(row + px) * 4 + channel] = Math.round(value / sum);
        }
      }
    }
    return { size, data };
  }
}
