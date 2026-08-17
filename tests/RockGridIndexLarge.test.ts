import { describe, expect, it } from 'vitest';
import { RockGridIndex } from '../src/arena/RockGridIndex';
import type { RockCell } from '../src/types';

/**
 * Der Fels-Index bildet Gitterzelle -> Position im `rocks`-Array ab. Der gespeicherte Wert ist
 * also ein **Index**, kein Koordinatenwert – und wuchs damit mit dem Bestand, nicht mit der
 * Kantenlaenge der Karte.
 *
 * Solange er in einem `Int16Array` lag, war das ein versteckter Groessendeckel: Ab 32 768 Felsen
 * lief der Index still ueber und adressierte einen falschen Fels. Der Fehler waere nicht als
 * Absturz aufgefallen, sondern als Autotile- und Overlay-Chaos irgendwo auf der Karte.
 */

const INT16_MAX = 32_767;

function buildRocks(count: number, cols: number): RockCell[] {
  return Array.from({ length: count }, (_, index) => ({
    gridX: index % cols,
    gridY: Math.floor(index / cols),
  }));
}

describe('rock grid index at large arena sizes', () => {
  it('stores rock ids beyond the Int16 range without wrapping', () => {
    const cols = 400;
    const rows = 200;
    const count = INT16_MAX + 5_000;
    const index = new RockGridIndex(buildRocks(count, cols), { cols, rows });

    for (const id of [0, INT16_MAX - 1, INT16_MAX, INT16_MAX + 1, count - 1]) {
      const gridX = id % cols;
      const gridY = Math.floor(id / cols);
      expect(index.getIndex(gridX, gridY)).toBe(id);
      expect(index.isOccupied(gridX, gridY)).toBe(true);
    }
  });

  it('keeps -1 as the empty marker for ids above the Int16 range', () => {
    const cols = 400;
    const rows = 200;
    const count = INT16_MAX + 100;
    const index = new RockGridIndex(buildRocks(count, cols), { cols, rows });

    const lastId = count - 1;
    const gridX = lastId % cols;
    const gridY = Math.floor(lastId / cols);
    index.remove(gridX, gridY);
    expect(index.getIndex(gridX, gridY)).toBe(-1);
    expect(index.isOccupied(gridX, gridY)).toBe(false);
    // Ausserhalb gilt weiterhin als belegt, damit Randkacheln eine geschlossene Kante bekommen.
    expect(index.isOccupiedWithBorder(-1, 0)).toBe(true);
    expect(index.isOccupiedWithBorder(cols, 0)).toBe(true);

    index.set(gridX, gridY, lastId);
    expect(index.getIndex(gridX, gridY)).toBe(lastId);
  });

  it('finds large-id neighbours', () => {
    const cols = 400;
    const rows = 200;
    const index = new RockGridIndex(buildRocks(INT16_MAX + 2_000, cols), { cols, rows });
    const id = INT16_MAX + 1_000;
    const gridX = id % cols;
    const gridY = Math.floor(id / cols);
    const neighbours = index.getNeighborIndices(gridX, gridY);
    expect(neighbours).toContain(id - 1);
    expect(neighbours).toContain(id + 1);
    expect(neighbours.every((value) => value >= 0)).toBe(true);
  });

  it('covers a 400 x 80 grid completely', () => {
    const index = new RockGridIndex(buildRocks(400 * 80, 400), { cols: 400, rows: 80 });
    expect(index.getIndex(399, 79)).toBe(400 * 80 - 1);
    expect(index.getIndex(400, 79)).toBe(-1);
    expect(index.getIndex(399, 80)).toBe(-1);
  });
});
