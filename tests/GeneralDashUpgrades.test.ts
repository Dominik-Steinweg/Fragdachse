import { describe, expect, it } from 'vitest';
import { getDashBurstTiming, getPlayerDashBurstSpeedFactor } from '../src/utils/dashTiming';
import { BURROW_DASH_IMPULSE_MULTIPLIER, DASH_F_MIN, DASH_T1_S, DASH_T2_S, ENEMY_DASH_F_START } from '../src/config';
import {
  getCoopDefenseResolvedEffectTotals,
  getCoopDefenseUpgradeDefinition,
} from '../src/utils/coopDefenseUpgrades';

describe('general Dash upgrades', () => {
  it('front-loads player movement while keeping the complete base cycle distance-neutral', () => {
    // Numerical quadrature checks the actual public curve rather than repeating its coefficient formula.
    const steps = 4000;
    let burstDistance = 0;
    let recoveryDistance = 0;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      burstDistance += getPlayerDashBurstSpeedFactor(t) * DASH_T1_S / steps;
      recoveryDistance += (DASH_F_MIN + (1 - DASH_F_MIN) * t * t) * DASH_T2_S / steps;
    }
    expect(burstDistance + recoveryDistance).toBeCloseTo(DASH_T1_S + DASH_T2_S, 6);
    expect(getPlayerDashBurstSpeedFactor(0)).toBeGreaterThan(ENEMY_DASH_F_START);
    expect(getPlayerDashBurstSpeedFactor(1)).toBe(DASH_F_MIN);
  });

  it('amplifies only the Burrow impulse and converges continuously to ordinary recovery', () => {
    const boost = BURROW_DASH_IMPULSE_MULTIPLIER;
    expect(boost).toBeGreaterThan(1);
    for (const t of [0, 0.25, 0.5, 0.75]) {
      expect(getPlayerDashBurstSpeedFactor(t, boost)).toBeGreaterThan(getPlayerDashBurstSpeedFactor(t));
    }
    expect(getPlayerDashBurstSpeedFactor(1, boost)).toBe(getPlayerDashBurstSpeedFactor(1));
    expect(getPlayerDashBurstSpeedFactor(2, boost)).toBe(DASH_F_MIN);
  });

  it('forms the range, recovery, impact, two branches, and overdrive chain', () => {
    expect(getCoopDefenseUpgradeDefinition('dash_range')).toMatchObject({
      maxLevel: expect.any(Number),
      requires: [],
    });
    expect(getCoopDefenseUpgradeDefinition('dash_recovery')).toMatchObject({
      maxLevel: expect.any(Number),
      requires: [{ upgradeId: 'dash_range', minLevel: 1 }],
    });
    expect(getCoopDefenseUpgradeDefinition('dash_impact')).toMatchObject({
      maxLevel: expect.any(Number),
      requires: [{ upgradeId: 'dash_recovery', minLevel: 1 }],
    });
    expect(getCoopDefenseUpgradeDefinition('dash_fire_trail')).toMatchObject({
      maxLevel: expect.any(Number),
      requires: [{ upgradeId: 'dash_impact', minLevel: 1 }],
    });
    expect(getCoopDefenseUpgradeDefinition('dash_impact_damage')).toMatchObject({
      maxLevel: expect.any(Number),
      requires: [{ upgradeId: 'dash_impact', minLevel: 1 }],
    });
    expect(getCoopDefenseUpgradeDefinition('dash_overdrive')).toMatchObject({
      maxLevel: expect.any(Number),
      requires: [
        { upgradeId: 'dash_fire_trail', minLevel: 1 },
        { upgradeId: 'dash_impact_damage', minLevel: 1 },
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

    for (const stat of [
      'player.dashRange',
      'player.dashRecovery',
      'player.dashImpactDamage',
      'player.dashGroundFireDurationMs',
      'player.dashHoldEnabled',
    ]) {
      expect(
        totals.additive[stat] ?? totals.percentage[stat],
        stat,
      ).toEqual(expect.any(Number));
    }
    expect(totals.percentage['player.dashImpactDamage']).toEqual(expect.any(Number));
  });

  it('ends normally unless holding is unlocked and caps at twice the duration', () => {
    expect(getDashBurstTiming(0.5, 0.5, false, true, 2)).toEqual({ progress: 1, shouldEnd: true });
    expect(getDashBurstTiming(0.75, 0.5, true, true, 2)).toEqual({ progress: 0.75, shouldEnd: false });
    expect(getDashBurstTiming(0.75, 0.5, true, false, 2)).toEqual({ progress: 1, shouldEnd: true });
    expect(getDashBurstTiming(1, 0.5, true, true, 2)).toEqual({ progress: 1, shouldEnd: true });
  });
});
