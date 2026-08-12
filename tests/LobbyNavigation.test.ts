import { beforeEach, describe, expect, it, vi } from 'vitest';

// Die Lobby-Hindernisse brauchen von Phaser nur Geometrie-Container; der Renderer bleibt außen vor.
vi.mock('phaser', () => {
  class Rectangle {
    x = 0; y = 0; width = 0; height = 0;
    setTo(x: number, y: number, width: number, height: number) {
      this.x = x; this.y = y; this.width = width; this.height = height;
      return this;
    }
  }
  return {
    Geom: {
      Rectangle,
      Circle: class { setTo() { return this; } },
      Line: class { setTo() { return this; } },
    },
    Math: { Distance: { Between: () => 0 } },
  };
});

import { CELL_SIZE } from '../src/config';
import type { ArenaLayout, RockCell } from '../src/types';
import { LobbyObstacleWorld } from '../src/lobby/LobbyObstacleWorld';
import { LobbyNavigation } from '../src/lobby/LobbyNavigation';

const GRID_COLS = 20;
const GRID_ROWS = 10;
const WORLD_FRAME = { offsetX: 0, offsetY: 0, width: GRID_COLS * CELL_SIZE, height: GRID_ROWS * CELL_SIZE };

function layoutWith(rocks: RockCell[]): ArenaLayout {
  return { seed: 1, rocks, trees: [], tracks: [], dirt: [], decals: [], powerUpPedestals: [] } as unknown as ArenaLayout;
}

function centreOf(gridX: number, gridY: number): { x: number; y: number } {
  return { x: gridX * CELL_SIZE + CELL_SIZE / 2, y: gridY * CELL_SIZE + CELL_SIZE / 2 };
}

/** Senkrechte Wand über die volle Höhe, optional mit einer Lücke. */
function verticalWall(gridX: number, gapGridY?: number): RockCell[] {
  const cells: RockCell[] = [];
  for (let gridY = 0; gridY < GRID_ROWS; gridY += 1) {
    if (gridY === gapGridY) continue;
    cells.push({ gridX, gridY });
  }
  return cells;
}

describe('lobby navigation', () => {
  let world: LobbyObstacleWorld;
  let nav: LobbyNavigation;

  function build(rocks: RockCell[]): void {
    world = new LobbyObstacleWorld(layoutWith(rocks), WORLD_FRAME);
    nav = new LobbyNavigation(world);
  }

  beforeEach(() => {
    build(verticalWall(5));
  });

  it('cannot cross a closed wall', () => {
    const from = centreOf(1, 5);
    const to = centreOf(9, 5);
    expect(nav.findPath(from.x, from.y, to.x, to.y)).toBeNull();
  });

  it('uses a passage that a destroyed rock opens, without rebuilding anything else', () => {
    const from = centreOf(1, 5);
    const to = centreOf(9, 5);
    expect(nav.findPath(from.x, from.y, to.x, to.y)).toBeNull();

    const gapRockId = world.getRockIdAt(5, 5);
    expect(gapRockId).toBeGreaterThanOrEqual(0);
    expect(world.setRockAlive(gapRockId, false)).toBe(true);

    const path = nav.findPath(from.x, from.y, to.x, to.y);
    expect(path).not.toBeNull();
    expect(path!.at(-1)).toEqual(centreOf(9, 5));
    // Der Weg muss durch die geöffnete Zelle laufen – es gibt keinen anderen Durchlass.
    expect(path!.some((point) => point.x === centreOf(5, 5).x && point.y === centreOf(5, 5).y)).toBe(true);
  });

  it('counts every topology change so running paths know they are stale', () => {
    const before = world.getTopologyVersion();
    const rockId = world.getRockIdAt(5, 2);
    world.setRockAlive(rockId, false);
    world.setRockAlive(rockId, true);
    expect(world.getTopologyVersion()).toBe(before + 2);
    // Ein unveränderter Zustand zählt nicht mit.
    expect(world.setRockAlive(rockId, true)).toBe(false);
    expect(world.getTopologyVersion()).toBe(before + 2);
  });

  it('never cuts the corner between two diagonally touching rocks', () => {
    build([{ gridX: 1, gridY: 0 }, { gridX: 0, gridY: 1 }]);

    // (1,1) ist nur diagonal von (0,0) erreichbar, und dieser Schritt schneidet die Ecke.
    const from = centreOf(0, 0);
    const to = centreOf(1, 1);
    expect(nav.findPath(from.x, from.y, to.x, to.y)).toBeNull();
  });

  it('refuses a rebuild that would wall an actor into a dead pocket', () => {
    // Eine 1x1-Tasche bei (1,1), deren einziger Ausgang die Zelle (2,1) ist.
    build([
      { gridX: 0, gridY: 0 }, { gridX: 1, gridY: 0 }, { gridX: 2, gridY: 0 },
      { gridX: 0, gridY: 1 },
      { gridX: 0, gridY: 2 }, { gridX: 1, gridY: 2 }, { gridX: 2, gridY: 2 },
    ]);

    const actor = [centreOf(1, 1)];
    expect(nav.isRebuildSafe(2, 1, actor)).toBe(false);
    // Weit weg im offenen Feld ist derselbe Neubau unbedenklich.
    expect(nav.isRebuildSafe(15, 7, actor)).toBe(true);
    // In den Actor hineinbauen ist ebenfalls verboten.
    expect(nav.isRebuildSafe(1, 1, actor)).toBe(false);
  });
});
