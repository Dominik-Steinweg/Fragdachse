import { describe, expect, it } from 'vitest';
import { applyCoopDefenseModifiersToWeaponConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import type { CoopDefenseUpgradeProfile } from '../src/types';
import {
  getCoopDefenseResolvedEffectTotals,
  getCoopDefenseUpgradeDefinition,
} from '../src/utils/coopDefenseUpgrades';
import { getMiniRocketCascadeMultiplier } from '../src/utils/miniRocketCascade';

function profile(levels: Record<string, number>): CoopDefenseUpgradeProfile {
  return {
    upgrades: Object.fromEntries(
      Object.entries(levels).map(([id, level]) => [id, { unlocked: true, level }]),
    ),
  };
}

describe('mini-rocket cascade charge', () => {
  it('applies the bonus only after the first explosion and stacks per explosion', () => {
    expect(getMiniRocketCascadeMultiplier(0, 0.1)).toBe(1);
    expect(getMiniRocketCascadeMultiplier(1, 0.1)).toBeCloseTo(1.1);
    expect(getMiniRocketCascadeMultiplier(2, 0.1)).toBeCloseTo(1.2);
  });

  it('wires the upgrade into the per-explosion cascade stat instead of static radius', () => {
    const definition = getCoopDefenseUpgradeDefinition('mini_rocket_cascade_charge');
    expect(definition?.description).toContain('erste Explosion erhaelt keinen Bonus');
    expect(definition?.effects).toEqual([
      {
        stat: 'weapon.MINI_ROCKET_LAUNCHER.miniRocketCascadeDamageBonusPerExplosion',
        mode: 'add_per_level',
        value: 0.1,
      },
    ]);

    const totals = getCoopDefenseResolvedEffectTotals(profile({
      unlock_mini_rocket_launcher: 1,
      mini_rocket_long_range_drive: 1,
      mini_rocket_triple_detonation: 1,
      mini_rocket_cascade_charge: 3,
    }));
    const resolved = applyCoopDefenseModifiersToWeaponConfig(
      WEAPON_CONFIGS.MINI_ROCKET_LAUNCHER,
      'weapon2',
      totals,
    );

    expect(resolved.miniRocketCascadeDamageBonusPerExplosion).toBeCloseTo(0.3);
    expect(resolved.fire.impactExplosion.radius).toBe(65);
  });
});
