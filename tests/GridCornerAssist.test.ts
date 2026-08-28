import { describe, expect, it } from 'vitest';
import { CELL_SIZE } from '../src/config';
import { RockGridIndex } from '../src/arena/RockGridIndex';
import {
  applyGridCornerAssist,
  type GridCornerAssistOutput,
} from '../src/systems/GridCornerAssist';
import {
  resolveActiveArenaWorldMetrics,
  type WorldMetrics,
} from '../src/world/WorldMetrics';

const TEST_WORLD_METRICS = resolveActiveArenaWorldMetrics();

function worldCenter(metrics: WorldMetrics, gridX: number, gridY: number): { x: number; y: number } {
  return {
    x: metrics.offsetX + (gridX + 0.5) * CELL_SIZE,
    y: metrics.offsetY + (gridY + 0.5) * CELL_SIZE,
  };
}

function apply(
  metrics: WorldMetrics,
  x: number,
  y: number,
  dx: number,
  dy: number,
  blocked: (gridX: number, gridY: number) => boolean,
): GridCornerAssistOutput {
  const output = { dx: 0, dy: 0 };
  applyGridCornerAssist(x, y, dx, dy, metrics, blocked, output);
  return output;
}

describe('GridCornerAssist', () => {
  it('keeps a perfectly centered 32-px corridor unchanged', () => {
    const player = worldCenter(TEST_WORLD_METRICS, 1, 0);
    const blocked = (gridX: number, gridY: number) => (
      gridY === 0 && (gridX === 0 || gridX === 2)
    );

    expect(apply(TEST_WORLD_METRICS, player.x, player.y, 0, 1, blocked)).toEqual({ dx: 0, dy: 1 });
  });

  it('treats pure tangential contact with a cell edge as free', () => {
    const player = worldCenter(TEST_WORLD_METRICS, 1, 0);
    const blocked = (gridX: number, gridY: number) => gridX === 2 && gridY === 0;

    expect(apply(TEST_WORLD_METRICS, player.x, player.y, 0, 1, blocked)).toEqual({ dx: 0, dy: 1 });
  });

  it('does not choose a side for a symmetric corner', () => {
    const player = worldCenter(TEST_WORLD_METRICS, 0, 0);
    const blocked = (gridX: number, gridY: number) => gridX === 1 && gridY === 1;

    expect(apply(TEST_WORLD_METRICS, player.x, player.y, 1, 1, blocked)).toEqual({ dx: 1, dy: 1 });
  });

  it('uses the only geometrically available side', () => {
    const player = worldCenter(TEST_WORLD_METRICS, 0, 0);
    const blocked = (gridX: number, gridY: number) => (
      (gridX === 1 && gridY === 1) || (gridX === 1 && gridY === 0)
    );
    const output = apply(TEST_WORLD_METRICS, player.x, player.y, 1, 1, blocked);

    expect(output.dx).toBeLessThan(output.dy);
    expect(output.dy).toBeGreaterThan(0);
  });

  it('keeps the original input when neither side fits within 8 px', () => {
    const player = worldCenter(TEST_WORLD_METRICS, 0, 0);

    expect(apply(TEST_WORLD_METRICS, player.x, player.y, 1, 0, () => true)).toEqual({ dx: 1, dy: 0 });
  });

  it('uses the WorldMetrics offsets instead of the global arena offsets', () => {
    const metrics: WorldMetrics = {
      ...TEST_WORLD_METRICS,
      offsetX: TEST_WORLD_METRICS.offsetX + CELL_SIZE * 4,
      offsetY: TEST_WORLD_METRICS.offsetY + CELL_SIZE * 3,
      maxX: TEST_WORLD_METRICS.maxX + CELL_SIZE * 4,
      maxY: TEST_WORLD_METRICS.maxY + CELL_SIZE * 3,
    };
    const player = worldCenter(metrics, 0, 0);
    const blocked = (gridX: number, gridY: number) => (
      (gridX === 1 && gridY === 1) || (gridX === 1 && gridY === 0)
    );

    const output = apply(metrics, player.x, player.y, 1, 1, blocked);

    expect(output.dx).toBeLessThan(output.dy);
    expect(output.dy).toBeGreaterThan(0);
  });

  it('treats only active rock or base cells as blockers', () => {
    const player = worldCenter(TEST_WORLD_METRICS, 0, 0);
    const rockGrid = new RockGridIndex([
      { gridX: 1, gridY: 1 },
      { gridX: 1, gridY: 0 },
    ], { cols: TEST_WORLD_METRICS.gridCols, rows: TEST_WORLD_METRICS.gridRows });
    const rockProxies: Array<{ active: boolean } | null> = [null, null];
    let baseActive = false;
    const blocked = (gridX: number, gridY: number) => {
      const rockId = rockGrid.getIndex(gridX, gridY);
      if (rockId >= 0 && rockProxies[rockId]?.active === true) return true;
      return baseActive && gridX === 1 && gridY === 1;
    };

    expect(apply(TEST_WORLD_METRICS, player.x, player.y, 1, 1, blocked)).toEqual({ dx: 1, dy: 1 });

    baseActive = true;
    rockProxies[1] = { active: true };
    const output = apply(TEST_WORLD_METRICS, player.x, player.y, 1, 1, blocked);
    expect(output.dx).toBeLessThan(output.dy);
  });

  it('does not create navigation for a completely blocked path', () => {
    const player = worldCenter(TEST_WORLD_METRICS, 0, 0);

    expect(apply(TEST_WORLD_METRICS, player.x, player.y, 1, 1, () => true)).toEqual({ dx: 1, dy: 1 });
  });
});
