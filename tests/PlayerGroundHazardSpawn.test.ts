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
import type { BaseSpec } from '../src/arena/BaseRegistry';
import type { ArenaLayout } from '../src/types';
import { resolveActiveArenaWorldMetrics } from '../src/world/WorldMetrics';

const TEST_WORLD_GEOMETRY = {
  metrics: resolveActiveArenaWorldMetrics(),
  bases: [],
  captureTheBeerBasesActive: false,
} as const;

function createSpawnManager(freeCells: readonly { gridX: number; gridY: number }[]): PlayerManager {
  const free = new Set(freeCells.map(({ gridX, gridY }) => `${gridX}_${gridY}`));
  const rocks: ArenaLayout['rocks'] = [];
  for (let gridY = 0; gridY < GRID_ROWS; gridY += 1) {
    for (let gridX = 0; gridX < GRID_COLS; gridX += 1) {
      if (!free.has(`${gridX}_${gridY}`)) rocks.push({ gridX, gridY });
    }
  }
  const base: BaseSpec = {
    id: 'home',
    cells: [{ gridX: 10, gridY: 10 }],
    region: { minGridX: 10, maxGridX: 10, minGridY: 10, maxGridY: 10 },
    hpMax: 100,
    faction: 'friendly',
    role: 'main',
    turrets: [],
    powerUpPedestals: [],
  };
  const manager = new PlayerManager({} as never);
  manager.setWorldGeometry({ ...TEST_WORLD_GEOMETRY, bases: [base] });
  manager.setLayout({ seed: 10, rocks, trees: [], tracks: [], dirt: [], powerUpPedestals: [] });
  return manager;
}

function center(gridX: number, gridY: number): { x: number; y: number } {
  return {
    x: ARENA_OFFSET_X + (gridX + 0.5) * CELL_SIZE,
    y: ARENA_OFFSET_Y + (gridY + 0.5) * CELL_SIZE,
  };
}

describe('PlayerManager ground hazard spawns', () => {
  it('keeps respawns near a threatened base while preferring open ground, then ordinary enemies over the boss', () => {
    const bossCell = { gridX: 14, gridY: 10 };
    const ordinaryCell = { gridX: 20, gridY: 10 };
    const openCell = { gridX: 24, gridY: 10 };
    const manager = createSpawnManager([bossCell, ordinaryCell, openCell]);
    const boss = center(10, 10);
    let includeOpenCell = true;
    manager.setSpawnContextProvider(() => ({
      fires: [], stinkClouds: [], teslaDomes: [], nukes: [], meteors: [], turrets: [], projectiles: [],
      enemyThreats: [
        { ...boss, attackRange: 600, isBoss: true, collisionRadius: 34 },
        { ...center(ordinaryCell.gridX, ordinaryCell.gridY), attackRange: 1 },
        ...(includeOpenCell ? [] : [{ ...center(openCell.gridX, openCell.gridY), attackRange: 1 }]),
      ],
      livingCoopBaseIds: new Set(['home']),
    }));

    expect(manager.getSpawnPoint('player-1')).toEqual({
      x: (openCell.gridX + 0.5) * CELL_SIZE,
      y: (openCell.gridY + 0.5) * CELL_SIZE,
    });
    includeOpenCell = false;
    expect(manager.getSpawnPoint('player-1')).toEqual({
      x: (ordinaryCell.gridX + 0.5) * CELL_SIZE,
      y: (ordinaryCell.gridY + 0.5) * CELL_SIZE,
    });
  });

  it('chooses a base-near ordinary enemy over an active ground-fire cell', () => {
    const fireCell = { gridX: 20, gridY: 10 };
    const ordinaryCell = { gridX: 24, gridY: 10 };
    const manager = createSpawnManager([fireCell, ordinaryCell]);
    const fire = center(fireCell.gridX, fireCell.gridY);
    const groundFireGridX = Math.floor(fire.x / (CELL_SIZE / 2));
    const groundFireGridY = Math.floor(fire.y / (CELL_SIZE / 2));
    manager.setSpawnContextProvider(() => ({
      fires: [], stinkClouds: [], teslaDomes: [], nukes: [], meteors: [], turrets: [], projectiles: [],
      burningGroundCells: [{
        x: (groundFireGridX + 0.5) * CELL_SIZE / 2,
        y: (groundFireGridY + 0.5) * CELL_SIZE / 2,
        radius: CELL_SIZE * Math.SQRT2 / 4,
      }],
      enemyThreats: [
        { ...center(10, 10), attackRange: 600, isBoss: true, collisionRadius: 34 },
        { ...center(ordinaryCell.gridX, ordinaryCell.gridY), attackRange: 1 },
      ],
      livingCoopBaseIds: new Set(['home']),
    }));

    expect(manager.getSpawnPoint('player-1')).toEqual({
      x: (ordinaryCell.gridX + 0.5) * CELL_SIZE,
      y: (ordinaryCell.gridY + 0.5) * CELL_SIZE,
    });
  });
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
