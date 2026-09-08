import { describe, expect, it } from 'vitest';
import { fullSmokeLevels, resolvedSmoke } from '../SmokeTestHelper';
import { UTILITY_CONFIGS } from '../../src/loadout/LoadoutConfig';
import { getCoopDefenseUpgradeDefinition } from '../../src/utils/coopDefenseUpgrades';

describe('smoke authored progression envelope', () => {
  it('scales only the intended phases and increases control and bounded combo capacity at each level', () => {
    const base = UTILITY_CONFIGS.SMOKE_GRENADE;
    if (base.type !== 'smoke') throw Error('Expected smoke');
    let previous = resolvedSmoke({ unlock_smoke_grenade: 1 });
    for (let level = 1; level <= getCoopDefenseUpgradeDefinition('smoke_grenade_radius')!.maxLevel; level++) {
      const current = resolvedSmoke({ ...fullSmokeLevels, smoke_grenade_radius: level, smoke_grenade_duration: level,
        smoke_grenade_disorientation: level, smoke_grenade_discharge: level, smoke_grenade_growth: level });
      expect(current.smokeRadius).toBeGreaterThan(previous.smokeRadius);
      expect(current.smokeLingerDuration).toBeGreaterThan(previous.smokeLingerDuration);
      expect(current.smokeBehavior.confusionFraction).toBeGreaterThan(previous.smokeBehavior.confusionFraction);
      expect(current.smokeBehavior.aftereffectMs).toBeGreaterThan(previous.smokeBehavior.aftereffectMs);
      expect(current.smokeBehavior.dischargeCount).toBeGreaterThan(previous.smokeBehavior.dischargeCount);
      expect(current.smokeBehavior.growthMaxProcs).toBeGreaterThan(previous.smokeBehavior.growthMaxProcs);
      expect(current.smokeExpandDuration).toBe(base.smokeExpandDuration);
      expect(current.smokeDissipateDuration).toBe(base.smokeDissipateDuration);
      expect(current.cooldown).toBe(base.cooldown);
      previous = current;
    }
    const maximumRadius = previous.smokeRadius * (1 + previous.smokeBehavior.growthMaxProcs * previous.smokeBehavior.growthRadiusFraction);
    const maximumDuration = previous.smokeExpandDuration + previous.smokeLingerDuration + previous.smokeBehavior.growthMaxProcs * previous.smokeBehavior.growthDurationMs;
    expect(maximumRadius).toBeGreaterThan(previous.smokeRadius);
    expect(Number.isFinite(maximumRadius * maximumDuration)).toBe(true);
    expect(previous.smokeBehavior.dischargeHoming.acquireDelayMs).toBeLessThan(previous.smokeBehavior.dischargeRange / previous.smokeBehavior.dischargeSpeed * 1000);
  });
});
