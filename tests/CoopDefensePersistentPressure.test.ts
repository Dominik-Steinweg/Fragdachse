import { describe, expect, it, vi } from 'vitest';

import { CoopDefensePersistentPressureSystem } from '../src/systems/CoopDefensePersistentPressureSystem';
import type { BaseSpec } from '../src/arena/BaseRegistry';
import type { SpawnFront } from '../src/types';

function source(
  id: string,
  source: { type: 'map' } | { type: 'base'; baseId: string },
  startAtMs = 0,
  front?: SpawnFront,
) {
  return {
    id,
    enemyKind: 'zombie-badger',
    intervalMs: 1_000,
    countPerTick: 2,
    startAtMs,
    source,
    ...(front ? { front } : {}),
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
    const activeBaseIds = new Set<string>();
    const system = new CoopDefensePersistentPressureSystem(
      [
        source('map-pressure', { type: 'map' }, 0, 'north'),
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
    expect(mapSpawn).toHaveBeenNthCalledWith(1, 'zombie-badger', 2, 'north');
    expect(structureSpawn).toHaveBeenCalledTimes(0);

    activeBaseIds.add(base.id);
    system.hostUpdate(1_000, false);
    expect(mapSpawn).toHaveBeenCalledTimes(2);
    expect(mapSpawn).toHaveBeenNthCalledWith(2, 'zombie-badger', 2, 'north');
    // A spawn structure announces even its first release (GDD Spawnbauwerk V1).
    expect(structureSpawn).toHaveBeenCalledTimes(0);
    system.hostUpdate(2_000, false);
    expect(structureSpawn).toHaveBeenCalledTimes(1);

    activeBaseIds.clear();
    system.hostUpdate(2_000, false);
    expect(mapSpawn).toHaveBeenCalledTimes(6);
    expect(structureSpawn).toHaveBeenCalledTimes(1);
  });

  it('announces every structure release one lead ahead, the first one included', () => {
    const structureSpawn = vi.fn();
    const base = { id: 'spawn-point-a', role: 'spawn-point' } as unknown as BaseSpec;
    const active = new Set<string>();
    const system = new CoopDefensePersistentPressureSystem(
      [{ ...source('structure-pressure', { type: 'base', baseId: base.id }), intervalMs: 5_000 }],
      { hostSpawnPersistentMapGroup: vi.fn(), hostSpawnPersistentStructureGroup: structureSpawn },
      [base],
      () => active,
    );
    system.hostUpdate(1_000, false);
    expect(system.getSpawnZoneAlerts()).toEqual([]);

    active.add(base.id);
    system.hostUpdate(500, false);
    expect(system.getSpawnZoneAlerts()).toEqual([{ zoneId: base.id, structure: true, fromMs: 1_500, atMs: 3_500, endMs: 3_500 }]);
    system.hostUpdate(1_999, false);
    expect(structureSpawn).not.toHaveBeenCalled();
    system.hostUpdate(1, false);
    expect(structureSpawn).toHaveBeenCalledTimes(1);
    expect(system.getSpawnZoneAlerts()).toEqual([{ zoneId: base.id, structure: true, fromMs: 6_500, atMs: 8_500, endMs: 8_500 }]);
    system.hostUpdate(5_000, false);
    expect(structureSpawn).toHaveBeenCalledTimes(2);
  });

  it('spawns zone sources inside their zone and tags them with it', () => {
    const mapSpawn = vi.fn();
    const area = { gridX: 1, gridY: 1, widthCells: 2, heightCells: 2, shape: 'round' as const };
    const system = new CoopDefensePersistentPressureSystem(
      [{ ...source('zone-pressure', { type: 'map' }), source: { type: 'zone', zoneId: 'north-gate' }, spawnArea: area } as never],
      { hostSpawnPersistentMapGroup: mapSpawn, hostSpawnPersistentStructureGroup: vi.fn() },
    );
    system.hostUpdate(16, false);
    expect(mapSpawn).toHaveBeenCalledWith('zombie-badger', 2, undefined, area, 'north-gate');
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
