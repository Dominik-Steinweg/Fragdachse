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
    const chance = getCoopDefenseUpgradeDefinition('critical_chance');
    const damage = getCoopDefenseUpgradeDefinition('critical_damage');
    expect(chance).toMatchObject({ maxLevel: expect.any(Number), requires: [] });
    expect(damage).toMatchObject({
      maxLevel: expect.any(Number),
      requires: [{ upgradeId: 'critical_chance', minLevel: 1 }],
    });
    expect(chance?.effects).toEqual([
      expect.objectContaining({ stat: 'player.criticalChance', mode: 'add_per_level' }),
    ]);
    expect(damage?.effects).toEqual([
      expect.objectContaining({ stat: 'player.criticalDamage', mode: 'add_per_level' }),
    ]);
    expect(chance?.effects[0]?.value).toBeGreaterThan(0);
    expect(damage?.effects[0]?.value).toBeGreaterThan(0);
  });

  it('resolves the complete three-level effects', () => {
    const totals = getCoopDefenseResolvedEffectTotals({
      upgrades: {
        critical_chance: { unlocked: true, level: 3 },
        critical_damage: { unlocked: true, level: 3 },
      },
    });

    const chance = getCoopDefenseUpgradeDefinition('critical_chance')!;
    const damage = getCoopDefenseUpgradeDefinition('critical_damage')!;
    expect(totals.additive['player.criticalChance']).toBeCloseTo(
      chance.effects[0].value * chance.maxLevel,
    );
    expect(totals.additive['player.criticalDamage']).toBeCloseTo(
      damage.effects[0].value * damage.maxLevel,
    );
  });

  it('does not allow critical damage before the first chance level', () => {
    const base = buildDefaultCoopDefenseUpgradeProfile();
    expect(canLevelUpCoopDefenseUpgrade(base, 'critical_damage', 20)).toBe(false);

    const withChance = levelUpCoopDefenseUpgrade(base, 'critical_chance', 20)!;
    expect(canLevelUpCoopDefenseUpgrade(withChance, 'critical_damage', 20)).toBe(true);
  });
});
