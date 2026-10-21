import { CELL_SIZE } from '../config';
import type { BaseVisualCell } from '../entities/BaseVisuals';
import type { WorldMetrics } from '../world/WorldMetrics';
import { SeededValueNoise } from './SeededValueNoise';
import { groundMaterialPhase } from './GroundMaterialConfig';
import type { GrassHeightMap, GroundMaterialPixels } from './GroundMaterialSamples';

export interface BaseApronMaterials {
  readonly soil: GroundMaterialPixels;
  readonly gravel: GroundMaterialPixels;
  readonly grassHeight: GrassHeightMap;
}

/** World-pixel raster of one apron; its origin is the top-left world pixel. */
export interface BaseApronRaster {
  readonly worldX: number;
  readonly worldY: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Trodden foundation ground around a base: compacted, moist soil with crushed gravel against the
 * platform, a width that wanders from grass right at the plates to a worn patch, a seam that
 * frays into the actual grass blades and loose stones beyond it. World pixels.
 */
export const BASE_APRON_CONFIG = {
  /** Apron width beyond the footprint, before the edge warp; mostly modest, sometimes wide. */
  minWidthPx: -3,
  maxWidthPx: 30,
  /** Two-dimensional meander of the apron edge. */
  edgeWarpPx: 7,
  /** Density ramp of the outer edge; the grass seam works within it. */
  seamPx: 12,
  /** Dark, damp contact strip right at the plates. */
  contactPx: 4,
  contactShade: 0.3,
  /** Compacted soil is darker than the open soil of the World and greyed by dust. */
  soilDarken: 0.92,
  soilDust: 0.35,
  /** Crushed gravel against the platform, thinning out across the apron. */
  gravelDesaturate: 0.5,
  gravelGain: 0.68,
  /** Loose gravel beyond the apron edge. */
  scatterPx: 7,
} as const;

/** Maximum visual reach beyond the footprint; no gameplay geometry changes. */
export const BASE_APRON_REACH_PX = Math.ceil(BASE_APRON_CONFIG.maxWidthPx + BASE_APRON_CONFIG.edgeWarpPx * .75
  + BASE_APRON_CONFIG.seamPx * .5 + BASE_APRON_CONFIG.scatterPx);

/** Coordinate-local noise: independent of entity IDs, faction, cell order and peer RNG. */
const APRON_SEED = 0x5ba5e;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number): number => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

/** World raster covering the footprint and the apron's full reach. */
export function getBaseApronRaster(
  cells: readonly BaseVisualCell[],
  metrics: Pick<WorldMetrics, 'offsetX' | 'offsetY'>,
): BaseApronRaster | null {
  if (cells.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const cell of cells) {
    minX = Math.min(minX, cell.gridX); minY = Math.min(minY, cell.gridY);
    maxX = Math.max(maxX, cell.gridX + 1); maxY = Math.max(maxY, cell.gridY + 1);
  }
  const reach = BASE_APRON_REACH_PX;
  return {
    worldX: metrics.offsetX + minX * CELL_SIZE - reach,
    worldY: metrics.offsetY + minY * CELL_SIZE - reach,
    width: (maxX - minX) * CELL_SIZE + reach * 2,
    height: (maxY - minY) * CELL_SIZE + reach * 2,
  };
}

/**
 * Writes the apron as straight RGBA into `data` (raster width × height). Pure function of the
 * footprint, the World frame and the shared ground materials, so every peer and rebuild draws the
 * same ground. Under the footprint itself the ground stays compacted soil: a destroyed cell
 * leaves its bare foundation, not grass.
 */
