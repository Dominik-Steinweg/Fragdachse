import { describe, expect, it } from 'vitest';
import { fullSmokeLevels, resolvedSmoke, smokeHarness, smokeEffect, smokeSource, smokeTarget } from '../SmokeTestHelper';
import { UTILITY_CONFIGS } from '../../src/loadout/LoadoutConfig';
import { getCoopDefenseUpgradeDefinition } from '../../src/utils/coopDefenseUpgrades';
import { getCoopDefenseResolvedEffectTotals } from '../../src/utils/coopDefenseUpgrades';

describe('smoke authored progression envelope', () => {
  it('scales only the intended phases and increases control and bounded combo capacity at each level', () => {
    const base = UTILITY_CONFIGS.SMOKE_GRENADE;
    if (base.type !== 'smoke') throw Error('Expected smoke');
    let previous = resolvedSmoke({ unlock_smoke_grenade: 1 });
    expect(previous.smokeRadius).toBe(base.smokeRadius);
    expect(previous.smokeMaxAlpha).toBe(base.smokeMaxAlpha);
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
  it('resolves L1 from authored radius and keeps BL2 proportional to the thrown radius', () => {
    const base = UTILITY_CONFIGS.SMOKE_GRENADE;
    if (base.type !== 'smoke') throw Error('Expected smoke');
    const upgrades = Object.fromEntries(Object.entries(fullSmokeLevels).map(([id, level]) => [id, { unlocked: true, level }]));
    const totals = getCoopDefenseResolvedEffectTotals({ upgrades }, 'dachs_nukem');
    const full = resolvedSmoke();
    expect(full.smokeRadius).toBeCloseTo(base.smokeRadius * (1 + totals.percentage['utility.SMOKE_GRENADE.smokeRadius']));
    for (const radius of [full.smokeRadius, full.smokeRadius * 0.6]) {
      const { runtime, charge } = smokeHarness();
      const effect = smokeEffect(full.smokeBehavior, { radius, lingerDuration: full.smokeLingerDuration });
      const id = runtime.createCloud(0, 0, effect, smokeSource(), 0);
      for (let i = 0; i < full.smokeBehavior.growthMaxProcs; i++) {
        const target = smokeTarget('growth-' + i);
        runtime.updateExposure([target], 200 + i * 400);
        charge(target, id, 200 + i * 400, 'kill-' + i, true);
      }
      const grown = runtime.getSnapshots(200 + full.smokeBehavior.growthMaxProcs * 400)[0];
      expect(grown.radius).toBeCloseTo(radius * (1 + full.smokeBehavior.growthMaxProcs * full.smokeBehavior.growthRadiusFraction));
      runtime.destroy();
    }
  });
});
