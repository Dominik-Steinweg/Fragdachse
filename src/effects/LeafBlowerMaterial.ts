import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE, isCaptureTheBeerBaseCell } from '../config';
import { LEAF_BLOWER_FX } from '../config/leafBlowerEffects';
import { AutoTiler } from '../arena/AutoTiler';
import { waterBlobDistance } from '../arena/WaterSurfaceModel';
import type { ArenaLayout } from '../types';

export type LeafBlowerMaterial = 'grass' | 'dirt' | 'neutral' | 'water';

export interface LeafBlowerMaterialSampler {
  sample(worldX: number, worldY: number): LeafBlowerMaterial;
}

interface GridCell {
  readonly gridX: number;
  readonly gridY: number;
}

/**
 * LeafBlower-spezifische Materialklassifikation. Sie liest nur die bereits autoritativen
 * Layoutzellen; Ground Cover und Decals sind absichtlich keine eigenen Materialien.
 *
 * Wasser folgt derselben 47-Blob-Uferkontur wie die Wasserdarstellung, damit das Laub genau
 * an der sichtbaren Uferlinie aufhört und nicht an der eckigen Zellgrenze.
 */
export function createLeafBlowerMaterialSampler(
  layout: Pick<ArenaLayout, 'dirt' | 'tracks' | 'water'>,
  baseCells: readonly GridCell[] = [],
): LeafBlowerMaterialSampler {
  const dirtCells = new Set(layout.dirt.map(cellKey));
  const neutralCells = new Set(baseCells.map(cellKey));
  for (const track of layout.tracks) {
    // ArenaVisualFactory zeichnet jede Track-Spalte zwei Zellen breit.
    neutralCells.add(cellKey(track));
    neutralCells.add(`${track.gridX + 1}:${track.gridY}`);
  }
  const waterCells = new Set((layout.water ?? []).map(cellKey));
  const waterMasks = new Map<string, number>();
  for (const cell of layout.water ?? []) {
    waterMasks.set(cellKey(cell), AutoTiler.computeMask(cell.gridX, cell.gridY,
      (x, y) => waterCells.has(`${x}:${y}`)));
  }

  return {
    sample(worldX, worldY): LeafBlowerMaterial {
      const gridX = Math.floor((worldX - ARENA_OFFSET_X) / CELL_SIZE);
      const gridY = Math.floor((worldY - ARENA_OFFSET_Y) / CELL_SIZE);
      const key = `${gridX}:${gridY}`;
      const waterMask = waterMasks.get(key);
      if (waterMask !== undefined) {
        const localX = worldX - ARENA_OFFSET_X - gridX * CELL_SIZE;
        const localY = worldY - ARENA_OFFSET_Y - gridY * CELL_SIZE;
        if (waterBlobDistance(waterMask, localX, localY) > LEAF_BLOWER_FX.waterDepthPx) return 'water';
      }
      if (neutralCells.has(key) || isCaptureTheBeerBaseCell(gridX, gridY)) return 'neutral';
      return dirtCells.has(key) ? 'dirt' : 'grass';
    },
  };
}

function cellKey(cell: GridCell): string {
  return `${cell.gridX}:${cell.gridY}`;
}
