import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
  },
}));

import { applyCoopDefenseModifiersToWeaponConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import {
  COOP_DEFENSE_UPGRADE_DEFINITIONS,
  getCoopDefenseResolvedEffectTotals,
  getCoopDefenseUpgradeDefinition,
} from '../src/utils/coopDefenseUpgrades';
import type { CoopDefenseUpgradeProfile, TrackedProjectile } from '../src/types';
import { LoadoutManager } from '../src/loadout/LoadoutManager';
import { Ak47StrategicTargetSystem } from '../src/systems/Ak47StrategicTargetSystem';

function profile(levels: Readonly<Record<string, number>>): CoopDefenseUpgradeProfile {
  return {
    upgrades: Object.fromEntries(Object.entries(levels).map(([id, level]) => [
      id,
      { unlocked: true, level },
    ])),
  };
}

function akConfig(levels: Readonly<Record<string, number>>) {
  return applyCoopDefenseModifiersToWeaponConfig(
    WEAPON_CONFIGS.AK47,
    'weapon2',
    getCoopDefenseResolvedEffectTotals(profile(levels)),
  );
}

function makeManager(config: ReturnType<typeof akConfig>): any {
  const manager = Object.create(LoadoutManager.prototype) as any;
  manager.ak47States = new Map();
  manager.loadouts = new Map([['p1', { weapon2: { config } }]]);
  manager.resetAk47State('p1');
  return manager;
}

function projectile(shotId: number, overrides: Partial<TrackedProjectile> = {}): TrackedProjectile {
  return {
    id: shotId,
    ownerId: 'p1',
    ak47ShotId: shotId,
    ak47HitConfirmed: false,
    ak47FireSuperiorityShot: false,
    ...overrides,
  } as TrackedProjectile;
}

describe('AK-47 Coop-Defense-Upgradebaum', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps nine post-unlock nodes, two columns, and exactly two boss upgrades', () => {
    const ids = [
      'ak47_firepower', 'ak47_rhythm', 'ak47_rock_destruction',
      'ak47_fire_control', 'ak47_fire_superiority', 'ak47_breakthrough_magazine',
      'ak47_strategic_targets', 'ak47_target_prioritization', 'ak47_explosive_target_acquisition',
    ];
    expect(ids.every(id => COOP_DEFENSE_UPGRADE_DEFINITIONS[id])).toBe(true);
    expect(ids.filter(id => COOP_DEFENSE_UPGRADE_DEFINITIONS[id]?.bossPointCostPerLevel).sort())
      .toEqual(['ak47_fire_superiority', 'ak47_strategic_targets']);
    expect(getCoopDefenseUpgradeDefinition('ak47_fire_superiority')?.requires)
      .toEqual([{ upgradeId: 'ak47_fire_control', minLevel: 1 }]);
    expect(getCoopDefenseUpgradeDefinition('ak47_strategic_targets')?.requires).toEqual([
      { upgradeId: 'ak47_rock_destruction', minLevel: 1 },
      { upgradeId: 'ak47_breakthrough_magazine', minLevel: 1 },
    ]);
  });

  it('shares the exact five-stack cap and combines firepower/fire-control additively', () => {
    const firepower = akConfig({ unlock_ak47: 1, ak47_firepower: 1 });
    const control = akConfig({ unlock_ak47: 1, ak47_fire_control: 1 });
    const combined = akConfig({ unlock_ak47: 1, ak47_firepower: 1, ak47_fire_control: 1, ak47_rhythm: 3 });
    expect(firepower.ak47Focus?.maxStacks).toBe(5);
    expect(control.ak47Focus?.maxStacks).toBe(0);
    expect(control.ak47Focus?.fireControlEnabled).toBe(1);
    expect(combined.ak47Focus?.maxStacks).toBe(5);
    expect(combined.ak47Focus?.damagePerStack).toBeCloseTo(0.25);
    expect(combined.ak47Focus?.fireControlSpreadPerStack).toBeCloseTo(0.08);
    expect(combined.ak47Focus?.fireControlRangePerStack).toBeCloseTo(0.03);
    expect(combined.ak47Focus?.fireControlProjectileSpeedPerStack).toBeCloseTo(0.05);

    const controlManager = makeManager(control);
    for (let shotId = 1; shotId <= 5; shotId += 1) {
      controlManager.registerAk47ProjectileHit(projectile(shotId));
    }
    expect(controlManager.ak47States.get('p1').stacks).toBe(5);
  });

  it('resolves rhythm, rock levels, and 3/6/9/12 breakthrough ammunition', () => {
    expect(akConfig({ unlock_ak47: 1, ak47_firepower: 1, ak47_rhythm: 1 }).ak47Focus?.damagePerStack)
      .toBeCloseTo(0.15);
    expect(akConfig({ unlock_ak47: 1, ak47_firepower: 1, ak47_rhythm: 1, ak47_rock_destruction: 1 }).rockDamageMult)
      .toBe(1);
    expect(akConfig({ unlock_ak47: 1, ak47_firepower: 1, ak47_rhythm: 1, ak47_rock_destruction: 2 }).rockDamageMult)
      .toBe(2);
    expect(akConfig({ unlock_ak47: 1, ak47_firepower: 1, ak47_rhythm: 1, ak47_rock_destruction: 3 }).rockDamageMult)
      .toBe(3);
    for (const level of [0, 1, 2, 3]) {
      expect(akConfig({ unlock_ak47: 1, ak47_firepower: 1, ak47_fire_control: 1, ak47_fire_superiority: 1, ak47_breakthrough_magazine: level }).ak47Focus?.fireSuperiorityShots)
        .toBe(3 + level * 3);
    }
    expect(akConfig({ unlock_ak47: 1 }).rockDamageMult).toBe(0);
  });

  it('builds one shared hit chain, resets on a miss, and does not retrigger while pending', () => {
    const config = akConfig({
      unlock_ak47: 1,
      ak47_firepower: 1,
      ak47_fire_control: 1,
      ak47_fire_superiority: 1,
    });
    const manager = makeManager(config);
    for (let shotId = 1; shotId <= 5; shotId += 1) {
      manager.registerAk47ProjectileHit(projectile(shotId));
    }
    expect(manager.ak47States.get('p1').stacks).toBe(5);
    expect(manager.ak47States.get('p1').fireSuperiorityShotsAvailable).toBe(3);

    const miss = projectile(6);
    manager.resolveAk47Projectile(miss);
    expect(manager.ak47States.get('p1').stacks).toBe(0);

    const state = manager.ak47States.get('p1');
    state.stacks = 5;
    state.fireSuperiorityShotsAvailable = 0;
    state.pendingFireSuperiorityShotIds.add(99);
    manager.registerAk47ProjectileHit(projectile(7));
    expect(state.fireSuperiorityShotsAvailable).toBe(0);
    expect(state.pendingFireSuperiorityShotIds.has(99)).toBe(true);
  });

  it('refunds the concrete strategic penetrator once and ends only after pending resolves', () => {
    const manager = makeManager(akConfig({ unlock_ak47: 1, ak47_firepower: 1, ak47_fire_control: 1, ak47_fire_superiority: 1 }));
    manager.setAk47StrategicTargetHitResolver(() => true);
    const state = manager.ak47States.get('p1');
    state.fireSuperiorityShotsAvailable = 0;
    state.fireSuperiorityTotalShots = 1;
    state.pendingFireSuperiorityShotIds.add(10);
    const shot = projectile(10, { ak47FireSuperiorityShot: true });

    expect(manager.registerAk47StrategicTargetHit(shot, 'enemy-1')).toBe(true);
    expect(manager.registerAk47StrategicTargetHit(shot, 'enemy-2')).toBe(false);
    expect(state.fireSuperiorityShotsAvailable).toBe(1);
    expect(manager.isAk47FireSuperiorityActive('p1')).toBe(true);
    expect(manager.isAk47FireSuperiorityAvailable('p1')).toBe(true);

    manager.resolveAk47Projectile(shot);
    expect(state.pendingFireSuperiorityShotIds.size).toBe(0);
    expect(state.fireSuperiorityShotsAvailable).toBe(1);

    state.fireSuperiorityShotsAvailable = 0;
    state.pendingFireSuperiorityShotIds.add(11);
    expect(manager.isAk47FireSuperiorityActive('p1')).toBe(true);
    expect(manager.isAk47FireSuperiorityAvailable('p1')).toBe(false);
  });
});

