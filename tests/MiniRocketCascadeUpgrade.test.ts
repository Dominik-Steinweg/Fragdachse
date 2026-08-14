import { describe, expect, it } from 'vitest';
import { applyCoopDefenseModifiersToWeaponConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import type { CoopDefenseUpgradeProfile } from '../src/types';
import {
  getCoopDefenseResolvedEffectTotals,
  getCoopDefenseUpgradeDefinition,
} from '../src/utils/coopDefenseUpgrades';
import { getMiniRocketCascadeMultiplier } from '../src/utils/miniRocketCascade';
import { getUpgradeDescription } from '../src/i18n/upgradePresentation';

function maxProfile(upgradeIds: readonly string[]): CoopDefenseUpgradeProfile {
  return {
    upgrades: Object.fromEntries(upgradeIds.map((id) => [
      id,
      { unlocked: true, level: getCoopDefenseUpgradeDefinition(id)?.maxLevel ?? 1 },
    ])),
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
    expect(getUpgradeDescription('mini_rocket_cascade_charge', 'de')).toContain('erste Explosion erhält keinen Bonus');
    expect(definition?.effects.map(({ stat, mode }) => ({ stat, mode }))).toEqual([{
      stat: 'weapon.MINI_ROCKET_LAUNCHER.miniRocketCascadeDamageBonusPerExplosion',
      mode: 'add_per_level',
    }]);
    expect(definition?.effects[0]?.value).toBeGreaterThan(0);

    const totals = getCoopDefenseResolvedEffectTotals(maxProfile([
      'unlock_mini_rocket_launcher',
      'mini_rocket_long_range_drive',
      'mini_rocket_triple_detonation',
      'mini_rocket_cascade_charge',
    ]));
    const base = WEAPON_CONFIGS.MINI_ROCKET_LAUNCHER;
    const resolved = applyCoopDefenseModifiersToWeaponConfig(
      base,
      'weapon2',
      totals,
    );

    expect(resolved.miniRocketCascadeDamageBonusPerExplosion).toBeCloseTo(
      base.miniRocketCascadeDamageBonusPerExplosion
      + (totals.additive['weapon.MINI_ROCKET_LAUNCHER.miniRocketCascadeDamageBonusPerExplosion'] ?? 0),
    );
    expect(resolved.fire.impactExplosion.radius).toBe(base.fire.impactExplosion.radius);
  });
});
