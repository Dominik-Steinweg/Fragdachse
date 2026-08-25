import { describe, expect, it } from 'vitest';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE } from '../src/config';
import { RockGridIndex } from '../src/arena/RockGridIndex';
import {
  applyGridCornerAssist,
  type GridCornerAssistOutput,
} from '../src/systems/GridCornerAssist';

function worldCenter(gridX: number, gridY: number): { x: number; y: number } {
  return {
    x: ARENA_OFFSET_X + (gridX + 0.5) * CELL_SIZE,
    y: ARENA_OFFSET_Y + (gridY + 0.5) * CELL_SIZE,
  };
}

function apply(
  x: number,
  y: number,
  dx: number,
  dy: number,
  blocked: (gridX: number, gridY: number) => boolean,
): GridCornerAssistOutput {
  const output = { dx: 0, dy: 0 };
  applyGridCornerAssist(x, y, dx, dy, blocked, output);
  return output;
}

describe('GridCornerAssist', () => {
  it('keeps a perfectly centered 32-px corridor unchanged', () => {
    const player = worldCenter(1, 0);
    const blocked = (gridX: number, gridY: number) => (
      gridY === 0 && (gridX === 0 || gridX === 2)
    );

    expect(apply(player.x, player.y, 0, 1, blocked)).toEqual({ dx: 0, dy: 1 });
  });

  it('treats pure tangential contact with a cell edge as free', () => {
    const player = worldCenter(1, 0);
    const blocked = (gridX: number, gridY: number) => gridX === 2 && gridY === 0;

    expect(apply(player.x, player.y, 0, 1, blocked)).toEqual({ dx: 0, dy: 1 });
  });

  it('does not choose a side for a symmetric corner', () => {
    const player = worldCenter(0, 0);
    const blocked = (gridX: number, gridY: number) => gridX === 1 && gridY === 1;

    expect(apply(player.x, player.y, 1, 1, blocked)).toEqual({ dx: 1, dy: 1 });
  });

  it('uses the only geometrically available side', () => {
    const player = worldCenter(0, 0);
    const blocked = (gridX: number, gridY: number) => (
      (gridX === 1 && gridY === 1) || (gridX === 1 && gridY === 0)
    );
    const output = apply(player.x, player.y, 1, 1, blocked);

    expect(output.dx).toBeLessThan(output.dy);
    expect(output.dy).toBeGreaterThan(0);
  });

  it('keeps the original input when neither side fits within 8 px', () => {
    const player = worldCenter(0, 0);

    expect(apply(player.x, player.y, 1, 0, () => true)).toEqual({ dx: 1, dy: 0 });
  });

  it('requires an active rock proxy, so a pedestal grid entry stays walkable', () => {
    const player = worldCenter(0, 0);
    const rockGrid = new RockGridIndex([
      { gridX: 1, gridY: 1 },
      { gridX: 1, gridY: 0 },
    ]);
    const proxies: Array<{ active: boolean } | null> = [null, null];
    const isBlocked = (gridX: number, gridY: number) => {
      const rockId = rockGrid.getIndex(gridX, gridY);
      return rockId >= 0 && proxies[rockId]?.active === true;
    };

    expect(apply(player.x, player.y, 1, 1, isBlocked)).toEqual({ dx: 1, dy: 1 });

    proxies[0] = { active: true };
    proxies[1] = { active: true };
    const output = apply(player.x, player.y, 1, 1, isBlocked);
    expect(output.dx).toBeLessThan(output.dy);
  });

  it('responds to a closed raster barrier and stops responding when it opens', () => {
    const player = worldCenter(0, 0);
    let closed = true;
    const blocked = (gridX: number, gridY: number) => (
      closed && ((gridX === 1 && gridY === 1) || (gridX === 1 && gridY === 0))
    );

    const corrected = apply(player.x, player.y, 1, 1, blocked);
    expect(corrected.dx).toBeLessThan(corrected.dy);

    closed = false;
    expect(apply(player.x, player.y, 1, 1, blocked)).toEqual({ dx: 1, dy: 1 });
  });
});
