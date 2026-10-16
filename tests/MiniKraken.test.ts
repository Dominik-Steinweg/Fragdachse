import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 }, Math: { Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)) } }));
import { navigationTestWorld } from './navigationTestWorld';
import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import { KRAKEN_BOSS_DEFAULTS } from '../src/config/krakenBoss';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import { normalizeCoopDefenseMapConfig } from '../src/config/coopDefenseMapAuthoring';
import map13 from '../src/config/coopDefenseMaps/13-brutbomben.json';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { EnemyFlowFieldService } from '../src/systems/EnemyFlowFieldService';
import { decodeEnemyUpserts, encodeEnemyUpsert } from '../src/network/enemySnapshotCodec';
import { WaterGeometry } from '../src/arena/WaterGeometry';
import { abyssCameoEnvelope } from '../src/effects/kraken/AbyssCameoRenderer';
import type { EnemyEntity } from '../src/entities/EnemyEntity';
import type { NavigationObstacle } from '../src/systems/navigation/NavigationGeometry';

const rect = (id: string, left: number, top: number, right: number, bottom: number, kind: NavigationObstacle['kind'] = 'rock'): NavigationObstacle =>
  ({ id, kind, shape: 'rect', left, top, right, bottom });
function enemy(id: string, x: number, y: number): EnemyEntity {
  const config = getCoopDefenseEnemyConfig('mini-kraken');
  return { id, kind: 'mini-kraken', faction: 'hostile', sprite: { active: true, x, y },
    getSize: () => config.size, getMoveSpeed: () => config.moveSpeed,
    getAttackWeapons: () => config.weapons.map(w => ({ ...w, weapon: { config: WEAPON_CONFIGS[w.weaponId] } })),
  } as unknown as EnemyEntity;
}

describe('Mini-Kraken content', () => {
  it('is an amphibious, engaging siege enemy with a leap, melee ink and a death burst, and hatches from kraken eggs', () => {
    const config = getCoopDefenseEnemyConfig('mini-kraken');
    expect(config.movementTarget).toBe('bases');
    expect(config.amphibious?.swimSpeedFactor).toBeGreaterThan(1);
    expect(config.engage!.enterPx).toBeLessThan(config.engage!.exitPx);
    expect(config.shieldCharger).toMatchObject({ style: 'leap', shieldArcDegrees: 0 });
    expect(config.shieldCharger!.structureDamageMult).toBeGreaterThan(0);
    expect(config.deathBurst!.structureDamageMult).toBeGreaterThan(0);
    expect(WEAPON_CONFIGS[config.weapons[0]!.weaponId]!.fire.type).toBe('melee');
    expect(KRAKEN_BOSS_DEFAULTS.eggs.broodTable.entries.map(entry => entry.enemyKind)).toEqual(['mini-kraken']);
  });

  it('keeps the kraken boss and egg free of brood abilities', () => {
    for (const kind of ['abyssal-kraken', KRAKEN_BOSS_DEFAULTS.eggs.enemyKind]) {
      const config = getCoopDefenseEnemyConfig(kind);
      expect(config.amphibious).toBeUndefined();
      expect(config.engage).toBeUndefined();
      expect(config.deathBurst).toBeUndefined();
      expect(config.shieldCharger).toBeUndefined();
    }
  });

  it('heralds the kraken on map 13: packs rise from water and a cameo glides under the lake first', () => {
    const map = getCoopDefenseMapConfig('13');
    const heralds = (map.encounters ?? []).flatMap(encounter => encounter.groups).filter(group => group.enemyKind === 'mini-kraken');
    expect(heralds.length).toBeGreaterThan(0);
    for (const group of heralds) {
      expect(group.spawnArea).toMatchObject({ medium: 'water', cluster: true });
      expect(group.count).toBeGreaterThanOrEqual(3);
      expect(group.count).toBeLessThanOrEqual(5);
    }
    expect(map.abyssCameo).toBeDefined();
    const firstHerald = Math.min(...(map.encounters ?? []).filter(e => e.groups.some(g => g.enemyKind === 'mini-kraken'))
      .map(e => e.start.type === 'time' ? e.start.atMs : Infinity));
    expect(map.abyssCameo!.atMs + map.abyssCameo!.durationMs).toBeLessThanOrEqual(firstHerald);
  });

  it('rejects water spawns of land enemies and water areas without water', () => {
    const raw = structuredClone(map13) as unknown as Record<string, unknown>;
    const encounters = raw.encounters as { groups: { enemyKind: string; spawnArea?: Record<string, unknown> }[] }[];
    encounters[0]!.groups[0]!.enemyKind = 'zombie-badger';
    expect(() => normalizeCoopDefenseMapConfig(raw as never)).toThrow(/non-amphibious/);
    encounters[0]!.groups[0]!.enemyKind = 'mini-kraken';
    encounters[0]!.groups[0]!.spawnArea = { gridX: 90, gridY: 2, widthCells: 3, heightCells: 3, medium: 'water' };
    expect(() => normalizeCoopDefenseMapConfig(raw as never)).toThrow(/without water/);
  });
});

