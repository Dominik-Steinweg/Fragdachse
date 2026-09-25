import { CELL_SIZE } from '../config';
import type { ArenaTrackColumnSpec } from './ArenaVisualFactory';
import type { ChunkWorldFrame } from './chunks/ArenaChunkGrid';
import { hashSeededCell01 } from './CellHash';
import { groundMaterialPhase } from './GroundMaterialConfig';
import type { GroundMaterialPixels } from './GroundMaterialSamples';
import { TRACK_BALLAST_REACH_PX, TRACK_GRAVEL_CONFIG as CONFIG } from './TrackGravelConfig';

export interface TrackBallastMaterials {
  readonly gravel: GroundMaterialPixels;
  readonly soil: GroundMaterialPixels;
}

/** Rail-local lateral profile, in world pixels from the column's left edge. */
export interface TrackBallastProfile {
  readonly shoulderLeft: number;
  readonly coreLeft: number;
  readonly coreRight: number;
  readonly shoulderRight: number;
}

const smooth = (v: number): number => {
  const t = Math.max(0, Math.min(1, v));
  return t * t * (3 - 2 * t);
};

function edgeNoise(seed: number, gridX: number, y: number, period: number, salt: number): number {
  const cell = Math.floor(y / period);
  const t = y / period - cell;
  const weight = t * t * (3 - 2 * t);
  const a = hashSeededCell01(seed, gridX, cell, salt);
  return a + (hashSeededCell01(seed, gridX, cell + 1, salt) - a) * weight;
}

/** 2-D value noise on world-fixed cells; used for stone clumps in the shoulder. */
function clumpNoise(seed: number, x: number, y: number, period: number, salt: number): number {
  const u = x / period, v = y / period, i = Math.floor(u), j = Math.floor(v);
  const tx = u - i, ty = v - j, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = hashSeededCell01(seed, i, j, salt), b = hashSeededCell01(seed, i + 1, j, salt);
  const c = hashSeededCell01(seed, i, j + 1, salt), d = hashSeededCell01(seed, i + 1, j + 1, salt);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

/**
 * Both sides vary independently and continuously along the line; y is measured from the world
 * frame, never a chunk.
 */
export function getTrackBallastProfile(seed: number, gridX: number, y: number): TrackBallastProfile {
  const overhang = (salt: number) => CONFIG.minCoreOverhangPx + (CONFIG.maxCoreOverhangPx - CONFIG.minCoreOverhangPx)
    * (0.75 * edgeNoise(seed, gridX, y, 16, salt) + 0.25 * edgeNoise(seed, gridX, y, 5, salt + 1));
  const shoulder = (salt: number) => CONFIG.minShoulderPx + (CONFIG.maxShoulderPx - CONFIG.minShoulderPx)
    * (0.7 * edgeNoise(seed, gridX, y, 56, salt) + 0.3 * edgeNoise(seed, gridX, y, 13, salt + 1));
  const coreLeft = CONFIG.sleeperLeftPx - overhang(0x7321);
  const coreRight = CONFIG.sleeperRightPx + overhang(0x7323);
  return {
    shoulderLeft: coreLeft - shoulder(0x7331),
    coreLeft,
    coreRight,
    shoulderRight: coreRight + shoulder(0x7333),
  };
}

/**
 * Writes the ballast bed as straight RGBA for one square region at native resolution: grey
 * ballast from the gravel material, dense under the sleepers and thinning into scattered stone
 * clumps across the shoulder, over a dark compacted soil bed. Pure function of seed, columns,
 * frame and world position, so chunk bakes, gutters and snapshots agree exactly. Overlapping
 * beds keep the more opaque pixel.
 */
export function writeTrackBallast(
  data: Uint8ClampedArray,
  stride: number,
  seed: number,
  columns: readonly ArenaTrackColumnSpec[],
  frame: ChunkWorldFrame,
  region: { worldX: number; worldY: number; size: number },
  materials: TrackBallastMaterials,
): void {
  data.fill(0);
  const { gravel, soil } = materials;
  for (const column of columns) {
    if (column.x - TRACK_BALLAST_REACH_PX >= region.worldX + region.size
      || column.x + column.width + TRACK_BALLAST_REACH_PX <= region.worldX) continue;
    const gridX = Math.round((column.x - frame.offsetX) / CELL_SIZE);
    for (let y = 0; y < region.size; y += 1) {
      const worldY = region.worldY + y + 0.5;
      if (worldY < column.y || worldY >= column.y + column.height) continue;
      const localY = worldY - frame.offsetY;
      const profile = getTrackBallastProfile(seed, gridX, localY);
      const minX = Math.max(0, Math.floor(column.x + profile.shoulderLeft - region.worldX));
      const maxX = Math.min(region.size, Math.ceil(column.x + profile.shoulderRight - region.worldX));
      const gravelRow = groundMaterialPhase(Math.floor(localY), gravel.height) * gravel.width;
      const soilRow = groundMaterialPhase(Math.floor(localY), soil.height) * soil.width;
      for (let x = minX; x < maxX; x += 1) {
        const worldX = region.worldX + x + 0.5;
        const railX = worldX - column.x;
        // 0 inside the dense core, 1 at the outer end of the shoulder.
        const out = railX < profile.coreLeft
          ? (profile.coreLeft - railX) / (profile.coreLeft - profile.shoulderLeft)
          : railX > profile.coreRight
            ? (railX - profile.coreRight) / (profile.shoulderRight - profile.coreRight)
            : 0;
        if (out >= 1) continue;
        const localX = worldX - frame.offsetX;
        const g = (gravelRow + groundMaterialPhase(Math.floor(localX), gravel.width)) * 4;
        const s = (soilRow + groundMaterialPhase(Math.floor(localX), soil.width)) * 4;
        const gr = gravel.rgba[g], gg = gravel.rgba[g + 1], gb = gravel.rgba[g + 2];
        const luma = (gr * .3 + gg * .59 + gb * .11) / 255;

        // Bright stones of the material survive longest; clumps keep them together as groups.
        const clump = clumpNoise(seed, localX, localY, CONFIG.stoneClumpPx, 0x7351);
        const stone = luma * 1.6 - .25 + (clump - .5) * .6;
        const threshold = CONFIG.coreGapThreshold + Math.pow(out, .8) * (1.05 - CONFIG.coreGapThreshold);
        const stoneAlpha = smooth((stone - threshold) / CONFIG.stoneSoftness + .5);
        // The compacted soil bed fades out a little before the last stones.
        const soilAlpha = CONFIG.soilBedAlpha * (1 - smooth(out * 1.15)) * (.75 + .5 * clumpNoise(seed, localX, localY, 23, 0x7353));
        const alpha = stoneAlpha + soilAlpha * (1 - stoneAlpha);
        if (alpha <= 0) continue;
        const i = (y * stride + x) * 4;
        if (alpha * 255 <= data[i + 3]) continue;

        const grey = luma * 255;
        const ballast = (c: number, tint: number) =>
          (c + (grey - c) * CONFIG.ballastDesaturate) * CONFIG.ballastGain * tint;
        const soilWeight = soilAlpha * (1 - stoneAlpha);
        const mix = (stoneColor: number, soilColor: number) =>
          (stoneColor * stoneAlpha + soilColor * CONFIG.soilBedDarken * soilWeight) / alpha;
        data[i] = mix(ballast(gr, .97), soil.rgba[s]);
        data[i + 1] = mix(ballast(gg, .99), soil.rgba[s + 1]);
        data[i + 2] = mix(ballast(gb, 1.03), soil.rgba[s + 2]);
        data[i + 3] = Math.round(alpha * 255);
      }
    }
  }
}
