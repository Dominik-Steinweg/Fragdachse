import { describe, expect, it } from 'vitest';
import { FireObstacleIndex } from '../src/effects/FireObstacleIndex';

function createIndex(): FireObstacleIndex {
  return new FireObstacleIndex({
    width: 64,
    height: 64,
    fireCellSize: 16,
    worldOriginX: 0,
    worldOriginY: 0,
    worldCellSize: 32,
  });
}

describe('FireObstacleIndex', () => {
  it('uses numeric fire-grid lookups for blocking and line of sight', () => {
    const index = createIndex();

    index.addStaticRock(3, { left: 32, top: 48, right: 64, bottom: 80 });
    index.addLineOfSightBounds({ left: 96, top: 48, right: 112, bottom: 80 });

    expect(index.isCellBlocked(2, 3)).toBe(true);
    expect(index.isCellBlocked(3, 4)).toBe(true);
    expect(index.hasLineOfSightObstacle(6, 3)).toBe(true);
    expect(index.isCellBlocked(6, 3)).toBe(false);
    expect(index.isCellBlocked(20, 20)).toBe(false);
  });

  it('keeps overlapping obstacles counted until the last one is removed', () => {
    const index = createIndex();

    index.addPlaceableRock(10, 2, 2);
    index.addPlaceableRock(11, 2, 2);
    expect(index.isCellBlocked(4, 4)).toBe(true);

    index.removePlaceableRock(10);
    expect(index.isCellBlocked(4, 4)).toBe(true);

    index.removePlaceableRock(11);
    expect(index.isCellBlocked(4, 4)).toBe(false);
  });

  it('opens a cell after a static rock is destroyed without rebuilding the map', () => {
    const index = createIndex();

    index.addStaticRock(7, { left: 64, top: 64, right: 96, bottom: 96 });
    expect(index.isCellBlocked(4, 4)).toBe(true);
    const revisionAfterBuild = index.revision;

    index.removeStaticRock(7);
    expect(index.isCellBlocked(4, 4)).toBe(false);
    expect(index.revision).toBeGreaterThan(revisionAfterBuild);
  });

  it('tracks base footprints separately from fire-blocking rocks', () => {
    const index = createIndex();

    index.setBase('base-a', [{ left: 128, top: 128, right: 160, bottom: 160 }]);
    expect(index.hasLineOfSightObstacle(8, 8)).toBe(true);
    expect(index.isCellBlocked(8, 8)).toBe(false);

    index.removeBase('base-a');
    expect(index.hasLineOfSightObstacle(8, 8)).toBe(false);
  });
});
