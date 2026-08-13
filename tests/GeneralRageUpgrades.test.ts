import { describe, expect, it } from 'vitest';
import { getRageGeneratingDamage } from '../src/utils/rageDamage';
import {
  getCoopDefenseResolvedEffectTotals,
  getCoopDefenseUpgradeDefinition,
} from '../src/utils/coopDefenseUpgrades';

describe('general Rage upgrades', () => {
  it('forms the Rage gain, maximum Rage, and armored Rage chain', () => {
    expect(getCoopDefenseUpgradeDefinition('ultimate_rage_gain')?.requires).toEqual([]);
    expect(getCoopDefenseUpgradeDefinition('ultimate_max_rage')?.requires).toEqual([
      { upgradeId: 'ultimate_rage_gain', minLevel: 1 },
    ]);
    expect(getCoopDefenseUpgradeDefinition('ultimate_armor_rage')).toMatchObject({
      maxLevel: 1,
      requires: [{ upgradeId: 'ultimate_max_rage', minLevel: 1 }],
    });

    const totals = getCoopDefenseResolvedEffectTotals({
      upgrades: {
        ultimate_rage_gain: { unlocked: true, level: 3 },
        ultimate_max_rage: { unlocked: true, level: 3 },
        ultimate_armor_rage: { unlocked: true, level: 1 },
      },
    });
    const rageUpgrade = getCoopDefenseUpgradeDefinition('ultimate_armor_rage')!;
    const rageEffect = rageUpgrade.effects.find(
      (effect) => effect.stat === 'ultimate.rageGainFromArmorDamage',
    );
    expect(rageEffect?.value).toBeGreaterThan(0);
    expect(totals.additive['ultimate.rageGainFromArmorDamage']).toBeCloseTo(
      (rageEffect?.value ?? 0) * rageUpgrade.maxLevel,
    );
  });

  it('grants Rage for absorbed Armor damage only when enabled', () => {
    expect(getRageGeneratingDamage(0, 5, false)).toBe(0);
    expect(getRageGeneratingDamage(0, 5, true)).toBe(5);
    expect(getRageGeneratingDamage(3, 5, true)).toBe(8);
  });
});
