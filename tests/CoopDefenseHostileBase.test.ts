import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_MAP_CONFIGS,
  getCoopDefenseMapConfig,
} from '../src/config/coopDefenseMaps';
import { resolveCoopDefenseBases } from '../src/arena/BaseRegistry';
import { applyArenaMetricsForMode } from '../src/config';
import { getCoopDefenseMapUnlockedByVictoryOn } from '../src/config/coopDefenseMapUnlocks';
import { COOP_DEFENSE_MODE } from '../src/gameModes';

const ATTACK_MAP_IDS = ['12', '13', '16'] as const;

describe('coop-defense hostile bases', () => {
  it('uses maps 12, 13 and 16 as attack maps and ends on map 16', () => {
    expect(COOP_DEFENSE_MAP_CONFIGS.map((map) => map.mapId)).toContain('16');
    expect(COOP_DEFENSE_MAP_CONFIGS.at(-1)?.mapId).toBe('16');
    expect(getCoopDefenseMapUnlockedByVictoryOn('16')).toBeNull();
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

  it('introduces a small turretless 1000-HP hive on map 12', () => {
    const hostile = getCoopDefenseMapConfig('12').bases.find((base) => base.faction === 'hostile');
    expect(hostile?.hpMax).toBe(1000);
    expect(hostile?.shape.kind).toBe('cells');
    expect(hostile?.shape.kind === 'cells' ? hostile.shape.cells : []).toHaveLength(10);
    expect(hostile?.turrets ?? []).toHaveLength(0);
    expect(hostile?.powerUpPedestals ?? []).toHaveLength(0);
  });

  it('uses the original 17-cell footprint, 2000 HP and two spore turrets on map 13', () => {
    const hostile = getCoopDefenseMapConfig('13').bases.find((base) => base.faction === 'hostile');
    expect(hostile?.hpMax).toBe(2000);
    expect(hostile?.shape.kind).toBe('cells');
    expect(hostile?.shape.kind === 'cells' ? hostile.shape.cells : []).toHaveLength(17);
    expect(hostile?.turrets).toHaveLength(2);
    expect(hostile?.turrets?.map((turret) => turret.weaponId)).toEqual(['BASE_SPOREN', 'BASE_SPOREN']);
    expect(hostile?.turrets?.map((turret) => turret.mountSide)).toEqual(['rear', 'rear']);
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

  it('keeps map 13 spawn waves on four destructible C-shaped sources', () => {
    const spawnPoints = resolveCoopDefenseBases(getCoopDefenseMapConfig('13'))
      .filter((spec) => spec.role === 'spawn-point');

    expect(spawnPoints).toHaveLength(4);
    expect(spawnPoints.map((spec) => [spec.region.minGridX, spec.region.minGridY])).toEqual([
      [1, 2],
      [17, 6],
      [3, 15],
      [19, 12],
    ]);
    expect(spawnPoints.map((spec) => [spec.spawnCenter?.gridX, spec.spawnCenter?.gridY])).toEqual([
      [2, 3],
      [18, 7],
      [4, 16],
      [20, 13],
    ]);
    for (let firstIndex = 0; firstIndex < spawnPoints.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < spawnPoints.length; secondIndex += 1) {
        const first = spawnPoints[firstIndex].spawnCenter!;
        const second = spawnPoints[secondIndex].spawnCenter!;
        expect(Math.max(Math.abs(first.gridX - second.gridX), Math.abs(first.gridY - second.gridY)))
          .toBeGreaterThan(5);
      }
    }
    for (const source of spawnPoints) {
      expect(source.hpMax).toBeLessThan(1000);
      expect(source.cells).toHaveLength(7);
      expect(source.spawnWave).toBeDefined();
      expect(source.spawnCenter).toBeDefined();
      expect(source.cells).not.toContainEqual(source.spawnCenter);
      expect(source.spawnWave?.enemyKind).toBeDefined();
    }
  });

  it('configures map 16 with four destructible hostile spawn sources', () => {
    const map = getCoopDefenseMapConfig('16');
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', map.arenaWidthCells);
    const specs = resolveCoopDefenseBases(map);
    const hostileMain = specs.find((spec) => spec.faction === 'hostile' && spec.role === 'main');
    const middleBase = specs.find((spec) => spec.id === 'coop-base-middle');
    const middleOutposts = specs
      .filter((spec) => spec.id.startsWith('friendly-middle-mushroom-'));
    const spawnPoints = specs.filter((spec) => spec.role === 'spawn-point');
    const hostileTurrets = specs
      .filter((spec) => spec.faction === 'hostile' && spec.role === 'outpost')
      .flatMap((spec) => spec.turrets);

    expect(map).toMatchObject({
      arenaWidthCells: 104,
      timeOfDay: '05:00',
      trackMode: 'void-fire',
      objective: 'destroy-hostile-bases',
    });
    expect(hostileMain?.hpMax).toBeGreaterThan(0);
    expect(hostileMain?.cells).toHaveLength(17);
    expect(middleBase?.region.minGridX).toBe(47);
    expect(middleOutposts.map((spec) => [spec.region.minGridX, spec.region.minGridY])).toEqual([
      [44, 11],
      [44, 17],
    ]);
    expect(hostileTurrets).toHaveLength(3);
    expect(hostileTurrets.map((turret) => turret.weaponId)).toEqual([
      'TURRET_VOID_FLAME',
      'TURRET_VOID_FLAME',
      'TURRET_VOID_FLAME',
    ]);
    expect(spawnPoints).toHaveLength(4);
    expect(spawnPoints.map((source) => [source.region.minGridX, source.region.minGridY])).toEqual([
      [1, 4],
      [2, 24],
      [23, 4],
      [31, 24],
    ]);
    expect(spawnPoints.map((source) => [source.spawnCenter?.gridX, source.spawnCenter?.gridY])).toEqual([
      [2, 5],
      [3, 25],
      [24, 5],
      [32, 25],
    ]);
    for (const source of spawnPoints.slice(2)) {
      expect(middleBase!.region.minGridX - source.region.maxGridX).toBeGreaterThan(10);
    }
    for (const source of spawnPoints) {
      expect(source.cells).toHaveLength(7);
      expect(source.cells).not.toContainEqual(source.spawnCenter);
      expect(source.hpMax).toBeGreaterThan(0);
      expect(source.spawnWave).toMatchObject({
        enemyKind: expect.any(String),
        intervalMs: expect.any(Number),
        countPerWave: expect.any(Number),
        startAtMs: expect.any(Number),
      });
      expect(source.spawnWave!.intervalMs).toBeGreaterThan(0);
      expect(source.spawnWave!.countPerWave).toBeGreaterThan(0);
      expect(source.spawnWave!.startAtMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('does not add plasma outposts to map 14', () => {
    const specs = resolveCoopDefenseBases(getCoopDefenseMapConfig('14'));
    expect(specs.filter((spec) => spec.role === 'outpost')).toHaveLength(0);
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
