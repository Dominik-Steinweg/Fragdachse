import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_MAP_CONFIGS, getCoopDefenseMapConfig, normalizeCoopDefenseMapConfig,
  resolveCoopDefenseMapBossSpawnArea, resolveCoopDefenseMapEncounterConfigs, resolveCoopDefenseMapPersistentSpawnConfigs,
  type CoopDefenseMapConfig,
} from '../src/config/coopDefenseMaps';
import { toWorldDefinition } from '../src/config/authoring/coopDefenseAuthoringAdapter';
import { isCellInSpawnArea, spawnZoneArea } from '../src/config/spawnZones';

/** A campaign map with zones, freshly cloned so each case can break one rule. */
const map7 = (): CoopDefenseMapConfig => structuredClone(getCoopDefenseMapConfig('7')) as CoopDefenseMapConfig;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

describe('World spawn zones', () => {
  it('are the only authored spawn places of campaign groups and are all used', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS) {
      const zoneIds = new Set((map.spawnZones ?? []).map(({ id }) => id));
      for (const encounter of map.encounters ?? []) for (const group of encounter.groups) {
        // An authored place is always a zone; a zone group never claims a front of its own.
        if (group.spawnArea) expect(group.spawnZoneId, `${map.mapId}:${encounter.id}`).toBeDefined();
        if (group.spawnZoneId) {
          expect(zoneIds.has(group.spawnZoneId)).toBe(true);
          expect(group.front, `${map.mapId}:${encounter.id}`).toBeUndefined();
        }
      }
    }
  });

  it('lets every campaign map spawn from zones only: no front groups, edge sources or front bosses (E1)', () => {
    for (const mapId of Array.from({ length: 20 }, (_, i) => String(i + 1))) {
      const map = getCoopDefenseMapConfig(mapId);
      for (const encounter of map.encounters ?? []) for (const group of encounter.groups) {
        expect(group.spawnZoneId, `${mapId}:${encounter.id}`).toBeDefined();
      }
      for (const spawn of map.persistentSpawns ?? []) expect(spawn.source.type, `${mapId}:${spawn.id}`).not.toBe('map');
      if (map.boss && !map.boss.habitatId) expect(map.boss.spawnZoneId, mapId).toBeDefined();
    }
  });

  it('normalizes idempotently and lands unchanged in the WorldDefinition', () => {
    // Persistent-base maps re-derive their base, so the spawn data is compared field by field.
    for (const map of COOP_DEFENSE_MAP_CONFIGS.filter(({ spawnZones, persistentBase }) => spawnZones && !persistentBase)) {
      const again = normalizeCoopDefenseMapConfig(map);
      expect(again.spawnZones).toEqual(map.spawnZones);
      expect(again.encounters).toEqual(map.encounters);
      expect(toWorldDefinition(map).spawnZones).toEqual(map.spawnZones);
    }
  });

  it('resolves zone groups, zone sources and the boss zone into the zone area', () => {
    const map = map7() as Mutable<CoopDefenseMapConfig>;
    const zone = map.spawnZones![0]!;
    const area = { gridX: zone.gridX, gridY: zone.gridY, widthCells: zone.widthCells, heightCells: zone.heightCells, shape: 'round' };
    const group = resolveCoopDefenseMapEncounterConfigs(map, 1).flatMap(({ groups }) => groups)
      .find(({ spawnZoneId }) => spawnZoneId === zone.id)!;
    expect(group.spawnArea).toEqual(area);
    map.persistentSpawns = [{ id: 'nest', enemyKind: 'zombie-badger', intervalMs: 5000, countPerTick: 1, source: { type: 'zone', zoneId: zone.id } }];
    const normalized = normalizeCoopDefenseMapConfig(map);
    expect(resolveCoopDefenseMapPersistentSpawnConfigs(normalized, 1)[0]!.spawnArea).toEqual(area);
    expect(resolveCoopDefenseMapBossSpawnArea(normalized)).toBeNull();
  });

  it('is round: the organic ellipse in its box, not the box', () => {
    const area = spawnZoneArea({ id: 'nest', gridX: 10, gridY: 20, widthCells: 12, heightCells: 8 });
    const inside = (x: number, y: number) => isCellInSpawnArea(area, x, y);
    expect(inside(15, 23) && inside(16, 24)).toBe(true);
    for (const [x, y] of [[10, 20], [21, 20], [10, 27], [21, 27]]) expect(inside(x, y)).toBe(false);
    expect(inside(9, 24) || inside(22, 24) || inside(16, 19) || inside(16, 28)).toBe(false);
    // Most of the ellipse counts; its rim wobbles inward, never past the box.
    let count = 0;
    for (let x = 10; x < 22; x++) for (let y = 20; y < 28; y++) if (inside(x, y)) count++;
    expect(count / (12 * 8)).toBeGreaterThan(.55);
    expect(count / (12 * 8)).toBeLessThan(.8);
    // A box without the round shape (authored inline areas) stays a box.
    expect(isCellInSpawnArea({ gridX: 10, gridY: 20, widthCells: 12, heightCells: 8 }, 10, 20)).toBe(true);
  });

  it('rejects broken zones and references', () => {
    const broken: [string, (map: Mutable<CoopDefenseMapConfig>) => void][] = [
      ['duplicate spawn zone', (map) => { map.spawnZones = [...map.spawnZones!, map.spawnZones![0]!]; }],
      ['outside the arena', (map) => { map.spawnZones = [{ ...map.spawnZones![0]!, gridX: 9999 }, ...map.spawnZones!.slice(1)]; }],
      ['kebab-case', (map) => { map.spawnZones = [{ ...map.spawnZones![0]!, id: 'Nest One' }, ...map.spawnZones!.slice(1)]; }],
      ['never used', (map) => { map.spawnZones = [...map.spawnZones!, { id: 'spare', gridX: 1, gridY: 1, widthCells: 2, heightCells: 2 }]; }],
      ['unknown spawn zone', (map) => { (map.encounters![0]!.groups[0] as { spawnZoneId?: string }).spawnZoneId = 'nowhere'; }],
      ['front and spawnZoneId', (map) => { (map.encounters![0]!.groups[0] as { front?: string }).front = 'east'; }],
      ['unknown spawn zone', (map) => {
        map.persistentSpawns = [{ id: 'x', enemyKind: 'zombie-badger', intervalMs: 1000, countPerTick: 1, source: { type: 'zone', zoneId: 'nowhere' } }];
      }],
      ['cannot declare a front', (map) => {
        map.persistentSpawns = [{ id: 'x', enemyKind: 'zombie-badger', intervalMs: 1000, countPerTick: 1,
          source: { type: 'zone', zoneId: map.spawnZones![0]!.id }, front: 'east' }];
      }],
    ];
    for (const [message, breakIt] of broken) {
      const map = map7() as Mutable<CoopDefenseMapConfig>;
      breakIt(map);
      expect(() => normalizeCoopDefenseMapConfig(map), message).toThrow(new RegExp(message, 'i'));
    }
  });
});
