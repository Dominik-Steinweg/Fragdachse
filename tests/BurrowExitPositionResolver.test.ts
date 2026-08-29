import { describe, expect, it, vi } from 'vitest';
import { resolveBurrowExitPosition } from '../src/systems/BurrowExitPositionResolver';
import type { ArenaObstacleIndex } from '../src/systems/ArenaObstacleIndex';
import type { WorldMetrics } from '../src/world/WorldMetrics';
import { worldCellCenter } from '../src/world/WorldMetrics';

function metrics(overrides: Partial<WorldMetrics> = {}): WorldMetrics {
  return {
    widthPx: 256,
    heightPx: 256,
    offsetX: 0,
    offsetY: 0,
    maxX: 256,
    maxY: 256,
    viewportWidth: 256,
    viewportHeight: 256,
    gridCols: 8,
    gridRows: 8,
    trackSpawnMinCol: 0,
    trackSpawnMaxCol: 7,
    usesDynamicCamera: false,
    showStaticFrames: false,
    ...overrides,
  };
}

function obstacleIndex(blocked: (x: number, y: number, radius: number) => boolean): ArenaObstacleIndex {
  return { isCircleBlocked: vi.fn(blocked) } as unknown as ArenaObstacleIndex;
}

describe('BurrowExitPositionResolver', () => {
  it('verwendet eine freie aktuelle Position ohne Korrektur', () => {
    const index = obstacleIndex(() => false);
    const result = resolveBurrowExitPosition(metrics(), index, 20, 48, 16);

    expect(result).toEqual({ x: 20, y: 48 });
    expect(index.isCircleBlocked).toHaveBeenCalledWith(20, 48, 16);
  });

  it('korrigiert in einem vertikalen Ein-Zellen-Gang nur auf die X-Mittellinie', () => {
    const index = obstacleIndex((x, y) => x === 20 && y === 48);
    const result = resolveBurrowExitPosition(metrics(), index, 20, 48, 16);
    const center = worldCellCenter(metrics(), 0, 1);

    expect(result).toEqual({ x: center.x, y: 48 });
  });

  it('korrigiert in einem horizontalen Ein-Zellen-Gang nur auf die Y-Mittellinie', () => {
    const index = obstacleIndex((x, y) => x === 48 && y === 20);
    const result = resolveBurrowExitPosition(metrics(), index, 48, 20, 16);
    const center = worldCellCenter(metrics(), 1, 0);

    expect(result).toEqual({ x: 48, y: center.y });
  });

  it('akzeptiert eine Mittellinie exakt am Assist-Limit', () => {
    const index = obstacleIndex((x, y) => x === 24 && y === 48);
    const result = resolveBurrowExitPosition(metrics(), index, 24, 48, 16);

    expect(result).toEqual({ x: 16, y: 48 });
  });

  it('verwirft eine Mittellinie ausserhalb des Assist-Limits', () => {
    const index = obstacleIndex((x, y) => x === 24.1 && y === 48);
    const result = resolveBurrowExitPosition(metrics(), index, 24.1, 48, 16);

    expect(result).toBeNull();
  });

  it('verwirft einen diagonalen 6-plus-6-px-Kandidaten als ausserhalb des Radius', () => {
    const index = obstacleIndex((x, y) => (
      (x === 22 && y === 22)
      || (x === 16 && y === 22)
      || (x === 22 && y === 16)
    ));
    const result = resolveBurrowExitPosition(metrics(), index, 22, 22, 16);

    expect(result).toBeNull();
  });

  it('verwirft einen Rasterkandidaten, der geometrisch blockiert ist', () => {
    const index = obstacleIndex((x, y) => x === 20 || (x === 16 && y === 48));
    const result = resolveBurrowExitPosition(metrics(), index, 20, 48, 16);

    expect(result).toBeNull();
  });

  it('verwirft einen Kandidaten, dessen Player-Kreis ausserhalb der World läge', () => {
    const world = metrics({ widthPx: 60, maxX: 60, gridCols: 2 });
    const index = obstacleIndex((x, y) => x === 44 && y === 48);
    const result = resolveBurrowExitPosition(world, index, 44, 48, 16);

    expect(result).toBeNull();
  });

  it('nutzt Movement-Input nur bei gleicher Distanz als Tie-Breaker', () => {
    const index = obstacleIndex((x, y) => x === 20 && y === 44);
    const result = resolveBurrowExitPosition(metrics(), index, 20, 44, 16, 0, 1);

    expect(result).toEqual({ x: 20, y: 48 });
  });

  it('bevorzugt den näheren Kandidaten trotz entgegengesetztem Input', () => {
    const index = obstacleIndex((x, y) => x === 19 && y === 42);
    const result = resolveBurrowExitPosition(metrics(), index, 19, 42, 16, 0, 1);

    expect(result).toEqual({ x: 16, y: 42 });
  });

  it('liefert ohne Movement-Input ein stabiles Ergebnis', () => {
    const index = obstacleIndex((x, y) => x === 20 && y === 44);

    const first = resolveBurrowExitPosition(metrics(), index, 20, 44, 16);
    const second = resolveBurrowExitPosition(metrics(), index, 20, 44, 16);

    expect(first).toEqual(second);
    expect(first).toEqual({ x: 16, y: 44 });
  });
});
