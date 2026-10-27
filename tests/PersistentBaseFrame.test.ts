import { describe, expect, it } from 'vitest';
import {
  rotatePersistentBaseOffset,
  rotatePersistentBaseQuarterTurnsClockwise,
  toCanonicalAngle,
  toCanonicalCell,
  toCanonicalFootprintOrigin,
  toWorldAngle,
  toWorldCell,
  toWorldFootprint,
  type PersistentBaseFrame,
  type PersistentBaseQuarterTurns,
} from '../src/persistentBase/PersistentBaseFrame';
import { PersistentBaseContributionStore } from '../src/persistentBase/PersistentBaseContributionStore';
import { DEFAULT_PERSISTENT_BASE_BUILD_AREA } from '../src/persistentBase/PersistentBaseCore';

const QUARTER_TURNS: readonly PersistentBaseQuarterTurns[] = [0, 1, 2, 3];
const anchor = { gridX: 40, gridY: 30 };
const frameOf = (quarterTurns: PersistentBaseQuarterTurns): PersistentBaseFrame => ({ anchor, quarterTurns });
const towerFootprint = [{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 1, dy: 1 }];
const lFootprint = [{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }];

describe('PersistentBaseFrame', () => {
  it('returns to the start after four clockwise quarter turns', () => {
    let quarterTurns: PersistentBaseQuarterTurns = 0;
    const seen: PersistentBaseQuarterTurns[] = [];
    for (let i = 0; i < 4; i += 1) {
      quarterTurns = rotatePersistentBaseQuarterTurnsClockwise(quarterTurns);
      seen.push(quarterTurns);
    }
    expect(seen).toEqual([1, 2, 3, 0]);
    let offset = { dx: 3, dy: -2 };
    for (let i = 0; i < 4; i += 1) offset = rotatePersistentBaseOffset(offset.dx, offset.dy, 1);
    expect(offset).toEqual({ dx: 3, dy: -2 });
  });

  it('turns clockwise on screen: west becomes north', () => {
    expect(toWorldCell(frameOf(1), -3, 0)).toEqual({ gridX: 40, gridY: 27 });
    expect(toWorldCell(frameOf(2), -3, 0)).toEqual({ gridX: 43, gridY: 30 });
  });

  it('maps cells to the world and back for every rotation', () => {
    for (const quarterTurns of QUARTER_TURNS) {
      for (const [x, y] of [[0, 0], [2, -1], [-3, 4], [5, 5]]) {
        const world = toWorldCell(frameOf(quarterTurns), x, y);
        expect(toCanonicalCell(frameOf(quarterTurns), world.gridX, world.gridY), `${quarterTurns}`)
          .toEqual({ relativeGridX: x, relativeGridY: y });
      }
    }
  });

  it('keeps every rotated footprint cell under the turned canonical cell and recovers its origin', () => {
    for (const quarterTurns of QUARTER_TURNS) {
      for (const footprint of [towerFootprint, lFootprint]) {
        const frame = frameOf(quarterTurns);
        const world = toWorldFootprint(frame, 1, 2, footprint);
        const expected = footprint.map(({ dx, dy }) => toWorldCell(frame, 1 + dx, 2 + dy));
        const actual = world.footprint.map(({ dx, dy }) => ({ gridX: world.gridX + dx, gridY: world.gridY + dy }));
        expect(new Set(actual.map((cell) => JSON.stringify(cell)))).toEqual(new Set(expected.map((cell) => JSON.stringify(cell))));
        expect(Math.min(...world.footprint.map((cell) => cell.dx))).toBe(0);
        expect(Math.min(...world.footprint.map((cell) => cell.dy))).toBe(0);
        expect(toCanonicalFootprintOrigin(frame, world.gridX, world.gridY, footprint))
          .toEqual({ relativeGridX: 1, relativeGridY: 2 });
      }
    }
  });

  it('turns start angles with the base and keeps an unturned angle bit-identical', () => {
    expect(toWorldAngle(frameOf(0), 0.7)).toBe(0.7);
    expect(toWorldAngle(frameOf(1), 0)).toBeCloseTo(Math.PI / 2);
    for (const quarterTurns of QUARTER_TURNS) {
      const world = toWorldAngle(frameOf(quarterTurns), 0.7);
      const back = toCanonicalAngle(frameOf(quarterTurns), world);
      expect(Math.cos(back)).toBeCloseTo(Math.cos(0.7));
      expect(Math.sin(back)).toBeCloseTo(Math.sin(0.7));
    }
  });

  it('stores a construction built in a turned room canonically', () => {
    const store = new PersistentBaseContributionStore();
    const frame = frameOf(1);
    const world = toWorldCell(frame, 2, 0);
    store.registerNew('owner-a', { id: 1, gridX: world.gridX, gridY: world.gridY, angle: Math.PI / 2, ownerId: 'player-a', expiresAt: 0 },
      { kind: 'construction', id: 'rock_barrier' }, [{ dx: 0, dy: 0 }], frame, DEFAULT_PERSISTENT_BASE_BUILD_AREA);

    const [blueprint] = store.getContribution('owner-a')!.constructions;
    expect(blueprint).toMatchObject({ relativeGridX: 2, relativeGridY: 0 });
    expect(blueprint.angle).toBeCloseTo(0);
  });
});
