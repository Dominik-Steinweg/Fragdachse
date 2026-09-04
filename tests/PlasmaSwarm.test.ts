import { describe, expect, it } from 'vitest';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { applyCoopDefenseModifiersToWeaponConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import {
  canTriggerPlasmaSwarm,
  PLASMA_CHARGE_MAX_STACKS,
  PLASMA_CHARGE_DURATION_MS,
  PLASMA_SWARM_CHANCE_PER_STACK_PERCENT,
  PlasmaChargeTracker,
  resolvePlasmaSwarmHoming,
  resolvePlasmaSwarmProjectileProfile,
  resolvePlasmaSwarmProjectileCount,
  resolvePlasmaSwarmRadialAngles,
  shouldIgnorePlasmaSwarmOriginHit,
} from '../src/systems/PlasmaCharge';
import type { CoopDefenseUpgradeProfile } from '../src/types';
import { getCoopDefenseResolvedEffectTotals, getCoopDefenseUpgradeDefinition } from '../src/utils/coopDefenseUpgrades';
import { mergeEnemySlow } from '../src/utils/enemySlow';

function plasmaSwarmProfile(): CoopDefenseUpgradeProfile {
  const upgradeIds = ['unlock_plasma', 'plasma_homing_turn', 'plasma_swarm'] as const;
  return {
    upgrades: Object.fromEntries(upgradeIds.map((id) => [
      id,
      {
        unlocked: true,
        level: getCoopDefenseUpgradeDefinition(id)?.maxLevel ?? 1,
      },
    ])),
  };
}

describe('Plasma Gun Plasma-Aufladung', () => {
  it('builds up to ten stacks and expires the whole refreshed group together', () => {
    const tracker = new PlasmaChargeTracker();

    for (let index = 0; index < PLASMA_CHARGE_MAX_STACKS + 3; index += 1) {
      tracker.addHit('enemy-1', 1_000 + index * 10);
    }
    expect(tracker.getState('enemy-1', 1_999)?.stacks).toBe(PLASMA_CHARGE_MAX_STACKS);
    expect(tracker.getState('enemy-1', 2_030)?.stacks).toBe(10);

    tracker.addHit('enemy-1', 2_030);
    expect(tracker.getState('enemy-1', 2_030 + PLASMA_CHARGE_DURATION_MS - 1)?.stacks).toBe(PLASMA_CHARGE_MAX_STACKS);
    expect(tracker.getState('enemy-1', 2_030 + PLASMA_CHARGE_DURATION_MS)).toBeUndefined();
  });

  it('refreshes all stacks without applying a slow', () => {
    const tracker = new PlasmaChargeTracker();
    tracker.addHit('enemy-1', 0);
    tracker.addHit('enemy-1', 500);

    expect(tracker.getState('enemy-1', PLASMA_CHARGE_DURATION_MS + 500 - 1)?.stacks).toBe(2);
    expect(tracker.getState('enemy-1', PLASMA_CHARGE_DURATION_MS + 500)).toBeUndefined();

    for (let index = 0; index < PLASMA_CHARGE_MAX_STACKS; index += 1) tracker.addHit('enemy-2', 3_000 + index);
    expect(tracker.getState('enemy-2', 3_100)?.stacks).toBe(PLASMA_CHARGE_MAX_STACKS);
  });

  it('uses two percentage points per stack and caps each primary hit at one proc', () => {
    const chance = PLASMA_SWARM_CHANCE_PER_STACK_PERCENT / 100;
    expect(chance).toBeGreaterThan(0);
    expect(resolvePlasmaSwarmProjectileCount(chance * 100 - Number.EPSILON, () => 0)).toBe(1);
    expect(resolvePlasmaSwarmProjectileCount(chance * 100, () => chance)).toBe(0);
    expect(resolvePlasmaSwarmProjectileCount(100, () => 0.99)).toBe(1);
  });

  it('distributes the base swarm evenly over 360 degrees with a rotation offset', () => {
    const angles = resolvePlasmaSwarmRadialAngles(4, () => 0);
    expect(angles).toHaveLength(4);
    expect(angles[1] - angles[0]).toBeCloseTo(Math.PI / 2);
    expect(angles[2] - angles[1]).toBeCloseTo(Math.PI / 2);
    expect(angles[3] - angles[2]).toBeCloseTo(Math.PI / 2);
  });

  it('applies swarm multipliers after the currently resolved Plasma values', () => {
    expect(resolvePlasmaSwarmProjectileProfile({ damage: 3, size: 8, speed: 650, range: 500 })).toEqual({
      damage: 1.5,
      size: 4,
      speed: 325,
      range: 500,
    });
  });

  it('refreshes discharge slow through the shared merge slot instead of stacking it', () => {
    const first = mergeEnemySlow(undefined, 0.4, 2_000, 1_000);
    const refreshed = mergeEnemySlow(first, 0.4, 2_000, 2_500);

    expect(refreshed.movementFactor).toBeCloseTo(0.6);
    expect(refreshed.expiresAt).toBe(4_500);
  });

  it('does not let swarm projectiles recursively create more swarms', () => {
    expect(canTriggerPlasmaSwarm({ plasmaSwarmEnabled: true })).toBe(true);
    expect(canTriggerPlasmaSwarm({ plasmaSwarmEnabled: true, plasmaSwarmProjectile: true })).toBe(false);
    expect(canTriggerPlasmaSwarm({ plasmaSwarmEnabled: false })).toBe(false);
  });

  it('protects the spawn target only until the swarm projectile leaves its hitbox', () => {
    expect(shouldIgnorePlasmaSwarmOriginHit(
      { plasmaSwarmProjectile: true },
      'enemy-1',
      'enemy-1',
      false,
    )).toBe(true);
    expect(shouldIgnorePlasmaSwarmOriginHit(
      { plasmaSwarmProjectile: true },
      'enemy-1',
      'enemy-1',
      true,
    )).toBe(false);
    expect(shouldIgnorePlasmaSwarmOriginHit(
      { plasmaSwarmProjectile: true },
      'enemy-1',
      'enemy-2',
      false,
    )).toBe(false);
  });

  it('replaces the old kill split modifier with the stack upgrade marker', () => {
    const totals = getCoopDefenseResolvedEffectTotals(plasmaSwarmProfile());
    const resolved = applyCoopDefenseModifiersToWeaponConfig(WEAPON_CONFIGS.PLASMA, 'weapon1', totals);

    expect(resolved.plasmaSwarmEnabled).toBeGreaterThan(0);
    expect(resolved.plasmaSwarmProjectileCount).toBeGreaterThan(0);
    expect(resolved.plasmaSwarmExplosionRadius).toBeGreaterThan(0);
    expect(resolved.plasmaSwarmExplosionDamage).toBeGreaterThan(0);
    expect('killSplitCount' in resolved).toBe(false);
    const effects = getCoopDefenseUpgradeDefinition('plasma_swarm')?.effects ?? [];
    expect(effects).toHaveLength(4);
    expect(effects.every((effect) => effect.mode === 'add_per_level' && Number.isFinite(effect.value))).toBe(true);
    expect(getCoopDefenseUpgradeDefinition('plasma_swarm')?.requires).toEqual([
      { upgradeId: 'unlock_plasma', minLevel: 1 },
    ]);
  });

  it('combines the three-stage guidance upgrades and keeps discharge slow on the explosion', () => {
    const upgradeIds = ['unlock_plasma', 'plasma_homing_turn', 'plasma_swarm', 'plasma_swarm_discharge'] as const;
    const profile: CoopDefenseUpgradeProfile = {
      upgrades: Object.fromEntries(upgradeIds.map((id) => [
        id,
        { unlocked: true, level: getCoopDefenseUpgradeDefinition(id)?.maxLevel ?? 1 },
      ])),
    };
    const totals = getCoopDefenseResolvedEffectTotals(profile);
    const resolved = applyCoopDefenseModifiersToWeaponConfig(WEAPON_CONFIGS.PLASMA, 'weapon1', totals);

    expect(resolved.fire.type).toBe('projectile');
    if (resolved.fire.type !== 'projectile') return;
    expect(resolved.fire.projectileSpeed).toBeGreaterThan(WEAPON_CONFIGS.PLASMA.fire.type === 'projectile'
      ? WEAPON_CONFIGS.PLASMA.fire.projectileSpeed
      : 0);
    expect(resolved.fire.homing?.maxTurnDegreesPerStep).toBeGreaterThan(0);
    expect(resolved.range).toBeGreaterThan(0);
    expect(resolvePlasmaSwarmHoming(resolved.fire.homing)?.maxTurnDegreesPerStep)
      .toBeCloseTo((resolved.fire.homing?.maxTurnDegreesPerStep ?? 0) * 2);
    expect(resolved.plasmaSwarmProjectileCount).toBeGreaterThan(0);
    expect(resolved.plasmaSwarmExplosionRadius).toBeGreaterThan(0);
    expect(resolved.plasmaSwarmExplosionDamage).toBeGreaterThan(0);
    expect(resolved.plasmaSwarmExplosionSlowFraction).toBeGreaterThan(0);
    expect(getCoopDefenseUpgradeDefinition('plasma_projectile_speed')).toBeNull();
  });

  it('treats Plasma Swarm Discharge as a regular upgrade', () => {
    const discharge = getCoopDefenseUpgradeDefinition('plasma_swarm_discharge');

    expect(discharge?.costPerLevel).toBeGreaterThan(0);
    expect(discharge?.bossPointCostPerLevel).toBeGreaterThanOrEqual(0);
  });

});
