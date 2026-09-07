import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({}));
import { createWorldGeometryQueries } from '../src/world/WorldGeometryQueries';
import type { ArenaObstacleIndex } from '../src/systems/ArenaObstacleIndex';
import type { WorldMetrics } from '../src/world/WorldMetrics';

describe('World-owned safe ground placement', () => {
  const metrics = { offsetX: 0, offsetY: 0, widthPx: 128, heightPx: 128 } as WorldMetrics;
  it('clamps bounds, avoids blockers and moving train, and is deterministic', () => {
    const index = { isCircleBlocked: (x: number) => x < 20 } as ArenaObstacleIndex;
    const queries = createWorldGeometryQueries({ metrics, index, getTrainBounds: () => ({ x: 50, y: 50, width: 24, height: 24 }) as never });
    const first = queries.resolveSafeGroundPoint(-5, 64, 3)!;
    expect(first).toEqual(queries.resolveSafeGroundPoint(-5, 64, 3));
    expect(first.x).toBeGreaterThanOrEqual(20);
    expect(first.x).toBeLessThanOrEqual(125);
    const besideTrain = queries.resolveSafeGroundPoint(60, 60, 3)!;
    expect(besideTrain.x < 47 || besideTrain.x > 77 || besideTrain.y < 47 || besideTrain.y > 77).toBe(true);
  });
  it('bounds work and fails inert after teardown or on entirely invalid layout', () => {
    let active = true;
    const blocked = vi.fn(() => true);
    const queries = createWorldGeometryQueries({ metrics, index: { isCircleBlocked: blocked } as unknown as ArenaObstacleIndex, isActive: () => active });
    expect(queries.resolveSafeGroundPoint(64, 64, 3)).toBeNull();
    expect(blocked.mock.calls.length).toBeLessThan(513);
    active = false;
    blocked.mockClear();
    expect(queries.resolveSafeGroundPoint(64, 64, 3)).toBeNull();
    expect(blocked).not.toHaveBeenCalled();
  });
});
