import { describe, expect, it } from 'vitest';
import { MAX_SPAWN_ZONE_ALERTS, mergeSpawnZoneAlerts, spawnZoneAlertLevel } from '../src/systems/CoopDefenseSpawnZoneAlerts';
import { CoopDefensePersistentPressureSystem } from '../src/systems/CoopDefensePersistentPressureSystem';
import { CoopMissionVoidDanger, IDLE_SPAWN_PLACE_PRESENCE } from '../src/activity/CoopMissionVoidDanger';
import { CoopDefenseMapDirector } from '../src/systems/CoopDefenseMapDirector';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import type { ArenaLayout, SyncedSpawnPlaceState, SyncedSpawnZoneAlert } from '../src/types';

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
      getBase: () => undefined, getObjectives: () => null, getSpawnPlaces: () => null, getSpawnZoneAlerts: () => alerts, getMissionElapsedMs: () => now,
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

  it('knows which zones are in use, still to come or spent', () => {
    const area = { gridX: 1, gridY: 1, widthCells: 4, heightCells: 4 };
    const director = new CoopDefenseMapDirector([
      { id: 'first', start: { type: 'time', atMs: 0 }, restAfterMs: 0,
        groups: [{ enemyKind: 'zombie-badger', count: 1, delayMs: 500, spawnZoneId: 'nest-a', spawnArea: area }] },
      { id: 'second', start: { type: 'after-previous' }, restAfterMs: 0,
        groups: [{ enemyKind: 'zombie-badger', count: 1, delayMs: 0, spawnZoneId: 'nest-b', spawnArea: area }] },
    ], (_kind, count) => Array.from({ length: count }, (_, i) => `e${i}`), { isEnemyActive: () => alive });
    let alive = true;
    const use = () => { const active = new Set<string>(), upcoming = new Set<string>(); director.collectSpawnZoneUse(active, upcoming); return { active: [...active], upcoming: [...upcoming] }; };
    expect(use()).toEqual({ active: [], upcoming: ['nest-a', 'nest-b'] });
    director.hostUpdate(0, false);
    expect(use()).toEqual({ active: ['nest-a'], upcoming: ['nest-b'] });
    // Its group came out, but the wave is still being fought: the zone stays in use.
    director.hostUpdate(600, false);
    expect(use()).toEqual({ active: ['nest-a'], upcoming: ['nest-b'] });
    // The wave is defeated: nest-a is spent, the next encounter takes nest-b.
    alive = false;
    director.hostUpdate(16, false);
    director.hostUpdate(16, false);
    expect(use().active).not.toContain('nest-a');
    expect(use().upcoming).not.toContain('nest-a');

    const pressure = new CoopDefensePersistentPressureSystem([
      { id: 'nest', enemyKind: 'zombie-badger', intervalMs: 5000, countPerTick: 1, startAtMs: 1000, source: { type: 'zone', zoneId: 'nest-c' }, spawnArea: area },
    ] as never, { hostSpawnPersistentMapGroup: () => [], hostSpawnPersistentStructureGroup: () => {} });
    const sourceUse = () => { const active = new Set<string>(), upcoming = new Set<string>(); pressure.collectSpawnZoneUse(active, upcoming); return [...active, '|', ...upcoming]; };
    expect(sourceUse()).toEqual(['|', 'nest-c']);
    pressure.hostUpdate(1000, false);
    expect(sourceUse()).toEqual(['nest-c', '|']);
  });

  it('thins the haze of idle spawn places and lifts it from spent ones', () => {
    let places: SyncedSpawnPlaceState | null = null;
    const bases = new Map([
      ['hive', { destroyed: false, dormant: true, spec: {} }],
      ['site', { destroyed: false, dormant: true, spec: { dormantObjectiveId: 'salvage-site' } }],
    ]);
    const danger = new CoopMissionVoidDanger({
      getMapConfig: () => getCoopDefenseMapConfig('7'), getLayout: () => ({ seed: 1 }) as ArenaLayout, getOffset: () => ({ offsetX: 0, offsetY: 0 }),
      getBase: id => { const base = bases.get(id); return base && { isDestroyed: () => base.destroyed, isDormant: () => base.dormant, getSpec: () => base.spec }; },
      getObjectives: () => null, getSpawnPlaces: () => places, getSpawnZoneAlerts: () => [], getMissionElapsedMs: () => 0,
    });
    // Before the host has spoken every zone is still to come.
    expect(danger.presenceOf('zone:nest-a')).toBe(IDLE_SPAWN_PLACE_PRESENCE);
    places = { activeZones: ['nest-a'], upcomingZones: ['nest-b'], lapsedObjectives: [] };
    expect(danger.presenceOf('zone:nest-a')).toBe(1);
    expect(danger.presenceOf('zone:nest-b')).toBe(IDLE_SPAWN_PLACE_PRESENCE);
    expect(danger.presenceOf('zone:nest-c')).toBe(0);
    expect(danger.presenceOf('base:hive')).toBe(IDLE_SPAWN_PLACE_PRESENCE);
    bases.get('hive')!.dormant = false;
    expect(danger.presenceOf('base:hive')).toBe(1);
    expect(danger.presenceOf('base:site')).toBe(IDLE_SPAWN_PLACE_PRESENCE);
    // A site nobody entered before dusk will never release enemies.
    places = { ...places, lapsedObjectives: ['salvage-site'] };
    expect(danger.presenceOf('base:site')).toBe(0);
  });
});
