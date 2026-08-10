import { describe, expect, it, vi } from 'vitest';

import { CoopDefensePersistentPressureSystem } from '../src/systems/CoopDefensePersistentPressureSystem';
import type { BaseSpec } from '../src/arena/BaseRegistry';

function source(
  id: string,
  source: { type: 'map' } | { type: 'base'; baseId: string },
  startAtMs = 0,
) {
  return {
    id,
    enemyKind: 'zombie-badger',
    intervalMs: 1_000,
    countPerTick: 2,
    startAtMs,
    source,
  } as const;
}

describe('CoopDefensePersistentPressureSystem', () => {
  it('runs map and structure sources in parallel and stops only the destroyed structure source', () => {
    const mapSpawn = vi.fn();
    const structureSpawn = vi.fn();
    const base = {
      id: 'spawn-point-a',
      role: 'spawn-point',
      spawnCenter: { gridX: 2, gridY: 5, x: 80, y: 176 },
    } as unknown as BaseSpec;
    const activeBaseIds = new Set([base.id]);
    const system = new CoopDefensePersistentPressureSystem(
      [
        source('map-pressure', { type: 'map' }),
        source('structure-pressure', { type: 'base', baseId: base.id }, 500),
      ],
      {
        hostSpawnPersistentMapGroup: mapSpawn,
        hostSpawnPersistentStructureGroup: structureSpawn,
      },
      [base],
      () => activeBaseIds,
    );

    system.hostUpdate(16, false);
    expect(mapSpawn).toHaveBeenCalledTimes(1);
    expect(structureSpawn).toHaveBeenCalledTimes(0);

    system.hostUpdate(1_000, false);
    expect(mapSpawn).toHaveBeenCalledTimes(2);
    expect(structureSpawn).toHaveBeenCalledTimes(1);

    activeBaseIds.clear();
    system.hostUpdate(2_000, false);
    expect(mapSpawn).toHaveBeenCalledTimes(4);
    expect(structureSpawn).toHaveBeenCalledTimes(1);
  });

  it('does not advance pressure during the arena countdown and honors a delayed start', () => {
    const mapSpawn = vi.fn();
    const system = new CoopDefensePersistentPressureSystem(
      [source('delayed-pressure', { type: 'map' }, 2_000)],
      {
        hostSpawnPersistentMapGroup: mapSpawn,
        hostSpawnPersistentStructureGroup: vi.fn(),
      },
    );

    system.hostUpdate(5_000, true);
    expect(mapSpawn).not.toHaveBeenCalled();
    system.hostUpdate(2_100, false);
    expect(mapSpawn).toHaveBeenCalledTimes(1);
  });
});
