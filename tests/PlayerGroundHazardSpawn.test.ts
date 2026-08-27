import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
  },
  Utils: {
    Array: {
      Shuffle: <T>(values: T[]) => values,
    },
  },
}));

vi.mock('../src/network/bridge', () => ({
  bridge: { getCoopDefenseMapId: () => '15' },
}));

import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE, GRID_COLS, GRID_ROWS } from '../src/config';
import { PlayerManager } from '../src/entities/PlayerManager';
import type { ArenaLayout } from '../src/types';
import { resolveActiveArenaWorldMetrics } from '../src/world/WorldMetrics';

const TEST_WORLD_GEOMETRY = {
  metrics: resolveActiveArenaWorldMetrics(),
  bases: [],
  captureTheBeerBasesActive: false,
} as const;

describe('PlayerManager ground hazard spawns', () => {
  it('keeps one full grid cell between an initial or respawn position and a ground hazard', () => {
    const fireCell = { gridX: 0, gridY: 0 };
    const safeCell = { gridX: 2, gridY: 0 };
    const rocks: ArenaLayout['rocks'] = [];
    for (let gridY = 0; gridY < GRID_ROWS; gridY += 1) {
      for (let gridX = 0; gridX < GRID_COLS; gridX += 1) {
        if (
          (gridX === fireCell.gridX && gridY === fireCell.gridY)
          || (gridX === safeCell.gridX && gridY === safeCell.gridY)
        ) continue;
        rocks.push({ gridX, gridY });
      }
    }

    const layout: ArenaLayout = {
      seed: 15,
      rocks,
      trees: [],
      tracks: [],
      dirt: [],
      powerUpPedestals: [],
      groundHazardZones: [{
        eventId: 'test-hazard-event',
        id: 'test-fire',
        cells: [fireCell],
        burnDurationMs: 2000,
        burnDamagePerTick: 0.5,
        sourceId: 'test.ground-hazard',
        visualStyle: 'void',
        damageTarget: 'players',
      }],
    };
    const manager = new PlayerManager({} as never);
    manager.setWorldGeometry(TEST_WORLD_GEOMETRY);
    manager.setLayout(layout);
    const fireExclusion = (
      manager as unknown as { getGroundHazardSpawnExclusionCells(): Set<string> }
    ).getGroundHazardSpawnExclusionCells();
    expect(fireExclusion).toEqual(new Set(['0_0', '1_0', '0_1', '1_1']));
    expect(fireExclusion.has(`${safeCell.gridX}_${safeCell.gridY}`)).toBe(false);

    expect(manager.getSpawnPoint('player-1')).toEqual({
      x: safeCell.gridX * CELL_SIZE + CELL_SIZE / 2,
      y: safeCell.gridY * CELL_SIZE + CELL_SIZE / 2,
    });
    expect(manager.getWorldSpawnPoint('player-1')).toEqual({
      x: ARENA_OFFSET_X + safeCell.gridX * CELL_SIZE + CELL_SIZE / 2,
      y: ARENA_OFFSET_Y + safeCell.gridY * CELL_SIZE + CELL_SIZE / 2,
    });
  });

  it('falls back from a dangerous mission focus to a safe global spawn candidate', () => {
    const focusedCell = { gridX: 1, gridY: 1 };
    const safeCell = { gridX: 20, gridY: 1 };
    const rocks: ArenaLayout['rocks'] = [];
    for (let gridY = 0; gridY < GRID_ROWS; gridY += 1) {
      for (let gridX = 0; gridX < GRID_COLS; gridX += 1) {
        if ((gridX === focusedCell.gridX || gridX === safeCell.gridX) && gridY === 1) continue;
        rocks.push({ gridX, gridY });
      }
    }
    const manager = new PlayerManager({} as never);
    manager.setWorldGeometry(TEST_WORLD_GEOMETRY);
    manager.setLayout({
      seed: 16,
      rocks,
      trees: [],
      tracks: [],
      dirt: [],
      powerUpPedestals: [],
    });
    const focusX = ARENA_OFFSET_X + (focusedCell.gridX + 0.5) * CELL_SIZE;
    const focusY = ARENA_OFFSET_Y + (focusedCell.gridY + 0.5) * CELL_SIZE;
    manager.setSpawnContextProvider(() => ({
      fires: [],
      stinkClouds: [],
      teslaDomes: [],
      nukes: [],
      meteors: [],
      turrets: [],
      projectiles: [],
      enemyThreats: [{ x: focusX, y: focusY, attackRange: 1 }],
      preferredSpawnFocus: { x: focusX, y: focusY },
    }));

    expect(manager.getSpawnPoint('player-1')).toEqual({
      x: safeCell.gridX * CELL_SIZE + CELL_SIZE / 2,
      y: safeCell.gridY * CELL_SIZE + CELL_SIZE / 2,
    });
  });
});
