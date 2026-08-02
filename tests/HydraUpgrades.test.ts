import { describe, expect, it } from 'vitest';
import { applyCoopDefenseModifiersToWeaponConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import type { CoopDefenseUpgradeProfile } from '../src/types';
import {
  getCoopDefenseResolvedEffectTotals,
  getCoopDefenseUpgradeDefinition,
} from '../src/utils/coopDefenseUpgrades';

function maxHydraProfile(): CoopDefenseUpgradeProfile {
  const upgradeIds = ['unlock_hydra', 'hydra_range', 'hydra_damage_split'] as const;
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

describe('Hydra Gun coop-defense upgrades', () => {
  it('combines range and projectile speed before the split-power follow-up', () => {
    const range = getCoopDefenseUpgradeDefinition('hydra_range');
    const damageSplit = getCoopDefenseUpgradeDefinition('hydra_damage_split');
    expect(range?.requires).toEqual([{ upgradeId: 'unlock_hydra', minLevel: 1 }]);
    expect(damageSplit?.requires).toEqual([{ upgradeId: 'hydra_range', minLevel: 1 }]);
    expect(range?.effects.map(({ stat, mode }) => ({ stat, mode }))).toEqual([
      { stat: 'weapon.HYDRA.range', mode: 'add_percent_per_level' },
      { stat: 'weapon.HYDRA.projectileSpeed', mode: 'add_percent_per_level' },
    ]);
    expect(damageSplit?.effects.map(({ stat, mode }) => ({ stat, mode }))).toEqual([
      { stat: 'weapon.HYDRA.damage', mode: 'add_percent_per_level' },
      { stat: 'weapon.HYDRA.splitFactor', mode: 'add_percent_per_level' },
    ]);
    for (const effect of [...(range?.effects ?? []), ...(damageSplit?.effects ?? [])]) {
      expect(Number.isFinite(effect.value), effect.stat).toBe(true);
      expect(effect.value, effect.stat).toBeGreaterThan(0);
    }
    expect(getCoopDefenseUpgradeDefinition('hydra_projectile_speed')).toBeNull();
  });

  it('applies each resolved modifier relative to the current base config', () => {
    const totals = getCoopDefenseResolvedEffectTotals(maxHydraProfile());
    const base = WEAPON_CONFIGS.HYDRA;
    const resolved = applyCoopDefenseModifiersToWeaponConfig(base, 'weapon1', totals);

    const scaled = (stat: string, baseValue: number): number => (
      baseValue * (1 + (totals.percentage[stat] ?? 0))
    );
    expect(resolved.range).toBeCloseTo(scaled('weapon.HYDRA.range', base.range));
    expect(resolved.fire.projectileSpeed).toBeCloseTo(
      scaled('weapon.HYDRA.projectileSpeed', base.fire.projectileSpeed),
    );
    expect(resolved.damage).toBeCloseTo(scaled('weapon.HYDRA.damage', base.damage));
    expect(resolved.splitFactor).toBeCloseTo(scaled('weapon.HYDRA.splitFactor', base.splitFactor));
  });
});
