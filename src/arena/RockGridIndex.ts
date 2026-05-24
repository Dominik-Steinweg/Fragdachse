import { GRID_COLS, GRID_ROWS } from '../config';
import type { RockCell } from '../types';

export interface RockGridIndexDimensions {
  cols: number;
  rows: number;
}

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
  private cols: number;
  private rows: number;

  constructor(rocks: readonly RockCell[], dimensions?: RockGridIndexDimensions) {
    this.cols = dimensions?.cols ?? GRID_COLS;
    this.rows = dimensions?.rows ?? GRID_ROWS;
    this.grid = new Int16Array(this.rows * this.cols).fill(-1);
    for (let i = 0; i < rocks.length; i++) {
      const { gridX, gridY } = rocks[i];
      if (gridX < 0 || gridX >= this.cols || gridY < 0 || gridY >= this.rows) continue;
      this.grid[gridY * this.cols + gridX] = i;
    }
  }

  /** Ist die Gitterzelle von einem Felsen belegt? */
  isOccupied(gx: number, gy: number): boolean {
    if (gx < 0 || gx >= this.cols || gy < 0 || gy >= this.rows) return false;
    return this.grid[gy * this.cols + gx] !== -1;
  }

  /**
   * Wie isOccupied, aber Zellen außerhalb der Arena-Grenzen gelten als belegt.
   * Für Autotiling: Rand-Tiles erhalten eine geschlossene Kante nach außen.
   */
  isOccupiedWithBorder(gx: number, gy: number): boolean {
    if (gx < 0 || gx >= this.cols || gy < 0 || gy >= this.rows) return true;
    return this.grid[gy * this.cols + gx] !== -1;
  }

  /** Rock-Index an Grid-Position, oder -1 wenn leer. */
  getIndex(gx: number, gy: number): number {
    if (gx < 0 || gx >= this.cols || gy < 0 || gy >= this.rows) return -1;
    return this.grid[gy * this.cols + gx];
  }

  /** Markiert eine Zelle als leer (nach Zerstörung). */
  remove(gx: number, gy: number): void {
    if (gx < 0 || gx >= this.cols || gy < 0 || gy >= this.rows) return;
    this.grid[gy * this.cols + gx] = -1;
  }

  /** Belegt oder überschreibt eine Zelle mit einem Rock-Index. */
  set(gx: number, gy: number, rockId: number): void {
    if (gx < 0 || gx >= this.cols || gy < 0 || gy >= this.rows) return;
    this.grid[gy * this.cols + gx] = rockId;
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
