import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE, isCaptureTheBeerBaseCell } from '../config';
import type { ArenaLayout } from '../types';

export type LeafBlowerMaterial = 'grass' | 'dirt' | 'neutral';

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
 */
export function createLeafBlowerMaterialSampler(
  layout: Pick<ArenaLayout, 'dirt' | 'tracks'>,
  baseCells: readonly GridCell[] = [],
): LeafBlowerMaterialSampler {
  const dirtCells = new Set(layout.dirt.map(cellKey));
  const neutralCells = new Set(baseCells.map(cellKey));
  for (const track of layout.tracks) {
    // ArenaVisualFactory zeichnet jede Track-Spalte zwei Zellen breit.
    neutralCells.add(cellKey(track));
    neutralCells.add(`${track.gridX + 1}:${track.gridY}`);
  }

  return {
    sample(worldX, worldY): LeafBlowerMaterial {
      const gridX = Math.floor((worldX - ARENA_OFFSET_X) / CELL_SIZE);
      const gridY = Math.floor((worldY - ARENA_OFFSET_Y) / CELL_SIZE);
      const key = `${gridX}:${gridY}`;
      if (neutralCells.has(key) || isCaptureTheBeerBaseCell(gridX, gridY)) return 'neutral';
      return dirtCells.has(key) ? 'dirt' : 'grass';
    },
  };
}

function cellKey(cell: GridCell): string {
  return `${cell.gridX}:${cell.gridY}`;
}
