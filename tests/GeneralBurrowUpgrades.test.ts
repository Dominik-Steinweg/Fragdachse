import { describe, expect, it } from 'vitest';
import { getCoopDefenseUpgradeDefinition as definition, getCoopDefenseResolvedEffectTotals,
  getAvailableCoopDefenseUpgradePoints, sanitizeCoopDefenseUpgradeProfile,
  isCoopDefenseUpgradeAvailableForClass } from '../src/utils/coopDefenseUpgrades';

describe('general burrow progression', () => {
  it('has an efficiency root, parallel successors and a boss requiring both successors', () => {
    expect(definition('burrow_cost')!.requires).toEqual([]);
    for (const id of ['burrow_speed', 'unburrow_shockwave'])
      expect(definition(id)!.requires).toEqual([{ upgradeId: 'burrow_cost', minLevel: 1 }]);
    expect(definition('burrow_earthbreak')).toMatchObject({ costPerLevel: 0, bossPointCostPerLevel: 1,
      requires: [{ upgradeId: 'burrow_speed', minLevel: 1 }, { upgradeId: 'unburrow_shockwave', minLevel: 1 }] });
    for (const missing of ['burrow_speed', 'unburrow_shockwave']) {
      const upgrades = Object.fromEntries(['burrow_cost', 'burrow_speed', 'unburrow_shockwave', 'burrow_earthbreak']
        .filter(id => id !== missing).map(id => [id, { level: 1 }]));
      expect(sanitizeCoopDefenseUpgradeProfile({ upgrades }).upgrades.burrow_earthbreak.level).toBe(0);
    }
  });

  it('resolves both efficiency effects from their authored values at each purchased level', () => {
    const config = definition('burrow_cost')!;
    for (let level = 1; level <= config.maxLevel; level++) {
      const totals = getCoopDefenseResolvedEffectTotals({ upgrades: { burrow_cost: { unlocked: true, level } } });
      for (const effect of config.effects) expect(totals.percentage[effect.stat]).toBeCloseTo(effect.value * level);
    }
    expect(config.effects.map(e => e.stat)).toEqual(['player.burrowCost', 'player.burrowTrainDamage']);
  });

  it('retains Gadachs speed restrictions while opening efficiency and shockwave', () => {
    for (const id of ['burrow_cost', 'unburrow_shockwave']) expect(isCoopDefenseUpgradeAvailableForClass(id, 'inspector_gadachs')).toBe(true);
    for (const id of ['burrow_speed', 'burrow_earthbreak']) expect(isCoopDefenseUpgradeAvailableForClass(id, 'inspector_gadachs')).toBe(false);
  });

  it('returns points from old speed-only builds through ordinary sanitization', () => {
    const old = { upgrades: { burrow_speed: { unlocked: true, level: 2 } } };
    expect(sanitizeCoopDefenseUpgradeProfile(old).upgrades.burrow_speed.level).toBe(0);
    expect(getAvailableCoopDefenseUpgradePoints(3, old)).toBe(2);
    const valid = { upgrades: { ...old.upgrades, burrow_cost: { unlocked: true, level: 1 } } };
    expect(sanitizeCoopDefenseUpgradeProfile(valid).upgrades.burrow_speed.level).toBe(2);
  });
});
