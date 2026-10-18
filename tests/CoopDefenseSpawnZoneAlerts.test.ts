import { describe, expect, it } from 'vitest';
import { MAX_SPAWN_ZONE_ALERTS, mergeSpawnZoneAlerts, spawnZoneAlertLevel } from '../src/systems/CoopDefenseSpawnZoneAlerts';
import { CoopDefensePersistentPressureSystem } from '../src/systems/CoopDefensePersistentPressureSystem';
import { CoopMissionVoidDanger } from '../src/activity/CoopMissionVoidDanger';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import type { ArenaLayout, SyncedSpawnZoneAlert } from '../src/types';

describe('spawn zone alerts (GDD Void-Gefahrenzonen V1)', () => {
  it('merges announcements per zone: earliest warning, latest or open end, most urgent first', () => {
    const merged = mergeSpawnZoneAlerts([
      { zoneId: 'b', fromMs: 3000, atMs: 5000, endMs: 5000 },
      { zoneId: 'a', fromMs: 1000, atMs: 3000, endMs: 3500 },
      { zoneId: 'a', fromMs: 2000, atMs: 4000, endMs: null },
    ]);
    expect(merged).toEqual([{ zoneId: 'a', fromMs: 1000, atMs: 3000, endMs: null }, { zoneId: 'b', fromMs: 3000, atMs: 5000, endMs: 5000 }]);
    const many = Array.from({ length: 30 }, (_, i) => ({ zoneId: `z-${i}`, fromMs: 0, atMs: 1000 - i, endMs: null }));
    expect(mergeSpawnZoneAlerts(many)).toHaveLength(MAX_SPAWN_ZONE_ALERTS);
    expect(mergeSpawnZoneAlerts(many)[0]!.zoneId).toBe('z-29');
  });

  it('rises over the lead time, holds while enemies come out and settles afterwards', () => {
    const alert = { zoneId: 'nest', fromMs: 1000, atMs: 3000, endMs: 5000 };
    expect(spawnZoneAlertLevel(alert, 900)).toBe(0);
    expect(spawnZoneAlertLevel(alert, 2000)).toBeCloseTo(.5);
    expect(spawnZoneAlertLevel(alert, 4000)).toBe(1);
    expect(spawnZoneAlertLevel(alert, 6000)).toBeGreaterThan(0);
    expect(spawnZoneAlertLevel(alert, 6000)).toBeLessThan(1);
    expect(spawnZoneAlertLevel(alert, 8000)).toBe(0);
    expect(spawnZoneAlertLevel({ ...alert, endMs: null }, 99_000)).toBe(1);
  });

  it('announces every tick of an active zone source ahead of time', () => {
    const area = { gridX: 0, gridY: 0, widthCells: 2, heightCells: 2 };
    const system = new CoopDefensePersistentPressureSystem([
      { id: 'nest', enemyKind: 'zombie-badger', intervalMs: 5000, countPerTick: 1, startAtMs: 1000, source: { type: 'zone', zoneId: 'nest' }, spawnArea: area },
      { id: 'edge', enemyKind: 'zombie-badger', intervalMs: 5000, countPerTick: 1, startAtMs: 0, source: { type: 'map' } },
    ] as never, { hostSpawnPersistentMapGroup: () => [], hostSpawnPersistentStructureGroup: () => {} });
    expect(system.getSpawnZoneAlerts()).toEqual([{ zoneId: 'nest', fromMs: -1000, atMs: 1000, endMs: 1000 }]);
    system.hostUpdate(2000, false);
    expect(system.getSpawnZoneAlerts()).toEqual([{ zoneId: 'nest', fromMs: 4000, atMs: 6000, endMs: 6000 }]);
  });

  it('turns announcements into zone rectangles on clients and lets a replaced warning settle', () => {
    let now = 0, alerts: SyncedSpawnZoneAlert[] = [];
    const map = getCoopDefenseMapConfig('7');
    const zone = map.spawnZones![0]!;
    const danger = new CoopMissionVoidDanger({
      getMapConfig: () => map, getLayout: () => ({ seed: 1 }) as ArenaLayout, getOffset: () => ({ offsetX: 0, offsetY: 0 }),
      getBase: () => undefined, getObjectives: () => null, getSpawnZoneAlerts: () => alerts, getMissionElapsedMs: () => now,
    });
    alerts = [{ zoneId: zone.id, fromMs: 0, atMs: 2000, endMs: null }];
    now = 2000;
    expect(danger.alerts).toEqual([{ x: zone.gridX * 32, y: zone.gridY * 32, width: zone.widthCells * 32, height: zone.heightCells * 32, level: 1 }]);
    // The host moves on to the next tick: the shown haze settles instead of vanishing.
    alerts = [{ zoneId: zone.id, fromMs: 9000, atMs: 11_000, endMs: 11_000 }];
    now = 3000;
    expect(danger.alerts[0]!.level).toBeCloseTo(.6);
    now = 6000;
    expect(danger.alerts).toEqual([]);
  });
});
