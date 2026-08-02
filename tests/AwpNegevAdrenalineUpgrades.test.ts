import { describe, expect, it } from 'vitest';
import { applyCoopDefenseModifiersToWeaponConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { getAdrenalineSyringeDropChance } from '../src/utils/adrenalineDrops';
import type { CoopDefenseUpgradeProfile } from '../src/types';
import {
  getCoopDefenseResolvedEffectTotals,
  getCoopDefenseUpgradeDefinition,
} from '../src/utils/coopDefenseUpgrades';

function maxProfile(upgradeIds: readonly string[]): CoopDefenseUpgradeProfile {
  return {
    upgrades: Object.fromEntries(upgradeIds.map((id) => [
      id,
      { unlocked: true, level: getCoopDefenseUpgradeDefinition(id)?.maxLevel ?? 1 },
    ])),
  };
}

function scaled(
  totals: ReturnType<typeof getCoopDefenseResolvedEffectTotals>,
  stat: string,
  baseValue: number,
): number {
  return (baseValue + (totals.additive[stat] ?? 0)) * (1 + (totals.percentage[stat] ?? 0));
}

function inverseScaled(
  totals: ReturnType<typeof getCoopDefenseResolvedEffectTotals>,
  stat: string,
  baseValue: number,
): number {
  return (baseValue + (totals.additive[stat] ?? 0)) / (1 + (totals.percentage[stat] ?? 0));
}

describe('AWP coop-defense upgrades', () => {
  it('merges the left and right branches into the second boss upgrade', () => {
    expect(getCoopDefenseUpgradeDefinition('awp_adrenaline_cost')?.requires)
      .toEqual([{ upgradeId: 'unlock_awp', minLevel: 1 }]);
    expect(getCoopDefenseUpgradeDefinition('awp_aim_duration')?.requires)
      .toEqual([{ upgradeId: 'awp_adrenaline_cost', minLevel: 1 }]);
    expect(getCoopDefenseUpgradeDefinition('awp_moving_precision')?.requires)
      .toEqual([{ upgradeId: 'awp_aim_duration', minLevel: 1 }]);
    expect(getCoopDefenseUpgradeDefinition('awp_destruction_corridor')?.requires).toEqual([
      { upgradeId: 'awp_moving_precision', minLevel: 1 },
      { upgradeId: 'awp_fire_trail', minLevel: 1 },
    ]);
  });

  it('resolves the fully upgraded charge, mobility, and penetration values', () => {
    const totals = getCoopDefenseResolvedEffectTotals(maxProfile([
      'unlock_awp',
      'awp_adrenaline_cost',
      'awp_aim_duration',
      'awp_moving_precision',
      'awp_charge_damage',
      'awp_penetrating_shot',
      'awp_fire_trail',
      'awp_destruction_corridor',
      'awp_full_charge_time',
      'awp_full_charge_damage',
    ]));
    const base = WEAPON_CONFIGS.AWP;
    const resolved = applyCoopDefenseModifiersToWeaponConfig(base, 'weapon2', totals);

    expect(resolved.adrenalinCost).toBeCloseTo(scaled(totals, 'weapon.AWP.adrenalinCost', base.adrenalinCost));
    expect(resolved.cooldown).toBeCloseTo(scaled(totals, 'weapon.AWP.cooldown', base.cooldown));
    expect(resolved.spreadMoving).toBeCloseTo(scaled(totals, 'weapon.AWP.spreadMoving', base.spreadMoving));
    expect(resolved.scopeConfig?.scopeInMs).toBeCloseTo(
      scaled(totals, 'weapon.AWP.aimDuration', base.scopeConfig?.scopeInMs ?? 0),
    );
    expect(resolved.scopeConfig?.fullScopeViewRadius).toBeCloseTo(
      scaled(totals, 'weapon.AWP.scopeViewRadius', base.scopeConfig?.fullScopeViewRadius ?? 0),
    );
    expect(resolved.penetrationCount).toBe(
      scaled(totals, 'weapon.AWP.penetrationCount', base.penetrationCount ?? 0),
    );
    expect(resolved.penetrationDamageRetention).toBe(
      scaled(totals, 'weapon.AWP.penetrationDamageRetention', base.penetrationDamageRetention ?? 0),
    );
    expect(resolved.penetratesRocks).toBe(
      scaled(totals, 'weapon.AWP.penetratesRocks', base.penetratesRocks ?? 0),
    );
    expect(resolved.awpCharge?.maxDamageBonus).toBe(
      scaled(totals, 'weapon.AWP.awpCharge.maxDamageBonus', base.awpCharge?.maxDamageBonus ?? 0),
    );
    expect(resolved.awpCharge?.fireTrailDurationMs).toBe(
      scaled(totals, 'weapon.AWP.awpCharge.fireTrailDurationMs', base.awpCharge?.fireTrailDurationMs ?? 0),
    );
    expect(resolved.awpCharge?.fireTrailHalfWidthCells).toBe(
      scaled(totals, 'weapon.AWP.awpCharge.fireTrailHalfWidthCells', base.awpCharge?.fireTrailHalfWidthCells ?? 0),
    );
    expect(resolved.awpCharge?.corridorEnabled).toBe(
      scaled(totals, 'weapon.AWP.awpCharge.corridorEnabled', base.awpCharge?.corridorEnabled ?? 0),
    );
    expect(resolved.awpCharge?.durationMs).toBeCloseTo(
      scaled(totals, 'weapon.AWP.awpCharge.durationMs', base.awpCharge?.durationMs ?? 0),
    );
    expect(resolved.awpCharge?.fullChargeDamageBonus).toBe(
      scaled(totals, 'weapon.AWP.awpCharge.fullChargeDamageBonus', base.awpCharge?.fullChargeDamageBonus ?? 0),
    );
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
    const totals = getCoopDefenseResolvedEffectTotals(maxProfile([
      'unlock_negev',
      'negev_range',
      'negev_adrenaline_cost',
      'negev_rock_damage',
      'negev_hold_speed',
      'negev_warmup_duration',
      'negev_burning_bullets',
      'negev_killstreak',
      'negev_killstreak_recovery',
      'negev_killstreak_explosion',
    ]));
    const base = WEAPON_CONFIGS.NEGEV;
    const resolved = applyCoopDefenseModifiersToWeaponConfig(base, 'weapon2', totals);

    expect(resolved.range).toBeCloseTo(scaled(totals, 'weapon.NEGEV.range', base.range));
    expect(resolved.adrenalinCost).toBeCloseTo(scaled(totals, 'weapon.NEGEV.adrenalinCost', base.adrenalinCost));
    expect(resolved.rockDamageMult).toBeCloseTo(scaled(totals, 'weapon.NEGEV.rockDamageMult', base.rockDamageMult));
    expect(resolved.holdSpeedFactor).toBe(
      base.holdSpeedFactor + (totals.additive['weapon.NEGEV.holdSpeedBonus'] ?? 0),
    );
    expect(resolved.hitSlowFraction).toBe(
      base.hitSlowFraction + (totals.additive['weapon.NEGEV.hitSlowFraction'] ?? 0),
    );
    expect(resolved.hitSlowDurationMs).toBe(
      base.hitSlowDurationMs + (totals.additive['weapon.NEGEV.hitSlowDurationMs'] ?? 0),
    );
    expect(resolved.warmupSpeedMultiplier).toBeCloseTo(
      inverseScaled(totals, 'weapon.NEGEV.warmupDuration', base.warmupSpeedMultiplier),
    );
    expect(resolved.warmupBurnThreshold).toBe(
      base.warmupBurnThreshold + (totals.additive['weapon.NEGEV.warmupBurnThreshold'] ?? 0),
    );
    expect(resolved.burnOnHit?.durationMs).toBe(
      (base.burnOnHit?.durationMs ?? 0) + (totals.additive['weapon.NEGEV.burnOnHit.durationMs'] ?? 0),
    );
    expect(resolved.burnOnHit?.damagePerTick).toBeCloseTo(
      scaled(totals, 'weapon.NEGEV.burnOnHit.damagePerTick', base.burnOnHit?.damagePerTick ?? 0),
    );
    expect(resolved.negevKillstreak?.damageBonusPerKill).toBe(
      (base.negevKillstreak?.damageBonusPerKill ?? 0)
      + (totals.additive['weapon.NEGEV.negevKillstreak.damageBonusPerKill'] ?? 0),
    );
    expect(resolved.negevKillstreak?.healPerKill).toBe(
      (base.negevKillstreak?.healPerKill ?? 0)
      + (totals.additive['weapon.NEGEV.negevKillstreak.healPerKill'] ?? 0),
    );
    expect(resolved.negevKillstreak?.armorPerKill).toBe(
      (base.negevKillstreak?.armorPerKill ?? 0)
      + (totals.additive['weapon.NEGEV.negevKillstreak.armorPerKill'] ?? 0),
    );
    expect(resolved.negevKillstreak?.explosionEnabled).toBeGreaterThan(0);
  });
});

describe('Adrenaline syringe drops', () => {
  it('follows the completed existing adrenaline branches and exposes two follow-ups', () => {
    expect(getCoopDefenseUpgradeDefinition('adrenaline_syringe_drops')?.requires).toEqual([
      { upgradeId: 'adrenaline_spawn_full', minLevel: 1 },
      { upgradeId: 'adrenaline_cost', minLevel: 1 },
    ]);
    expect(getCoopDefenseUpgradeDefinition('adrenaline_syringe_drop_chance')?.maxLevel).toBeGreaterThan(0);
    expect(getCoopDefenseUpgradeDefinition('adrenaline_syringe_duration')?.maxLevel).toBeGreaterThan(0);
  });

  it('scales the drop chance from synthetic XP values and clamps it', () => {
    const enemyXp = 7;
    const mapXp = 140;
    const baseChance = getAdrenalineSyringeDropChance(enemyXp, mapXp, 1);
    expect(baseChance).toBeCloseTo((enemyXp * 2) / mapXp);
    expect(getAdrenalineSyringeDropChance(enemyXp, mapXp, 4)).toBeCloseTo(baseChance * 4);
    expect(getAdrenalineSyringeDropChance(enemyXp, mapXp, Number.POSITIVE_INFINITY)).toBe(1);
  });
});