describe('Amphibious navigation', () => {
  it('routes an amphibious body through water that blocks land bodies; land profiles stay unchanged', () => {
    const lake = rect('water:lake', 96, 0, 160, 256, 'water');
    const world = navigationTestWorld([lake]);
    const swim = EnemyFlowFieldService.fromView(world.coordinator.registerField('swim', { goalMode: 'dynamic', bodyRadius: 12, swimCostRatio: 1.6 }));
    const goal = [8 * 17 + 14];
    world.coordinator.setGoalCells('test', goal); world.coordinator.setGoalCells('swim', goal);
    world.flush();
    expect(world.field.queryNavigation(32, 128).status).toBe('unreachable');
    expect(swim.queryNavigation(32, 128).status).toBe('ready');
    expect(swim.getNavigationGeometry()!.isFree(128, 128, 12)).toBe(true);
    expect(world.field.getNavigationGeometry()!.isFree(128, 128, 12)).toBe(false);
    world.destroy();
  });

  it('measures how much of a body is over water', () => {
    const metrics = { gridCols: 10, gridRows: 10, offsetX: 0, offsetY: 0 } as never;
    const water = new WaterGeometry([{ gridX: 4, gridY: 4 }, { gridX: 5, gridY: 4 }, { gridX: 4, gridY: 5 }, { gridX: 5, gridY: 5 }], metrics);
    expect(water.wetShare(160, 160, 12)).toBe(1);
    expect(water.wetShare(20, 20, 12)).toBe(0);
    expect(water.wetShare(130, 160, 12)).toBeGreaterThan(0);
  });
});

describe('Hybrid targeting', () => {
  const base = rect('base:main', 176, 96, 208, 160, 'base');
  const bases = [{ id: 'main', isGoalSource: true, cellCoords: Int32Array.of(12, 8) }];
  const settle = (world: ReturnType<typeof navigationTestWorld>, units: EnemyEntity[], now: number) => {
    world.intents.update(units, now); world.flush(); world.intents.update(units, now + 1);
  };

  it('sieges the base, hunts a player that comes close and returns once the player leaves (with dwell)', () => {
    const world = navigationTestWorld([base], bases), unit = enemy('mk', 64, 128);
    const config = getCoopDefenseEnemyConfig('mini-kraken').engage!;
    world.catalog.updateTargets([{ kind: 'player', id: 'p', x: 64 + config.enterPx + 40, y: 128 }]);
    settle(world, [unit], 0);
    expect(world.intents.get('mk')?.target).toEqual({ kind: 'base', id: 'main' });
    world.catalog.updateTargets([{ kind: 'player', id: 'p', x: 64, y: 128 - Math.min(100, config.enterPx - 20) }]);
    settle(world, [unit], 100);
    expect(world.intents.get('mk')?.target).toEqual({ kind: 'player', id: 'p' });
    // Beyond the exit radius, but inside the minimum dwell: the hunt continues.
    world.catalog.updateTargets([{ kind: 'player', id: 'p', x: 64, y: 128 - config.exitPx - 40 }]);
    settle(world, [unit], 100 + config.minDwellMs / 2);
    expect(world.intents.get('mk')?.target).toEqual({ kind: 'player', id: 'p' });
    settle(world, [unit], 200 + config.minDwellMs);
    expect(world.intents.get('mk')?.target).toEqual({ kind: 'base', id: 'main' });
    world.destroy();
  });
});

describe('Submerged replication', () => {
  it('round-trips the submerged flag', () => {
    const out: (number | string)[] = [];
    encodeEnemyUpsert(out, { id: 'e1', submerged: true });
    encodeEnemyUpsert(out, { id: 'e2', submerged: false });
    const [a, b] = decodeEnemyUpserts(out);
    expect(a?.submerged).toBe(true);
    expect(b?.submerged).toBe(false);
  });

  it('fades the abyss cameo in and out over its window', () => {
    expect(abyssCameoEnvelope(0)).toBe(0);
    expect(abyssCameoEnvelope(.5)).toBe(1);
    expect(abyssCameoEnvelope(.9)).toBeGreaterThan(0);
    expect(abyssCameoEnvelope(1)).toBe(0);
  });
});