function makeTargetFixture(focus: any) {
  const enemies = [
    { id: 'near', kind: 'zombie-badger', faction: 'hostile', sprite: { x: 1000, y: 0, rotation: 0, active: true }, getHp: () => 100, isBurrowed: () => false },
    { id: 'far', kind: 'inferno-colossus', faction: 'hostile', sprite: { x: 300, y: 300, rotation: 0, active: true }, getHp: () => 100, isBurrowed: () => false },
  ] as any[];
  const player = { id: 'p1', sprite: { x: 0, y: 0, rotation: 0 } } as any;
  const enemyManager = {
    getAllEnemies: () => enemies,
    getEnemy: (id: string) => enemies.find(enemy => enemy.id === id),
  } as any;
  const playerManager = {
    getAllPlayers: () => [player],
    getPlayer: () => player,
  } as any;
  const combat = {
    canDamageTarget: () => true,
    hasLineOfSight: (_x: number, _y: number, x: number) => x !== 1000,
  } as any;
  const loadout = {
    getEquippedWeaponConfig: () => ({ id: 'AK47', ak47Focus: focus }),
    registerAk47StrategicTargetHit: vi.fn(),
  } as any;
  return { enemies, player, system: new Ak47StrategicTargetSystem(playerManager, enemyManager, combat, loadout) };
}

