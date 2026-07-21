import { describe, expect, it } from 'vitest';
import {
  getCoopDefenseMapConfig,
  getCoopDefenseMapScheduledXp,
  resolveCoopDefenseMapWaveConfigs,
} from '../src/config/coopDefenseMaps';
import { applyCoopDefenseModifiersToWeaponConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { getAdrenalineSyringeDropChance } from '../src/utils/adrenalineDrops';
import type { CoopDefenseUpgradeProfile } from '../src/types';
import {
  getCoopDefenseResolvedEffectTotals,
  getCoopDefenseUpgradeDefinition,
} from '../src/utils/coopDefenseUpgrades';

function maxProfile(levels: Record<string, number>): CoopDefenseUpgradeProfile {
  return {
    upgrades: Object.fromEntries(
      Object.entries(levels).map(([id, level]) => [id, { unlocked: true, level }]),
    ),
  };
}

describe('AWP coop-defense upgrades', () => {
  it('merges the left and right branches into the second boss upgrade', () => {
    expect(getCoopDefenseUpgradeDefinition('awp_adrenaline_cost')?.requires)
      .toEqual([{ upgradeId: 'unlock_awp', minLevel: 1 }]);
    expect(getCoopDefenseUpgradeDefinition('awp_aim_duration')?.requires)
      .toEqual([{ upgradeId: 'awp_adrenaline_cost', minLevel: 3 }]);
    expect(getCoopDefenseUpgradeDefinition('awp_moving_precision')?.requires)
      .toEqual([{ upgradeId: 'awp_aim_duration', minLevel: 3 }]);
    expect(getCoopDefenseUpgradeDefinition('awp_destruction_corridor')?.requires).toEqual([
      { upgradeId: 'awp_moving_precision', minLevel: 1 },
      { upgradeId: 'awp_fire_trail', minLevel: 1 },
    ]);
  });

  it('resolves the fully upgraded charge, mobility, and penetration values', () => {
    const totals = getCoopDefenseResolvedEffectTotals(maxProfile({
      unlock_awp: 1,
      awp_adrenaline_cost: 3,
      awp_aim_duration: 3,
      awp_moving_precision: 1,
      awp_charge_damage: 1,
      awp_penetrating_shot: 1,
      awp_fire_trail: 1,
      awp_destruction_corridor: 1,
      awp_full_charge_time: 3,
      awp_full_charge_damage: 3,
    }));
    const resolved = applyCoopDefenseModifiersToWeaponConfig(WEAPON_CONFIGS.AWP, 'weapon2', totals);

    expect(resolved.adrenalinCost).toBeCloseTo(28);
    expect(resolved.cooldown).toBeCloseTo(320);
    expect(resolved.spreadMoving).toBeCloseTo(8.75);
    expect(resolved.scopeConfig?.scopeInMs).toBeCloseTo(480);
    expect(resolved.scopeConfig?.fullScopeViewRadius).toBeCloseTo(120);
    expect(resolved.penetrationCount).toBe(1_000_000);
    expect(resolved.penetrationDamageRetention).toBe(1);
    expect(resolved.penetratesRocks).toBe(1);
    expect(resolved.awpCharge).toMatchObject({
      maxDamageBonus: 1,
      fireTrailDurationMs: 2000,
      fireTrailHalfWidthCells: 2,
      corridorEnabled: 1,
    });
    expect(resolved.awpCharge?.durationMs).toBeCloseTo(750);
    expect(resolved.awpCharge?.fullChargeDamageBonus).toBeCloseTo(0.6);
  });
});

describe('Negev coop-defense upgrades', () => {
  it('merges both completed branches into the unlimited killstreak', () => {
    expect(getCoopDefenseUpgradeDefinition('negev_killstreak')?.requires).toEqual([
      { upgradeId: 'negev_rock_damage', minLevel: 1 },
      { upgradeId: 'negev_burning_bullets', minLevel: 1 },
    ]);
    expect(getCoopDefenseUpgradeDefinition('negev_killstreak_recovery')?.requires)
      .toEqual([{ upgradeId: 'negev_killstreak', minLevel: 1 }]);
    expect(getCoopDefenseUpgradeDefinition('negev_killstreak_explosion')?.requires)
      .toEqual([{ upgradeId: 'negev_killstreak', minLevel: 1 }]);
  });

  it('resolves range, slow, burn, rock damage, and killstreak rewards', () => {
    const totals = getCoopDefenseResolvedEffectTotals(maxProfile({
      unlock_negev: 1,
      negev_range: 2,
      negev_adrenaline_cost: 3,
      negev_rock_damage: 1,
      negev_hold_speed: 3,
      negev_warmup_duration: 3,
      negev_burning_bullets: 1,
      negev_killstreak: 1,
      negev_killstreak_recovery: 3,
      negev_killstreak_explosion: 1,
    }));
    const resolved = applyCoopDefenseModifiersToWeaponConfig(WEAPON_CONFIGS.NEGEV, 'weapon2', totals);

    expect(resolved.range).toBe(1275);
    expect(resolved.adrenalinCost).toBeCloseTo(0.55);
    expect(resolved.rockDamageMult).toBe(6);
    expect(resolved.holdSpeedFactor).toBeCloseTo(0.615);
    expect(resolved.hitSlowFraction).toBe(0.75);
    expect(resolved.hitSlowDurationMs).toBe(1000);
    expect(resolved.warmupSpeedMultiplier).toBe(4);
    expect(resolved.warmupBurnThreshold).toBe(0.99);
    expect(resolved.burnOnHit).toEqual({ durationMs: 2000, damagePerTick: 0.25 });
    expect(resolved.negevKillstreak).toMatchObject({
      damageBonusPerKill: 0.1,
      healPerKill: 15,
      armorPerKill: 15,
      explosionEnabled: 1,
    });
  });
});

describe('Adrenaline syringe drops', () => {
  it('follows the completed existing adrenaline branches and exposes two follow-ups', () => {
    expect(getCoopDefenseUpgradeDefinition('adrenaline_syringe_drops')?.requires).toEqual([
      { upgradeId: 'adrenaline_spawn_full', minLevel: 1 },
      { upgradeId: 'adrenaline_cost', minLevel: 3 },
    ]);
    expect(getCoopDefenseUpgradeDefinition('adrenaline_syringe_drop_chance')?.maxLevel).toBe(3);
    expect(getCoopDefenseUpgradeDefinition('adrenaline_syringe_duration')?.maxLevel).toBe(3);
  });

  it('normalizes the base chance to two and the maximum chance upgrade to eight expected drops', () => {
    const map = getCoopDefenseMapConfig('1');
    const waves = resolveCoopDefenseMapWaveConfigs(map, 1);
    const mapXp = getCoopDefenseMapScheduledXp(map, waves);
    expect(mapXp).toBe(40);
    expect(getAdrenalineSyringeDropChance(1, mapXp, 1)).toBeCloseTo(0.05);
    expect(40 * getAdrenalineSyringeDropChance(1, mapXp, 1)).toBeCloseTo(2);
    expect(40 * getAdrenalineSyringeDropChance(1, mapXp, 4)).toBeCloseTo(8);
  });
});
