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

import { CELL_SIZE, GRID_COLS, GRID_ROWS } from '../src/config';
import { PlayerManager } from '../src/entities/PlayerManager';
import type { ArenaLayout } from '../src/types';

describe('PlayerManager permanent ground fire spawns', () => {
  it('never selects a permanent fire cell as an initial or respawn position', () => {
    const fireCell = { gridX: 0, gridY: 0 };
    const safeCell = { gridX: 1, gridY: 0 };
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
      permanentGroundFireZones: [{
        id: 'test-fire',
        cells: [fireCell],
        burnDurationMs: 2000,
        burnDamagePerTick: 0.5,
        weaponName: 'Test',
        visualStyle: 'void',
        damageTarget: 'players',
      }],
    };
    const manager = new PlayerManager({} as never);
    manager.setLayout(layout);

    expect(manager.getSpawnPoint('player-1')).toEqual({
      x: safeCell.gridX * CELL_SIZE + CELL_SIZE / 2,
      y: safeCell.gridY * CELL_SIZE + CELL_SIZE / 2,
    });
  });
});
