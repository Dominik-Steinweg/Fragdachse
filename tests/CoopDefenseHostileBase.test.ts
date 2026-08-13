import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_MAP_CONFIGS,
  getCoopDefenseMapConfig,
} from '../src/config/coopDefenseMaps';
import { resolveCoopDefenseBases } from '../src/arena/BaseRegistry';
import { applyArenaMetricsForMode } from '../src/config';
import { getCoopDefenseMapUnlockedByVictoryOn } from '../src/config/coopDefenseMapUnlocks';
import { COOP_DEFENSE_MODE } from '../src/gameModes';

const ATTACK_MAP_IDS = ['12', '13', '17'] as const;

describe('coop-defense hostile bases', () => {
  it('uses maps 12, 13 and 17 as attack maps and ends on map 17', () => {
    expect(COOP_DEFENSE_MAP_CONFIGS.map((map) => map.mapId)).toContain('17');
    expect(COOP_DEFENSE_MAP_CONFIGS.at(-1)?.mapId).toBe('17');
    expect(getCoopDefenseMapUnlockedByVictoryOn('17')).toBeNull();
    expect(COOP_DEFENSE_MAP_CONFIGS
      .filter((map) => map.objective === 'destroy-hostile-bases')
      .map((map) => map.mapId)).toEqual(ATTACK_MAP_IDS);
  });

  it('keeps both attack maps winnable through the hostile base and losable through friendly bases', () => {
    for (const mapId of ATTACK_MAP_IDS) {
      const map = getCoopDefenseMapConfig(mapId);
      expect(map.bases.some((base) => base.faction === 'hostile')).toBe(true);
      expect(map.bases.some((base) => base.faction === 'friendly')).toBe(true);
    }
  });

  it('introduces a small turretless hostile hive on map 12', () => {
    const hostile = getCoopDefenseMapConfig('12').bases.find((base) => base.faction === 'hostile');
    expect(hostile?.hpMax).toBeGreaterThan(0);
    expect(hostile?.shape.kind).toBe('cells');
    expect(hostile?.shape.kind === 'cells' ? hostile.shape.cells.length : 0).toBeGreaterThan(0);
    expect(hostile?.turrets ?? []).toHaveLength(0);
    expect(hostile?.powerUpPedestals ?? []).toHaveLength(0);
  });

  it('keeps the original hostile footprint and spore-turret role on map 13', () => {
    const hostile = getCoopDefenseMapConfig('13').bases.find((base) => base.faction === 'hostile');
    expect(hostile?.hpMax).toBeGreaterThan(0);
    expect(hostile?.shape.kind).toBe('cells');
    expect(hostile?.shape.kind === 'cells' ? hostile.shape.cells.length : 0).toBeGreaterThan(0);
    expect(hostile?.turrets?.length).toBeGreaterThan(0);
    expect(hostile?.turrets?.every((turret) => turret.weaponId === 'BASE_SPOREN')).toBe(true);
    expect(hostile?.turrets?.every((turret) => turret.mountSide === 'rear')).toBe(true);
  });

  it('uses map 13 as the combined objective, encounter, and persistent-pressure reference', () => {
    const map = getCoopDefenseMapConfig('13');
    expect(map.objective).toBe('destroy-hostile-bases');
    expect(map.encounters?.length).toBeGreaterThan(0);
    expect(map.persistentSpawns?.some((spawn) => spawn.source.type === 'map')).toBe(true);
    expect(map.persistentSpawns?.some((spawn) => spawn.source.type === 'base')).toBe(true);
    expect(map.encounters?.some((encounter) => encounter.start.type === 'after-previous')).toBe(true);
    expect(map.secondaryObjectives?.some((objective) => objective.type === 'destroy')).toBe(true);
  });

  it('keeps map 16 on the authored finite-assault plus structure-source model', () => {
    const map = getCoopDefenseMapConfig('16');
    expect(map.objective).toBe('repel-assault');
    expect(map.encounters?.length).toBeGreaterThan(0);
    expect(map.persistentSpawns?.some((spawn) => spawn.source.type === 'base')).toBe(true);
    expect(map.secondaryObjectives?.some((objective) => objective.type === 'hold')).toBe(true);
  });

  it('places hostile bases outside the spawn band and before the defended bases', () => {
    for (const mapId of ATTACK_MAP_IDS) {
      const specs = resolveCoopDefenseBases(getCoopDefenseMapConfig(mapId));
      const hostileCells = specs
        .filter((spec) => spec.faction === 'hostile' && (spec.role ?? 'main') === 'main')
        .flatMap((spec) => spec.cells);
      const friendlyCells = specs
        .filter((spec) => spec.faction === 'friendly')
        .flatMap((spec) => spec.cells);

      expect(Math.min(...hostileCells.map((cell) => cell.gridX))).toBeGreaterThan(6);
      expect(Math.max(...hostileCells.map((cell) => cell.gridX)))
        .toBeLessThan(Math.min(...friendlyCells.map((cell) => cell.gridX)));
    }
  });

  it('keeps map 13 persistent pressure on four destructible C-shaped sources', () => {
    const map = getCoopDefenseMapConfig('13');
    const spawnPoints = resolveCoopDefenseBases(map)
      .filter((spec) => spec.role === 'spawn-point');

    expect(spawnPoints.length).toBeGreaterThan(0);
    expect(spawnPoints.every((spec) => spec.region.minGridX >= 0 && spec.region.minGridY >= 0)).toBe(true);
    expect(spawnPoints.every((spec) => spec.spawnCenter !== undefined)).toBe(true);
    for (let firstIndex = 0; firstIndex < spawnPoints.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < spawnPoints.length; secondIndex += 1) {
        const first = spawnPoints[firstIndex].spawnCenter!;
        const second = spawnPoints[secondIndex].spawnCenter!;
        expect(Math.max(Math.abs(first.gridX - second.gridX), Math.abs(first.gridY - second.gridY)))
          .toBeGreaterThan(5);
      }
    }
    for (const source of spawnPoints) {
      expect(source.hpMax).toBeGreaterThan(0);
      expect(source.cells).toHaveLength(7);
      expect(source.spawnCenter).toBeDefined();
      expect(source.cells).not.toContainEqual(source.spawnCenter);
      expect(map.persistentSpawns?.some((spawn) => (
        spawn.source.type === 'base' && spawn.source.baseId === source.id
      ))).toBe(true);
    }
  });

  it('configures map 17 with the final offensive bases and three source-bound pressures', () => {
    const map = getCoopDefenseMapConfig('17');
    const specs = resolveCoopDefenseBases(map);
    const hostileMain = specs.find((spec) => spec.faction === 'hostile' && spec.role === 'main');
    const spawnPoints = specs.filter((spec) => spec.role === 'spawn-point');

    expect(map).toMatchObject({
      objective: 'destroy-hostile-bases',
      itemDrop: { itemLevel: expect.any(Number) },
    });
    expect(map.itemDrop?.itemLevel).toBeGreaterThan(0);
    expect(hostileMain?.hpMax).toBeGreaterThan(0);
    expect(spawnPoints).toHaveLength(2);
    expect(spawnPoints.every((source) => source.spawnCenter !== undefined)).toBe(true);
    expect(spawnPoints.every((source) => map.persistentSpawns?.some((spawn) => (
      spawn.source.type === 'base' && spawn.source.baseId === source.id
    )))).toBe(true);
    expect(map.secondaryObjectives?.find((objective) => objective.type === 'carry')?.targetGoal)
      .toBeGreaterThan(0);
  });

  it('keeps Map 14 outpost authoring focused on its rocket Hold mission', () => {
    const specs = resolveCoopDefenseBases(getCoopDefenseMapConfig('14'));
    const outposts = specs.filter((spec) => spec.role === 'outpost');
    expect(outposts).toHaveLength(1);
    expect(outposts[0].turrets).toHaveLength(2);
    expect(outposts[0].turrets.every((turret) => turret.weaponId === 'TURRET_ROCKET_BURST')).toBe(true);
  });

  it('carries every configured base faction through to the resolved spec', () => {
    for (const mapConfig of COOP_DEFENSE_MAP_CONFIGS) {
      const specs = resolveCoopDefenseBases(mapConfig);
      for (const spec of specs) {
        expect(spec.faction).toBe(mapConfig.bases.find((base) => base.id === spec.id)?.faction);
      }
    }
  });
});
