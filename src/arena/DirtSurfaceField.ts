import { CELL_SIZE } from '../config';
import type { DirtCell, WaterCell } from '../types';
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
/** Spacing of the coarse lattice for the dry/moist soil mask, in world pixels. */
const DRY_STEP = 8;
/** Share of soil drawn with the drier second material, and the raggedness of its border. */
const DRY_THRESHOLD = .55;
const DRY_SOFT = .07;
/** Riverbank around water: visible width beyond the water cells, ragged per position (px). */
const BANK_MIN = 10;
const BANK_MAX = 42;
/** Warp of the distance query: breaks the cell stairs without exposing grass under the water rim. */
const BANK_WARP_PX = 8;
/** Distance over which grass blades give way to the bank at its outer edge. */
const BANK_EDGE_SOFT = 14;
/** Faint damp wash on the grass just beyond the bank. */
const BANK_WASH = .22;
const BANK_WASH_PX = 12;
/**
 * Wet silt reaches this far from the water cells (min + noise range). Wetness darkens only
 * gently and over a long run: the bank is a shallow, gradual shore. When a wave recedes it
 * must reveal damp silt, not a dark drop-off.
 */
const BANK_WET_MIN = 14;
const BANK_WET_RANGE = 18;
const BANK_WET_DARKEN = .1;
/** Slight further darkening of the bed below water, spread over BANK_SUBMERGED_PX. */
const BANK_SUBMERGED_DARKEN = .1;
const BANK_SUBMERGED_PX = 40;
const BANK_EDGE_SHADE = .12;
/** Signed-distance lattice spacing and cap; the ring covers the widest bank plus its wash. */
const BANK_STEP = 4;
const BANK_FIELD_CAP = 72;
const BANK_RING = Math.ceil((BANK_MAX + 4 + BANK_WASH_PX + BANK_WARP_PX + BANK_STEP) / CELL_SIZE);
/** Maximum visual reach of the riverbank beyond a water cell. No gameplay geometry changes. */
export const WATER_BANK_REACH_PX = BANK_RING * CELL_SIZE;
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
  private dryGrid = new Float32Array(0);
  /** Water occupancy and "bank within reach" per cell; null without water. */
  private readonly water: Uint8Array | null;
  private readonly bankZone: Uint8Array | null;
  private bankGrid = new Float32Array(0);

  constructor(seed: number, dirt: readonly DirtCell[], readonly frame: ChunkWorldFrame,
    water: readonly WaterCell[] = []) {
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
    const wet = new Uint8Array(this.occupied.length);
    let anyWater = false;
    for (const cell of water) {
      if (cell.gridX >= 0 && cell.gridY >= 0 && cell.gridX < this.cols && cell.gridY < this.rows) {
        wet[cell.gridY * this.cols + cell.gridX] = 1;
        anyWater = true;
      }
    }
    this.water = anyWater ? wet : null;
    this.bankZone = anyWater ? new Uint8Array(this.occupied.length) : null;
    if (this.bankZone) for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
      search: for (let dy = -BANK_RING; dy <= BANK_RING; dy++) for (let dx = -BANK_RING; dx <= BANK_RING; dx++) {
        if (wet[this.index(x + dx, y + dy)]) { this.bankZone[y * this.cols + x] = 1; break search; }
      }
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

  /** Broad dry/moist field of the soil; frame-anchored like every other input. */
  private dryness(x: number, y: number): number {
    return this.noise(x, y, 190, 21) * .6 + this.noise(x, y, 67, 22) * .4;
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
   * Signed distance to the union of water cells: negative inside water, positive on land,
   * capped at BANK_FIELD_CAP. Exact for cell squares; the World boundary repeats its edge cells.
   */
  private waterDistance(x: number, y: number): number {
    const water = this.water!;
    const gx = Math.floor(x / CELL_SIZE), gy = Math.floor(y / CELL_SIZE);
    const inside = water[this.index(gx, gy)];
    let best = BANK_FIELD_CAP;
    for (let dy = -BANK_RING; dy <= BANK_RING; dy++) for (let dx = -BANK_RING; dx <= BANK_RING; dx++) {
      if (water[this.index(gx + dx, gy + dy)] === inside) continue;
      const left = (gx + dx) * CELL_SIZE, top = (gy + dy) * CELL_SIZE;
      const ox = Math.max(left - x, 0, x - left - CELL_SIZE), oy = Math.max(top - y, 0, y - top - CELL_SIZE);
      const distance = Math.sqrt(ox * ox + oy * oy);
      if (distance < best) best = distance;
    }
    return inside ? -best : best;
  }

  /**
   * Writes straight (non-premultiplied) RGBA soil for one square region at native resolution.
   * The grass below stays a separate GPU tile; this layer carries soil, the blended seam, the
   * soil wash ahead of it, the contact shade and the riverbank around water. Chunk bakes and
   * snapshots share it.
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
    // Optional drier second soil, mixed by a broad world-fixed field with a ragged border.
    const alt = materials.dirtAlt;
    const d0 = Math.floor((localX + .5) / DRY_STEP), e0 = Math.floor((localY + .5) / DRY_STEP);
    const drySpan = Math.floor((localX + size - .5) / DRY_STEP) - d0 + 2;
    const dryRows = Math.floor((localY + size - .5) / DRY_STEP) - e0 + 2;
    if (alt) {
      if (this.dryGrid.length < drySpan * dryRows) this.dryGrid = new Float32Array(drySpan * dryRows);
      for (let j = 0; j < dryRows; j++) for (let i = 0; i < drySpan; i++) {
        this.dryGrid[j * drySpan + i] = this.dryness((d0 + i) * DRY_STEP, (e0 + j) * DRY_STEP);
      }
    }
    const altColumn = alt ? groundMaterialPhase(localX, alt.width) : 0;
    // Riverbank: signed water distance on its own frame-anchored lattice.
    const bank = this.bankZone && materials.bank && materials.bankWet
      ? { dry: materials.bank, wet: materials.bankWet } : null;
    const b0 = Math.floor((localX + .5) / BANK_STEP), c0 = Math.floor((localY + .5) / BANK_STEP);
    const bankSpan = Math.floor((localX + size - .5) / BANK_STEP) - b0 + 2;
    const bankRows = Math.floor((localY + size - .5) / BANK_STEP) - c0 + 2;
    if (bank) {
      if (this.bankGrid.length < bankSpan * bankRows) this.bankGrid = new Float32Array(bankSpan * bankRows);
      for (let j = 0; j < bankRows; j++) for (let i = 0; i < bankSpan; i++) {
        const bx = (b0 + i) * BANK_STEP, by = (c0 + j) * BANK_STEP;
        this.bankGrid[j * bankSpan + i] = this.waterDistance(
          bx + (this.noise(bx, by, 47, 35) - .5) * BANK_WARP_PX * 1.4 + (this.noise(bx, by, 15, 36) - .5) * BANK_WARP_PX * .6,
          by + (this.noise(bx, by, 53, 37) - .5) * BANK_WARP_PX * 1.4 + (this.noise(bx, by, 17, 38) - .5) * BANK_WARP_PX * .6);
      }
    }
    const bankColumn = bank ? groundMaterialPhase(localX, bank.dry.width) : 0;
    const wetColumn = bank ? groundMaterialPhase(localX, bank.wet.width) : 0;
    for (let py = 0; py < size; py++) {
      const y = localY + py + .5, row = Math.floor(y / CELL_SIZE);
      const v = y / DENSITY_STEP - j0, gj = Math.floor(v), ty = v - gj;
      const dirtRow = groundMaterialPhase(localY + py, dirt.height) * dirt.width;
      const heightRow = groundMaterialPhase(localY + py, grassHeight.height) * grassHeight.width;
      const altRow = alt ? groundMaterialPhase(localY + py, alt.height) * alt.width : 0;
      const dv = y / DRY_STEP - e0, dj = Math.floor(dv), dty = dv - dj;
      const bankRow = bank ? groundMaterialPhase(localY + py, bank.dry.height) * bank.dry.width : 0;
      const wetRow = bank ? groundMaterialPhase(localY + py, bank.wet.height) * bank.wet.width : 0;
      const bv = y / BANK_STEP - c0, bj = Math.floor(bv), bty = bv - bj;
      let dirtX = dirtColumn - 1, heightX = heightColumn - 1, altX = altColumn - 1;
      let bankX = bankColumn - 1, wetX = wetColumn - 1;
      for (let px = 0; px < size; px++) {
        if (++dirtX === dirt.width) dirtX = 0;
        if (++heightX === grassHeight.width) heightX = 0;
        if (alt && ++altX === alt.width) altX = 0;
        if (bank) {
          if (++bankX === bank.dry.width) bankX = 0;
          if (++wetX === bank.wet.width) wetX = 0;
        }
        const out = (py * stride + px) * 4;
        const x = localX + px + .5;
        const cell = this.index(Math.floor(x / CELL_SIZE), row);
        const zone = this.zone[cell];
        const bankCell = bank ? this.bankZone![cell] : 0;
        // Clear all channels: a reused canvas must not keep colour from an earlier region.
        if (!zone && !bankCell) { data.fill(0, out, out + 4); continue; }
        let alpha = 0, r = 0, gr = 0, b = 0;
        if (zone) {
          alpha = 1;
          let shade = 1;
          if (zone === 1) {
            const u = x / DENSITY_STEP - i0, gi = Math.floor(u), tx = u - gi, g = gj * span + gi;
            const top = grid[g] + (grid[g + 1] - grid[g]) * tx;
            const bottom = grid[g + span] + (grid[g + span + 1] - grid[g + span]) * tx;
            const density = top + (bottom - top) * ty;
            if (density <= 0) alpha = 0;
            else {
              const height = grassHeight.data[heightRow + heightX] / 255;
              const soil = this.soil(x, y, density, height);
              const wash = WASH * smooth(clamp01(density * 2));
              alpha = Math.max(soil, wash);
              shade = 1 - SHADE * (1 - smooth(clamp01((density - .5) * 3)));
            }
          }
          if (alpha > 0) {
            const source = (dirtRow + dirtX) * 4;
            r = dirt.rgba[source]; gr = dirt.rgba[source + 1]; b = dirt.rgba[source + 2];
            if (alt) {
              const du = x / DRY_STEP - d0, di = Math.floor(du), dtx = du - di, k = dj * drySpan + di, dg = this.dryGrid;
              const dTop = dg[k] + (dg[k + 1] - dg[k]) * dtx;
              const dBottom = dg[k + drySpan] + (dg[k + drySpan + 1] - dg[k + drySpan]) * dtx;
              const dry = dTop + (dBottom - dTop) * dty + (this.noise(x, y, 6, 23) - .5) * .09;
              const mix = smooth(clamp01((dry - DRY_THRESHOLD) / DRY_SOFT + .5));
              if (mix > 0) {
                const second = (altRow + altX) * 4;
                r += (alt.rgba[second] - r) * mix;
                gr += (alt.rgba[second + 1] - gr) * mix;
                b += (alt.rgba[second + 2] - b) * mix;
              }
            }
            r *= shade; gr *= shade; b *= shade;
          }
        }
        if (bank && bankCell) {
          const bu = x / BANK_STEP - b0, bi = Math.floor(bu), btx = bu - bi, k = bj * bankSpan + bi, bg = this.bankGrid;
          const bTop = bg[k] + (bg[k + 1] - bg[k]) * btx;
          const bBottom = bg[k + bankSpan] + (bg[k + bankSpan + 1] - bg[k + bankSpan]) * btx;
          const distance = bTop + (bBottom - bTop) * bty;
          if (distance < BANK_MAX + 4 + BANK_WASH_PX) {
            // Ragged outer bank edge; grass keeps its tall blades and clumps into the bank.
            const width = BANK_MIN + smooth(this.noise(x, y, 83, 31)) * (BANK_MAX - BANK_MIN) + (this.noise(x, y, 23, 32) - .5) * 8;
            const level = .5 + (width - distance) / BANK_EDGE_SOFT * .5;
            const clump = this.noise(x, y, 6, 12) * .45 + this.noise(x, y, 17, 13) * .55;
            const height = (grassHeight.data[heightRow + heightX] / 255) * (1 - CLUMP) + clump * CLUMP;
            const cover = smooth(clamp01((level - height) / SOFT + .5));
            // A faint damp wash darkens the grass just ahead of the bank.
            const wash = BANK_WASH * smooth(clamp01((width + BANK_WASH_PX - distance) / BANK_WASH_PX));
            const bankAlpha = Math.max(cover, wash);
            if (bankAlpha > 0) {
              // Wet silt at the waterline, rooted humus behind it; both darken as they get wetter.
              const reach = BANK_WET_MIN + this.noise(x, y, 41, 33) * BANK_WET_RANGE;
              const wet = 1 - smooth(clamp01((distance + 6) / reach));
              const silt = smooth(clamp01(wet * 1.3 + (this.noise(x, y, 13, 34) - .5) * .5));
              const dryAt = (bankRow + bankX) * 4, wetAt = (wetRow + wetX) * 4;
              const submerged = smooth(clamp01(-distance / BANK_SUBMERGED_PX));
              const edgeShade = 1 - BANK_EDGE_SHADE * (1 - smooth(clamp01((width - distance) / 8)));
              const shade = (1 - BANK_WET_DARKEN * wet) * (1 - BANK_SUBMERGED_DARKEN * submerged) * edgeShade;
              const dry = bank.dry.rgba, damp = bank.wet.rgba;
              const br = (dry[dryAt] + (damp[wetAt] - dry[dryAt]) * silt) * shade;
              const bgr = (dry[dryAt + 1] + (damp[wetAt + 1] - dry[dryAt + 1]) * silt) * shade;
              const bb = (dry[dryAt + 2] + (damp[wetAt + 2] - dry[dryAt + 2]) * silt) * shade;
              // Bank over soil (straight-alpha "over").
              const below = alpha * (1 - bankAlpha), outAlpha = bankAlpha + below;
              r = (br * bankAlpha + r * below) / outAlpha;
              gr = (bgr * bankAlpha + gr * below) / outAlpha;
              b = (bb * bankAlpha + b * below) / outAlpha;
              alpha = outAlpha;
            }
          }
        }
        if (alpha <= 0) { data.fill(0, out, out + 4); continue; }
        data[out] = r;
        data[out + 1] = gr;
        data[out + 2] = b;
        data[out + 3] = Math.round(alpha * 255);
      }
    }
  }
}
