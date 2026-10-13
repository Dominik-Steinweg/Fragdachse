import { describe, expect, it } from 'vitest';
import { DAWN_SITE_VARIANTS } from '../../src/config/dawn/siteVariants';
import { composeDawnSiteVariants } from '../../src/dawn/composition/DawnSiteVariantComposition';
import { DAWN_WRECK_VARIANTS, type DawnWreckVariant } from '../../src/dawn/contracts/DawnContentIds';

describe('Dawn wreck variant multi-seed distribution', () => {
  it('follows authored weights across independent round seeds at every tier', () => {
    const seeds = 10_000;
    const sites = [1, 2, 3].map(tier => ({ slotId: `slot-${tier}`, archetypeId: 'wreck', tier }));
    const counts = sites.map(() => ({ drone: 0, tractor: 0, minecart: 0 }));
    for (let seed = 1; seed <= seeds; seed++) {
      composeDawnSiteVariants(seed, sites).forEach((site, index) => counts[index][site.variant as DawnWreckVariant]++);
    }
    const total = Object.values(DAWN_SITE_VARIANTS.wreck).reduce((sum, weight) => sum + weight, 0);
    for (const count of counts) for (const variant of DAWN_WRECK_VARIANTS) {
      const probability = DAWN_SITE_VARIANTS.wreck[variant] / total;
      const tolerance = 6 * Math.sqrt(seeds * probability * (1 - probability)) + 1;
      expect(Math.abs(count[variant] - seeds * probability)).toBeLessThan(tolerance);
      if (probability === 0) expect(count[variant]).toBe(0);
    }
    console.info('Dawn wreck variants: 10,000 seeds per tier', counts);
  });
});
