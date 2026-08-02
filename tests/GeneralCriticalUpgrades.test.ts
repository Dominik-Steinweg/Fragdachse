import { describe, expect, it } from 'vitest';
import {
  buildDefaultCoopDefenseUpgradeProfile,
  canLevelUpCoopDefenseUpgrade,
  getCoopDefenseResolvedEffectTotals,
  getCoopDefenseUpgradeDefinition,
  levelUpCoopDefenseUpgrade,
} from '../src/utils/coopDefenseUpgrades';

describe('general critical upgrades', () => {
  it('adds critical chance and gates critical damage behind it', () => {
    expect(getCoopDefenseUpgradeDefinition('critical_chance')).toMatchObject({
      maxLevel: 3,
      requires: [],
      effects: [{ stat: 'player.criticalChance', mode: 'add_per_level', value: 0.05 }],
    });
    expect(getCoopDefenseUpgradeDefinition('critical_damage')).toMatchObject({
      maxLevel: 3,
      requires: [{ upgradeId: 'critical_chance', minLevel: 1 }],
      effects: [{ stat: 'player.criticalDamage', mode: 'add_per_level', value: 0.2 }],
    });
  });

  it('resolves the complete three-level effects', () => {
    const totals = getCoopDefenseResolvedEffectTotals({
      upgrades: {
        critical_chance: { unlocked: true, level: 3 },
        critical_damage: { unlocked: true, level: 3 },
      },
    });

    expect(totals.additive['player.criticalChance']).toBeCloseTo(0.15);
    expect(totals.additive['player.criticalDamage']).toBeCloseTo(0.6);
  });

  it('does not allow critical damage before the first chance level', () => {
    const base = buildDefaultCoopDefenseUpgradeProfile();
    expect(canLevelUpCoopDefenseUpgrade(base, 'critical_damage', 20)).toBe(false);

    const withChance = levelUpCoopDefenseUpgrade(base, 'critical_chance', 20)!;
    expect(canLevelUpCoopDefenseUpgrade(withChance, 'critical_damage', 20)).toBe(true);
  });
});
