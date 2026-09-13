import { CELL_SIZE } from '../config';
import type { ArenaTrackColumnSpec } from './ArenaVisualFactory';
import type { ChunkWorldFrame } from './chunks/ArenaChunkGrid';
import type { GroundCoverStampPlacement } from './GroundCoverField';
import { hashSeededCell01 } from './CellHash';
import { TRACK_GRAVEL_CONFIG as CONFIG, TRACK_GRAVEL_TEXTURE_KEYS } from './TrackGravelConfig';

export interface TrackGravelPlacement extends GroundCoverStampPlacement {
  readonly tint: number;
}

/** Two staggered lanes cover the bed without repeating one tile along the railway. */
export function generateTrackGravelPlacements(
  seed: number,
  columns: readonly ArenaTrackColumnSpec[],
  frame: ChunkWorldFrame,
): TrackGravelPlacement[] {
  const placements: TrackGravelPlacement[] = [];
  for (const column of [...columns].sort((a, b) => a.x - b.x)) {
    const gridX = Math.round((column.x - frame.offsetX) / CELL_SIZE);
    const first = Math.floor((column.y - frame.offsetY) / CONFIG.stampStepPx) - 2;
    const last = Math.ceil((column.y + column.height - frame.offsetY) / CONFIG.stampStepPx) + 2;
    for (let row = first; row <= last; row += 1) {
      for (let lane = 0; lane < 2; lane += 1) {
        const random = (salt: number) => hashSeededCell01(seed, gridX * 2 + lane, row, salt);
        const anchorY = (row + lane * 0.5) * CONFIG.stampStepPx;
        const brightnessField = 0.7 * edgeNoise(seed, gridX * 2 + lane, anchorY, 160, 0x7331)
          + 0.3 * edgeNoise(seed, gridX * 2 + lane, anchorY, 64, 0x7332);
        const value = Math.round(255 * (CONFIG.minBrightness
          + brightnessField * (CONFIG.maxBrightness - CONFIG.minBrightness)));
        placements.push({
          textureKey: TRACK_GRAVEL_TEXTURE_KEYS[Math.floor(random(0x7311) * TRACK_GRAVEL_TEXTURE_KEYS.length)],
          worldX: column.x + 20 + lane * 24 + (random(0x7312) - 0.5) * 10,
          worldY: frame.offsetY + (row + lane * 0.5) * CONFIG.stampStepPx + (random(0x7313) - 0.5) * 8,
          sizePx: CONFIG.minStampSizePx + random(0x7314) * (CONFIG.maxStampSizePx - CONFIG.minStampSizePx),
          rotation: random(0x7315) * Math.PI * 2,
          mirrorX: random(0x7316) < 0.5,
          mirrorY: random(0x7317) < 0.5,
          alpha: 1,
          tint: (value << 16) | (value << 8) | value,
        });
      }
    }
  }
  return placements;
}

function edgeNoise(seed: number, gridX: number, y: number, period: number, salt: number): number {
  const cell = Math.floor(y / period);
  const t = y / period - cell;
  const weight = t * t * (3 - 2 * t);
  const a = hashSeededCell01(seed, gridX, cell, salt);
  return a + (hashSeededCell01(seed, gridX, cell + 1, salt) - a) * weight;
}

/** Rail-local horizontal bounds; y is measured from the world frame, never a chunk. */
export function getTrackGravelEdges(seed: number, gridX: number, y: number): readonly [number, number] {
  const reach = (salt: number) => CONFIG.minOverhangPx
    + (CONFIG.maxOverhangPx - CONFIG.minOverhangPx)
      * (0.75 * edgeNoise(seed, gridX, y, 16, salt) + 0.25 * edgeNoise(seed, gridX, y, 4, salt + 1));
  return [CONFIG.sleeperLeftPx - reach(0x7321), CONFIG.sleeperRightPx + reach(0x7323)];
}

/** Inverse alpha mask for erase(). Reused storage, exact world anchoring and subpixel edges. */
export function writeTrackGravelCutout(
  data: Uint8ClampedArray,
  stride: number,
  seed: number,
  columns: readonly ArenaTrackColumnSpec[],
  frame: ChunkWorldFrame,
  region: { worldX: number; worldY: number; size: number },
): void {
  data.fill(255);
  for (const column of columns) {
    if (column.x - CONFIG.maxOverhangPx >= region.worldX + region.size
      || column.x + column.width + CONFIG.maxOverhangPx <= region.worldX) continue;
    const gridX = Math.round((column.x - frame.offsetX) / CELL_SIZE);
    for (let y = 0; y < region.size; y += 1) {
      const worldY = region.worldY + y + 0.5;
      if (worldY < column.y || worldY >= column.y + column.height) continue;
      const [left, right] = getTrackGravelEdges(seed, gridX, worldY - frame.offsetY);
      const minX = column.x + left - region.worldX;
      const maxX = column.x + right - region.worldX;
      for (let x = Math.max(0, Math.floor(minX)); x < Math.min(region.size, Math.ceil(maxX)); x += 1) {
        let coverage = Math.max(0, Math.min(1, x + 1 - minX, maxX - x));
        const edgeDistance = Math.min(x + 0.5 - minX, maxX - x - 0.5);
        if (edgeDistance < CONFIG.fringeWidthPx) {
          const grain = hashSeededCell01(seed,
            Math.floor(region.worldX + x - frame.offsetX), Math.floor(worldY - frame.offsetY), 0x7341);
          // A sparse, stone-sized fringe inside the envelope, not a uniformly blurred ribbon.
          if (grain > Math.max(0, edgeDistance) / CONFIG.fringeWidthPx) coverage = 0;
        }
        const i = (y * stride + x) * 4 + 3;
        // Union of all railway beds; a neighbouring column must not erase another one.
        data[i] = Math.min(data[i], Math.round(255 * (1 - coverage)));
      }
    }
  }
}