describe('AK-47 Strategische Ziele', () => {
  it('runs 4s active / 4s cooldown and debounces a kill for exactly 100ms with +1s', () => {
    const { enemies, system } = makeTargetFixture({
      strategicTargetEnabled: 1,
      strategicTargetDamageBonus: 0.25,
      targetPrioritizationEnabled: 0,
      explosiveTargetAcquisitionLevel: 0,
    });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    system.hostUpdate(0);
    expect(system.getNetSnapshot(0)).toHaveLength(1);
    const marked = system.getNetSnapshot(0)[0];
    enemies.find(enemy => enemy.id === marked.enemyId).getHp = () => 0;

    system.hostUpdate(1000);
    expect(system.getNetSnapshot(1000)).toHaveLength(0);
    system.hostUpdate(1099);
    expect(system.getNetSnapshot(1099)).toHaveLength(0);
    system.hostUpdate(1100);
    expect(system.getNetSnapshot(1100)[0]?.phaseEndsAt).toBe(5000);

    system.hostUpdate(5000);
    expect(system.getNetSnapshot(5000)).toHaveLength(0);
    system.hostUpdate(9000);
    expect(system.getNetSnapshot(9000)).toHaveLength(1);
  });

  it('uses random visible targets normally and cursor-first selection with the follow-up', () => {
    const normal = makeTargetFixture({
      strategicTargetEnabled: 1,
      strategicTargetDamageBonus: 0.25,
      targetPrioritizationEnabled: 0,
      explosiveTargetAcquisitionLevel: 0,
    });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    normal.system.hostUpdate(0);
    expect(normal.system.getNetSnapshot(0)[0]?.enemyId).toBe('far');

    const prioritized = makeTargetFixture({
      strategicTargetEnabled: 1,
      strategicTargetDamageBonus: 0.25,
      targetPrioritizationEnabled: 1,
      explosiveTargetAcquisitionLevel: 3,
    });
    prioritized.system.hostUpdate(0);
    expect(prioritized.system.getNetSnapshot(0)[0]?.enemyId).toBe('near');
    for (const [level, radius, fraction] of [[1, 35, 0.2], [2, 50, 0.3], [3, 65, 0.4]] as const) {
      const fixture = makeTargetFixture({
        strategicTargetEnabled: 1,
        strategicTargetDamageBonus: 0.25,
        targetPrioritizationEnabled: 1,
        explosiveTargetAcquisitionLevel: level,
      });
      fixture.system.hostUpdate(0);
      expect(fixture.system.getNetSnapshot(0)[0]?.enemyId).toBe('near');
      expect(fixture.system.handleDirectAk47EnemyHit(projectile(level), 'near', 0))
        .toEqual({ damageMultiplier: 1.25, explosionRadius: radius, explosionDamageFraction: fraction });
    }
  });
});
