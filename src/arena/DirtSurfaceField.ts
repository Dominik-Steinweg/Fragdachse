import { CELL_SIZE } from '../config';
import type { DirtCell } from '../types';
import { hashSeededCell01 } from './CellHash';
import type { ChunkWorldFrame } from './chunks/ArenaChunkGrid';
import { groundMaterialPhase } from './GroundMaterialConfig';
import type { GroundMaterialSamples } from './GroundMaterialSamples';

const RADIUS = CELL_SIZE * .8;
/** Summed amplitude of the three world-fixed warp octaves in density(). */
const WARP_PX = 12 + 7 + 2;
/** Maximum visual reach beyond a soil cell. No gameplay geometry changes. */
export const DIRT_SURFACE_REACH_PX = Math.ceil(RADIUS + WARP_PX);
/** Cells within this ring decide "near soil" and "solid interior" early-outs. */
const RING = Math.ceil(DIRT_SURFACE_REACH_PX / CELL_SIZE);

/** Half-width of the interleaved seam, in density units. Varies slowly along the edge,
 * so some borders read crisp and others dissolve into scattered blades. */
const BAND_MIN = .35;
const BAND_MAX = 1.1;
/** Share of a clump-sized noise in the grass height. Pure blade height would erode the
 * edge evenly; clumps make grass retreat in small tufts, as in real trodden ground. */
const CLUMP = .5;
/** Anti-aliasing width of the per-pixel soil/grass decision. */
const SOFT = .06;
/** Soil tint that bleeds into the grass ahead of the seam. */
const WASH = .2;
/** Contact shade of soil next to taller grass, and the darker tint of the wash. */
const SHADE = .16;
/** Density lattice spacing in world pixels. */
const DENSITY_STEP = 2;
/** Seeded value-noise lattice; wraps after LATTICE periods, i.e. far beyond the visible scale. */
const LATTICE = 256;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (v: number): number => v * v * (3 - 2 * v);

/** Integral of a compact, smooth kernel. Filtering occupancy before thresholding
 * rounds the whole contour, including diagonal stairs, without a grid-shaped halo. */
const integral = (distance: number): number => smooth(clamp01((distance / RADIUS + 1) * .5));

/** Pure World-owned visual field. Rebuild order, camera and chunk size never enter sampling. */
export class DirtSurfaceField {
  private readonly occupied: Uint8Array;
  /** 0 = no soil within reach, 1 = seam, 2 = solid interior. */
  private readonly zone: Uint8Array;
  private readonly cols: number;
  private readonly rows: number;
  private readonly lattice: Float32Array;
  private readonly weightX = new Float64Array(3);
  private densityGrid = new Float32Array(0);

