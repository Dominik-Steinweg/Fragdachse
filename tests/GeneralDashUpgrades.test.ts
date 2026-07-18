import { describe, expect, it } from 'vitest';
import { getDashBurstTiming } from '../src/utils/dashTiming';
import {
  getCoopDefenseResolvedEffectTotals,
  getCoopDefenseUpgradeDefinition,
} from '../src/utils/coopDefenseUpgrades';

describe('general Dash upgrades', () => {
  it('forms the range, recovery, impact, two branches, and overdrive chain', () => {
    expect(getCoopDefenseUpgradeDefinition('dash_range')).toMatchObject({ maxLevel: 3, requires: [] });
    expect(getCoopDefenseUpgradeDefinition('dash_recovery')).toMatchObject({
      maxLevel: 3,
      requires: [{ upgradeId: 'dash_range', minLevel: 3 }],
    });
    expect(getCoopDefenseUpgradeDefinition('dash_impact')).toMatchObject({
      maxLevel: 1,
      costPerLevel: 0,
      bossPointCostPerLevel: 1,
      requires: [{ upgradeId: 'dash_recovery', minLevel: 3 }],
    });
    expect(getCoopDefenseUpgradeDefinition('dash_fire_trail')).toMatchObject({
      maxLevel: 3,
      requires: [{ upgradeId: 'dash_impact', minLevel: 1 }],
    });
    expect(getCoopDefenseUpgradeDefinition('dash_impact_damage')).toMatchObject({
      maxLevel: 3,
      requires: [{ upgradeId: 'dash_impact', minLevel: 1 }],
    });
    expect(getCoopDefenseUpgradeDefinition('dash_overdrive')).toMatchObject({
      maxLevel: 1,
      costPerLevel: 0,
      bossPointCostPerLevel: 1,
      requires: [
        { upgradeId: 'dash_fire_trail', minLevel: 3 },
        { upgradeId: 'dash_impact_damage', minLevel: 3 },
      ],
    });
  });

  it('resolves the complete branch effects', () => {
    const totals = getCoopDefenseResolvedEffectTotals({
      upgrades: {
        dash_range: { unlocked: true, level: 3 },
        dash_recovery: { unlocked: true, level: 3 },
        dash_impact: { unlocked: true, level: 1 },
        dash_fire_trail: { unlocked: true, level: 3 },
        dash_impact_damage: { unlocked: true, level: 3 },
        dash_overdrive: { unlocked: true, level: 1 },
      },
    });

    expect(totals.percentage['player.dashRange']).toBeCloseTo(0.3);
    expect(totals.percentage['player.dashRecovery']).toBeCloseTo(-0.6);
    expect(totals.additive['player.dashImpactDamage']).toBe(30);
    expect(totals.percentage['player.dashImpactDamage']).toBeCloseTo(0.75);
    expect(totals.additive['player.dashGroundFireDurationMs']).toBe(3000);
    expect(totals.additive['player.dashHoldEnabled']).toBe(1);
  });

  it('ends normally unless holding is unlocked and caps at twice the duration', () => {
    expect(getDashBurstTiming(0.5, 0.5, false, true, 2)).toEqual({ progress: 1, shouldEnd: true });
    expect(getDashBurstTiming(0.75, 0.5, true, true, 2)).toEqual({ progress: 0.75, shouldEnd: false });
    expect(getDashBurstTiming(0.75, 0.5, true, false, 2)).toEqual({ progress: 1, shouldEnd: true });
    expect(getDashBurstTiming(1, 0.5, true, true, 2)).toEqual({ progress: 1, shouldEnd: true });
  });
});
