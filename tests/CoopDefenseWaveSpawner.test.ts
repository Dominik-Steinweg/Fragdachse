import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ Math: {} }));

import type { BaseSpec } from '../src/arena/BaseRegistry';
import { CoopDefenseWaveSpawner } from '../src/systems/CoopDefenseWaveSpawner';

describe('CoopDefenseWaveSpawner spawn-point sources', () => {
  it('spawns the configured source wave at the free center and stops after destruction', () => {
    const spawn = vi.fn();
    const source = {
      id: 'spawn-point-zombie-badger',
      role: 'spawn-point',
      spawnCenter: { gridX: 2, gridY: 5, x: 80, y: 176 },
      spawnWave: {
        enemyKind: 'zombie-badger',
        intervalMs: 1_000,
        countPerWave: 2,
        startAtMs: 0,
      },
    } as unknown as BaseSpec;
    const activeBaseIds = new Set([source.id]);
    const enemyManager = {
      hostSpawnAtWorld: spawn,
      getAllEnemies: () => [],
      hasEnemyKind: () => false,
    } as never;

    const spawner = new CoopDefenseWaveSpawner(
      enemyManager,
      {} as never,
      [],
      [source],
      () => activeBaseIds,
    );

    spawner.hostUpdate(16, false);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls).toEqual([
      [80, 176, 'zombie-badger', { spawnBurrowed: true }],
      [80, 176, 'zombie-badger', { spawnBurrowed: true }],
    ]);

    activeBaseIds.clear();
    spawner.hostUpdate(2_000, false);
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