export function writeBaseApron(
  data: Uint8ClampedArray,
  raster: BaseApronRaster,
  cells: readonly BaseVisualCell[],
  metrics: Pick<WorldMetrics, 'offsetX' | 'offsetY'>,
  materials: BaseApronMaterials,
): void {
  data.fill(0);
  const C = BASE_APRON_CONFIG;
  const lattice = new SeededValueNoise(APRON_SEED);
  const noise = (x: number, y: number, period: number, salt: number) => lattice.sample(x, y, period, salt);
  const { soil, gravel, grassHeight } = materials;
  // Footprint occupancy on a small grid around the raster, so each pixel tests numbers only.
  // A cell further than this many cells away is beyond the apron's reach from any pixel.
  const ring = Math.ceil(BASE_APRON_REACH_PX / CELL_SIZE);
  const gridLeft = Math.floor((raster.worldX - metrics.offsetX) / CELL_SIZE) - ring;
  const gridTop = Math.floor((raster.worldY - metrics.offsetY) / CELL_SIZE) - ring;
  const gridCols = Math.ceil(raster.width / CELL_SIZE) + ring * 2 + 2;
  const gridRows = Math.ceil(raster.height / CELL_SIZE) + ring * 2 + 2;
  const occupied = new Uint8Array(gridCols * gridRows);
  for (const cell of cells) occupied[(cell.gridY - gridTop) * gridCols + cell.gridX - gridLeft] = 1;
  const reach2 = BASE_APRON_REACH_PX * BASE_APRON_REACH_PX;
  for (let py = 0; py < raster.height; py++) {
    const y = raster.worldY + py + .5 - metrics.offsetY;
    const gy = Math.floor(y / CELL_SIZE);
    const soilRow = groundMaterialPhase(Math.floor(y), soil.height) * soil.width;
    const gravelRow = groundMaterialPhase(Math.floor(y), gravel.height) * gravel.width;
    const heightRow = groundMaterialPhase(Math.floor(y), grassHeight.height) * grassHeight.width;
    for (let px = 0; px < raster.width; px++) {
      const x = raster.worldX + px + .5 - metrics.offsetX;
      const gx = Math.floor(x / CELL_SIZE);
      // Exact distance to the union of footprint squares (0 inside).
      let nearest = reach2;
      for (let dy = -ring; dy <= ring && nearest > 0; dy++) {
        const rowStart = (gy + dy - gridTop) * gridCols - gridLeft;
        const top = (gy + dy) * CELL_SIZE;
        const oy = top > y ? top - y : y > top + CELL_SIZE ? y - top - CELL_SIZE : 0;
        for (let dx = -ring; dx <= ring; dx++) {
          if (!occupied[rowStart + gx + dx]) continue;
          const left = (gx + dx) * CELL_SIZE;
          const ox = left > x ? left - x : x > left + CELL_SIZE ? x - left - CELL_SIZE : 0;
          const d2 = ox * ox + oy * oy;
          if (d2 < nearest) nearest = d2;
        }
      }
      if (nearest >= reach2) continue;
      const distance = Math.sqrt(nearest);
      const inside = distance === 0;
      // Soil cover: solid inside, a grass seam at the outer edge driven by the real blade height.
      // Outside, the edge meanders and its width wanders around the perimeter.
      let soilAlpha = 1, warped = 0, width = 0;
      if (!inside) {
        warped = distance + (noise(x, y, 17, 1) - .5) * C.edgeWarpPx + (noise(x, y, 6, 2) - .5) * C.edgeWarpPx * .5;
        const wide = smooth(noise(x, y, 71, 3) * .91 + noise(x, y, 29, 4) * .39 - .15);
        width = C.minWidthPx + (C.maxWidthPx - C.minWidthPx) * wide * Math.sqrt(wide);
        const level = .5 + (width - warped) / C.seamPx * .5;
        const blade = grassHeight.data[heightRow + groundMaterialPhase(Math.floor(x), grassHeight.width)] / 255;
        const tuft = noise(x, y, 5, 5) * .45 + noise(x, y, 13, 6) * .55;
        soilAlpha = smooth((level - (blade * .5 + tuft * .5)) / .07 + .5);
      }
      // Crushed gravel: dense at the plates, thinning across the apron, a few stones beyond it.
      const g = (gravelRow + groundMaterialPhase(Math.floor(x), gravel.width)) * 4;
      const gr = gravel.rgba[g], gg = gravel.rgba[g + 1], gb = gravel.rgba[g + 2];
      const luma = (gr * .3 + gg * .59 + gb * .11) / 255;
      const stone = luma * 1.6 - .25 + (noise(x, y, 4, 7) - .5) * .7;
      const across = inside ? 0 : clamp01(warped / Math.max(4, width + C.scatterPx));
      // Gravel lies in drifts: broad patches where it gathers, bare soil in between.
      const drift = noise(x, y, 23, 8) * .65 + noise(x, y, 9, 10) * .35;
      const threshold = .5 + across * .6 + (.5 - drift) * .9;
      let stoneAlpha = smooth((stone - threshold) / .12 + .5);
      if (!inside && warped > width + C.scatterPx) stoneAlpha = 0;
      const alpha = stoneAlpha + soilAlpha * (1 - stoneAlpha);
      if (alpha <= 0) continue;

      const s = (soilRow + groundMaterialPhase(Math.floor(x), soil.width)) * 4;
      // Moist and compacted at the plates, a little drier outwards; patchy along the perimeter.
      const damp = C.soilDarken * (.9 + .2 * noise(x, y, 37, 9));
      // Trodden soil loses some of its warmth to dust.
      const sr = soil.rgba[s], sg = soil.rgba[s + 1], sb = soil.rgba[s + 2];
      const dust = (sr * .3 + sg * .59 + sb * .11) * C.soilDust;
      const contact = inside ? 1 - C.contactShade : 1 - C.contactShade * (1 - smooth(distance / C.contactPx));
      const grey = luma * 255, desaturate = C.gravelDesaturate;
      const stoneGain = C.gravelGain * stoneAlpha, soilGain = damp * soilAlpha * (1 - stoneAlpha);
      const keep = 1 - C.soilDust, normalize = contact / alpha;
      const out = (py * raster.width + px) * 4;
      data[out] = ((gr + (grey - gr) * desaturate) * stoneGain + (sr * keep + dust) * soilGain) * normalize;
      data[out + 1] = ((gg + (grey - gg) * desaturate) * stoneGain + (sg * keep + dust) * soilGain) * normalize;
      data[out + 2] = ((gb + (grey - gb) * desaturate) * 1.02 * stoneGain + (sb * keep + dust) * soilGain) * normalize;
      data[out + 3] = Math.round(alpha * 255);
    }
  }
}
