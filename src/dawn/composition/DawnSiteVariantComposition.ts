import { DAWN_SITE_VARIANTS } from '../../config/dawn/siteVariants';
import { DAWN_WRECK_VARIANTS } from '../contracts/DawnContentIds';
import type { DawnSitePlan } from '../contracts/DawnPlans';
import { createDawnRandom } from './DawnRandom';

/** Host-only decoration of the plan; never consumes placement, tier or wave random streams. */
export function composeDawnSiteVariants(seed: number, sites: readonly DawnSitePlan[]): DawnSitePlan[] {
  const random = createDawnRandom(seed, 'variants');
  return sites.map(site => {
    if (site.archetypeId !== 'wreck') return site;
    const variant = random.pickWeighted(DAWN_WRECK_VARIANTS, key => DAWN_SITE_VARIANTS.wreck[key])!;
    return { ...site, variant };
  });
}
