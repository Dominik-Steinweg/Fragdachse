import { describe, expect, it } from 'vitest';
import { applyCoopDefenseModifiersToWeaponConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import type { CoopDefenseUpgradeProfile } from '../src/types';
import {
  getCoopDefenseResolvedEffectTotals,
  getCoopDefenseUpgradeDefinition,
} from '../src/utils/coopDefenseUpgrades';

function maxHydraProfile(): CoopDefenseUpgradeProfile {
  return {
    upgrades: {
      unlock_hydra: { unlocked: true, level: 1 },
      hydra_range: { unlocked: true, level: 3 },
      hydra_damage_split: { unlocked: true, level: 3 },
    },
  };
}

describe('Hydra Gun coop-defense upgrades', () => {
  it('combines range and projectile speed before the split-power follow-up', () => {
    expect(getCoopDefenseUpgradeDefinition('hydra_range')).toMatchObject({
      maxLevel: 3,
      requires: [{ upgradeId: 'unlock_hydra', minLevel: 1 }],
      effects: [
        { stat: 'weapon.HYDRA.range', mode: 'add_percent_per_level', value: 0.2 },
        { stat: 'weapon.HYDRA.projectileSpeed', mode: 'add_percent_per_level', value: 0.1 },
      ],
    });
    expect(getCoopDefenseUpgradeDefinition('hydra_damage_split')).toMatchObject({
      maxLevel: 3,
      requires: [{ upgradeId: 'hydra_range', minLevel: 1 }],
      effects: [
        { stat: 'weapon.HYDRA.damage', mode: 'add_percent_per_level', value: 0.3 },
        { stat: 'weapon.HYDRA.splitFactor', mode: 'add_percent_per_level', value: 0.1 },
      ],
    });
    expect(getCoopDefenseUpgradeDefinition('hydra_projectile_speed')).toBeNull();
  });

  it('resolves the maximum range, speed, initial damage, and split retention values', () => {
    const totals = getCoopDefenseResolvedEffectTotals(maxHydraProfile());
    const resolved = applyCoopDefenseModifiersToWeaponConfig(WEAPON_CONFIGS.HYDRA, 'weapon1', totals);

    expect(resolved.range).toBeCloseTo(1600);
    expect(resolved.fire.projectileSpeed).toBeCloseTo(390);
    expect(resolved.damage).toBeCloseTo(22.8);
    expect(resolved.splitFactor).toBeCloseTo(1.95);
  });
});
