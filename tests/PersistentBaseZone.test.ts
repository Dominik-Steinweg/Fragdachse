import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PERSISTENT_BASE_RADIUS_CELLS,
  MAX_PERSISTENT_BASE_RADIUS_CELLS,
  PERSISTENT_BASE_CLEARANCE_CELLS,
} from '../src/config/persistentBase';
import { DEFAULT_PERSISTENT_BASE_BUILD_AREA } from '../src/persistentBase/PersistentBaseCore';
import {
  isCellInsidePersistentBaseReservation,
  isCellInsidePersistentBaseZone,
  isPersistentFootprintInsideZone,
} from '../src/persistentBase/PersistentBaseZone';

describe('persistent base zone', () => {
  it('uses the inclusive circular cell contract', () => {
    expect(isCellInsidePersistentBaseZone(0, 0, DEFAULT_PERSISTENT_BASE_RADIUS_CELLS)).toBe(true);
    expect(isCellInsidePersistentBaseZone(3, 4, 5)).toBe(true);
    expect(isCellInsidePersistentBaseZone(4, 4, 5)).toBe(false);
    expect(isCellInsidePersistentBaseZone(5, 0, 5)).toBe(true);
    expect(isCellInsidePersistentBaseZone(6, 0, 5)).toBe(false);
  });

  it('requires every footprint cell to be inside the active zone', () => {
    const anchor = { gridX: 10, gridY: 10 };
    expect(isPersistentFootprintInsideZone(
      10,
      10,
      [{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }],
      anchor,
      1,
    )).toBe(true);
    expect(isPersistentFootprintInsideZone(
      10,
      10,
      [{ dx: 0, dy: 0 }, { dx: 2, dy: 0 }],
      anchor,
      1,
    )).toBe(false);
  });

  it('supports the current fixed square and a future radius build area', () => {
    expect(isCellInsidePersistentBaseZone(1, 1, DEFAULT_PERSISTENT_BASE_BUILD_AREA)).toBe(true);
    expect(isCellInsidePersistentBaseZone(1, -1, DEFAULT_PERSISTENT_BASE_BUILD_AREA)).toBe(true);
    expect(isCellInsidePersistentBaseZone(4, 0, DEFAULT_PERSISTENT_BASE_BUILD_AREA)).toBe(false);
    expect(isCellInsidePersistentBaseZone(0, 4, DEFAULT_PERSISTENT_BASE_BUILD_AREA)).toBe(false);
    expect(isCellInsidePersistentBaseZone(3, 4, { kind: 'radius', radiusCells: 5 })).toBe(true);
  });

  it('gives every radius build area three-cell tips in all four directions', () => {
    for (let radiusCells = 1; radiusCells <= MAX_PERSISTENT_BASE_RADIUS_CELLS + 1; radiusCells++) {
      const area = { kind: 'radius', radiusCells } as const;
      for (const [axisX, axisY] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (let offset = -2; offset <= 2; offset++) {
          expect(isCellInsidePersistentBaseZone(
            axisX * radiusCells - axisY * offset,
            axisY * radiusCells + axisX * offset, area,
          )).toBe(Math.abs(offset) <= 1);
        }
        expect(isCellInsidePersistentBaseZone(
          axisX * (radiusCells + 1), axisY * (radiusCells + 1), area,
        )).toBe(false);
        expect(isPersistentFootprintInsideZone(
          axisX * radiusCells, axisY * radiusCells,
          [-1, 0, 1].map((offset) => ({ dx: -axisY * offset, dy: axisX * offset })),
          { gridX: 0, gridY: 0 }, area,
        )).toBe(true);
      }
      // Abseits der Achsen bleibt die Kreisgrenze unveraendert.
      for (let x = 2; x <= radiusCells; x++) {
        for (let y = 2; y <= radiusCells; y++) {
          expect(isCellInsidePersistentBaseZone(x, y, area))
            .toBe(x * x + y * y <= radiusCells * radiusCells);
        }
      }
    }
    expect(isCellInsidePersistentBaseZone(0, 0, { kind: 'radius', radiusCells: 0 })).toBe(true);
    expect(isCellInsidePersistentBaseZone(1, 0, { kind: 'radius', radiusCells: 0 })).toBe(false);
  });

  it('keeps the generator reservation at MAX plus clearance', () => {
    const anchor = { gridX: 20, gridY: 20 };
    const reservationRadius = MAX_PERSISTENT_BASE_RADIUS_CELLS + PERSISTENT_BASE_CLEARANCE_CELLS;
    expect(isCellInsidePersistentBaseReservation(32, 20, anchor)).toBe(true);
    expect(isCellInsidePersistentBaseZone(reservationRadius, 0, reservationRadius)).toBe(true);
    expect(isCellInsidePersistentBaseReservation(33, 20, anchor)).toBe(false);
  });
});
