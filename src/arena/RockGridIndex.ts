import { GRID_COLS, GRID_ROWS } from '../config';
import type { RockCell } from '../types';

/**
 * RockGridIndex – Leichtgewichtiger Spatial Index für das Felsen-Grid.
 *
 * Brücke zwischen dem flachen `rocks[]`-Array (Index = Position in ArenaLayout)
 * und Grid-basiertem Nachbar-Lookup für Autotiling.
 * Wird sowohl auf Host als auch auf Clients identisch aufgebaut.
 */
export class RockGridIndex {
  /** Flat Grid: grid[gy * GRID_COLS + gx] = Rock-Index oder -1 */
  private grid: Int16Array;

  constructor(rocks: readonly RockCell[]) {
    this.grid = new Int16Array(GRID_ROWS * GRID_COLS).fill(-1);
    for (let i = 0; i < rocks.length; i++) {
      const { gridX, gridY } = rocks[i];
      this.grid[gridY * GRID_COLS + gridX] = i;
    }
  }

  /** Ist die Gitterzelle von einem Felsen belegt? */
  isOccupied(gx: number, gy: number): boolean {
    if (gx < 0 || gx >= GRID_COLS || gy < 0 || gy >= GRID_ROWS) return false;
    return this.grid[gy * GRID_COLS + gx] !== -1;
  }

  /** Rock-Index an Grid-Position, oder -1 wenn leer. */
  getIndex(gx: number, gy: number): number {
    if (gx < 0 || gx >= GRID_COLS || gy < 0 || gy >= GRID_ROWS) return -1;
    return this.grid[gy * GRID_COLS + gx];
  }

  /** Markiert eine Zelle als leer (nach Zerstörung). */
  remove(gx: number, gy: number): void {
    if (gx < 0 || gx >= GRID_COLS || gy < 0 || gy >= GRID_ROWS) return;
    this.grid[gy * GRID_COLS + gx] = -1;
  }

  /** Gibt Rock-Indizes aller belegten Nachbarzellen zurück (bis zu 8). */
  getNeighborIndices(gx: number, gy: number): number[] {
    const result: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const idx = this.getIndex(gx + dx, gy + dy);
        if (idx !== -1) result.push(idx);
      }
    }
    return result;
  }
}
