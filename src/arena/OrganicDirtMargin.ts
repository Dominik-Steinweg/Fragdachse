import type { DirtCell } from '../types';

/**
 * Wahrscheinlichkeitsregel fuer die diagonalen Zellen am Dirt-Rand.
 *
 * Kardinale Nachbarn bleiben immer erhalten, damit eine gerade Kante nicht ausfranst.
 * Diagonalen werden dagegen bewusst ausgeduennt: So folgt der 47-Blob-Rand der
 * organischen Arena-Geometrie, statt einen zweiten parallelen 8er-Ring zu bilden.
 */
export const ORGANIC_DIRT_MARGIN_DIAGONAL_CHANCE = 0.55;

export interface OrganicDirtMarginOptions {
  readonly maxCols: number;
  readonly maxRows: number;
  readonly rng: () => number;
  readonly diagonalChance?: number;
  readonly isReservedCell?: (gridX: number, gridY: number) => boolean;
}

/**
 * Erzeugt den ein-zelligen Dirt-Saum um Felsen, Gleise oder andere belegte Zellen.
 *
 * Die Funktion ist absichtlich geometrieunabhaengig: Generator und authored World-Layouts
 * verwenden exakt dieselbe Randregel, waehrend ihre Layout- und Reserveflaechen getrennt bleiben.
 */
export function createOrganicDirtMargin(
  cells: ReadonlyArray<{ gridX: number; gridY: number }>,
  options: OrganicDirtMarginOptions,
): DirtCell[] {
  const diagonalChance = options.diagonalChance ?? ORGANIC_DIRT_MARGIN_DIAGONAL_CHANCE;
  const isReservedCell = options.isReservedCell ?? (() => false);
  const keys = new Set<number>();

  for (const { gridX, gridY } of cells) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nextX = gridX + dx;
        const nextY = gridY + dy;
        if (nextX < 0 || nextY < 0 || nextX >= options.maxCols || nextY >= options.maxRows) continue;
        if (isReservedCell(nextX, nextY)) continue;

        const isDiagonal = dx !== 0 && dy !== 0;
        if (isDiagonal && options.rng() >= diagonalChance) continue;
        keys.add(nextY * options.maxCols + nextX);
      }
    }
  }

  return Array.from(keys, (key) => ({
    gridX: key % options.maxCols,
    gridY: Math.floor(key / options.maxCols),
  }));
}