  constructor(seed: number, dirt: readonly DirtCell[], readonly frame: ChunkWorldFrame) {
    this.cols = Math.max(1, Math.ceil(frame.width / CELL_SIZE));
    this.rows = Math.max(1, Math.ceil(frame.height / CELL_SIZE));
    this.occupied = new Uint8Array(this.cols * this.rows);
    for (const cell of dirt) {
      if (cell.gridX >= 0 && cell.gridY >= 0 && cell.gridX < this.cols && cell.gridY < this.rows) {
        this.occupied[cell.gridY * this.cols + cell.gridX] = 1;
      }
    }
    this.zone = new Uint8Array(this.occupied.length);
    this.lattice = new Float32Array(LATTICE * LATTICE);
    for (let i = 0; i < this.lattice.length; i++) {
      this.lattice[i] = hashSeededCell01(seed, i % LATTICE, Math.floor(i / LATTICE), 0x51d7);
    }
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
      let any = false, all = true;
      for (let dy = -RING; dy <= RING; dy++) for (let dx = -RING; dx <= RING; dx++) {
        if (this.occupied[this.index(x + dx, y + dy)]) any = true; else all = false;
      }
      this.zone[y * this.cols + x] = all ? 2 : any ? 1 : 0;
    }
  }

  /** The World boundary repeats its edge cells; it is not a new material edge. */
  private index(x: number, y: number): number {
    return Math.max(0, Math.min(this.rows - 1, y)) * this.cols
      + Math.max(0, Math.min(this.cols - 1, x));
  }

  /** Smooth value noise; each salt reads its own window of the shared seeded lattice. */
  private noise(x: number, y: number, period: number, salt: number): number {
    const u = x / period + salt * 37, v = y / period + salt * 71;
    const fx = Math.floor(u), fy = Math.floor(v);
    const tx = smooth(u - fx), ty = smooth(v - fy);
    const x0 = fx & (LATTICE - 1), y0 = (fy & (LATTICE - 1)) * LATTICE;
    const x1 = (x0 + 1) & (LATTICE - 1), y1 = ((fy + 1) & (LATTICE - 1)) * LATTICE;
    const l = this.lattice, a = l[y0 + x0], b = l[y0 + x1], c = l[y1 + x0], d = l[y1 + x1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }

  private occupancy(x: number, y: number): number {
    const gx = Math.floor(x / CELL_SIZE), gy = Math.floor(y / CELL_SIZE);
    const weightX = this.weightX;
    for (let dx = -1; dx <= 1; dx++) {
      const left = (gx + dx) * CELL_SIZE - x;
      weightX[dx + 1] = integral(left + CELL_SIZE) - integral(left);
    }
    let value = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const top = (gy + dy) * CELL_SIZE - y;
      const weightY = integral(top + CELL_SIZE) - integral(top);
      if (!weightY) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (weightX[dx + 1] && this.occupied[this.index(gx + dx, gy + dy)]) value += weightY * weightX[dx + 1];
      }
    }
    return value;
  }

  /** Smoothed soil density at a warped, frame-local point; 0.5 is the organic contour. */
  private density(x: number, y: number): number {
    const u = x + (this.noise(x, y, 89, 1) - .5) * 24 + (this.noise(x, y, 29, 2) - .5) * 14
      + (this.noise(x, y, 9, 7) - .5) * 4;
    const v = y + (this.noise(x, y, 97, 3) - .5) * 24 + (this.noise(x, y, 33, 4) - .5) * 14
      + (this.noise(x, y, 11, 8) - .5) * 4;
    return this.occupancy(u, v);
  }

  private band(x: number, y: number): number {
    return BAND_MIN + this.noise(x, y, 113, 11) * (BAND_MAX - BAND_MIN);
  }

  /**
   * Height blend: near the contour soil first appears where grass is low (gaps between
   * blades), while tall blades and clumps persist into the soil. `grassHeight` is 0..1.
   */
  private soil(x: number, y: number, density: number, grassHeight: number, band = this.band(x, y)): number {
    const level = .5 + (density - .5) / band * .5;
    const clump = this.noise(x, y, 6, 12) * .45 + this.noise(x, y, 17, 13) * .55;
    const height = grassHeight * (1 - CLUMP) + clump * CLUMP;
    return smooth(clamp01((level - height) / SOFT + .5));
  }

  /** Density on the frame-anchored lattice; exact outside the seam zone. */
  private latticeDensity(i: number, j: number): number {
    const x = i * DENSITY_STEP, y = j * DENSITY_STEP;
    const zone = this.zone[this.index(Math.floor(x / CELL_SIZE), Math.floor(y / CELL_SIZE))];
    return zone === 1 ? this.density(x, y) : zone ? 1 : 0;
  }

  /** The warp is smooth at this scale, so density is evaluated on a coarse, frame-anchored
   * lattice and interpolated. Anchoring keeps bakes independent of region partition. */
  private interpolatedDensity(x: number, y: number): number {
    const u = x / DENSITY_STEP, v = y / DENSITY_STEP, i = Math.floor(u), j = Math.floor(v);
    const tx = u - i, ty = v - j;
    const a = this.latticeDensity(i, j), b = this.latticeDensity(i + 1, j);
    const c = this.latticeDensity(i, j + 1), d = this.latticeDensity(i + 1, j + 1);
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }

  /** Soil opacity for a neutral grass height; used by tests and coarse consumers. */
  coverageAt(worldX: number, worldY: number): number {
    const x = worldX - this.frame.offsetX, y = worldY - this.frame.offsetY;
    const zone = this.zone[this.index(Math.floor(x / CELL_SIZE), Math.floor(y / CELL_SIZE))];
    if (zone !== 1) return zone ? 1 : 0;
    const density = this.interpolatedDensity(x, y);
    return density > 0 ? this.soil(x, y, density, .5) : 0;
  }

  /**
   * Writes straight (non-premultiplied) RGBA soil for one square region at native resolution.
   * The grass below stays a separate GPU tile; this layer carries soil, the blended seam, the
   * soil wash ahead of it and the contact shade. Chunk bakes and snapshots share it.
   */
  writeSurface(data: Uint8ClampedArray, stride: number, worldX: number, worldY: number, size: number,
    materials: GroundMaterialSamples): void {
    const { dirt, grassHeight } = materials;
    const localX = worldX - this.frame.offsetX, localY = worldY - this.frame.offsetY;
    const i0 = Math.floor((localX + .5) / DENSITY_STEP), j0 = Math.floor((localY + .5) / DENSITY_STEP);
    const span = Math.floor((localX + size - .5) / DENSITY_STEP) - i0 + 2;
    const rows = Math.floor((localY + size - .5) / DENSITY_STEP) - j0 + 2;
    if (this.densityGrid.length < span * rows) this.densityGrid = new Float32Array(span * rows);
    const grid = this.densityGrid;
    for (let j = 0; j < rows; j++) for (let i = 0; i < span; i++) grid[j * span + i] = this.latticeDensity(i0 + i, j0 + j);
    const dirtColumn = groundMaterialPhase(localX, dirt.width);
    const heightColumn = groundMaterialPhase(localX, grassHeight.width);
    for (let py = 0; py < size; py++) {
      const y = localY + py + .5, row = Math.floor(y / CELL_SIZE);
      const v = y / DENSITY_STEP - j0, gj = Math.floor(v), ty = v - gj;
      const dirtRow = groundMaterialPhase(localY + py, dirt.height) * dirt.width;
      const heightRow = groundMaterialPhase(localY + py, grassHeight.height) * grassHeight.width;
      let dirtX = dirtColumn - 1, heightX = heightColumn - 1;
      for (let px = 0; px < size; px++) {
        if (++dirtX === dirt.width) dirtX = 0;
        if (++heightX === grassHeight.width) heightX = 0;
        const out = (py * stride + px) * 4;
        const x = localX + px + .5;
        const zone = this.zone[this.index(Math.floor(x / CELL_SIZE), row)];
        // Clear all channels: a reused canvas must not keep colour from an earlier region.
        if (!zone) { data.fill(0, out, out + 4); continue; }
        let alpha = 1, shade = 1;
        if (zone === 1) {
          const u = x / DENSITY_STEP - i0, gi = Math.floor(u), tx = u - gi, g = gj * span + gi;
          const top = grid[g] + (grid[g + 1] - grid[g]) * tx;
          const bottom = grid[g + span] + (grid[g + span + 1] - grid[g + span]) * tx;
          const density = top + (bottom - top) * ty;
          if (density <= 0) { data.fill(0, out, out + 4); continue; }
          const height = grassHeight.data[heightRow + heightX] / 255;
          const soil = this.soil(x, y, density, height);
          const wash = WASH * smooth(clamp01(density * 2));
          alpha = Math.max(soil, wash);
          shade = 1 - SHADE * (1 - smooth(clamp01((density - .5) * 3)));
        }
        const source = (dirtRow + dirtX) * 4;
        data[out] = dirt.rgba[source] * shade;
        data[out + 1] = dirt.rgba[source + 1] * shade;
        data[out + 2] = dirt.rgba[source + 2] * shade;
        data[out + 3] = Math.round(alpha * 255);
      }
    }
  }
}
