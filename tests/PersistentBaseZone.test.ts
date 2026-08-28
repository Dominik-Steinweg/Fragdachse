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
    expect(isCellInsidePersistentBaseZone(2, 0, DEFAULT_PERSISTENT_BASE_BUILD_AREA)).toBe(false);
    expect(isCellInsidePersistentBaseZone(0, 2, DEFAULT_PERSISTENT_BASE_BUILD_AREA)).toBe(false);
    expect(isCellInsidePersistentBaseZone(3, 4, { kind: 'radius', radiusCells: 5 })).toBe(true);
  });

  it('keeps the generator reservation at MAX plus clearance', () => {
    const anchor = { gridX: 20, gridY: 20 };
    const reservationRadius = MAX_PERSISTENT_BASE_RADIUS_CELLS + PERSISTENT_BASE_CLEARANCE_CELLS;
    expect(isCellInsidePersistentBaseReservation(32, 20, anchor)).toBe(true);
    expect(isCellInsidePersistentBaseZone(reservationRadius, 0, reservationRadius)).toBe(true);
    expect(isCellInsidePersistentBaseReservation(33, 20, anchor)).toBe(false);
  });
});
