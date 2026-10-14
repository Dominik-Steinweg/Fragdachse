import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAWN_CONTENT_HASH } from '../src/config/dawn/dawnContent';
import rawSiteVariants from '../src/config/dawn/siteVariants.json';
import { DAWN_SITE_VARIANTS, validateDawnSiteVariants } from '../src/config/dawn/siteVariants';
import { composeDawnSiteVariants } from '../src/dawn/composition/DawnSiteVariantComposition';
import { DAWN_WRECK_VARIANTS } from '../src/dawn/contracts/DawnContentIds';
import type { DawnSitePlan } from '../src/dawn/contracts/DawnPlans';

afterEach(() => { vi.doUnmock('../src/config/dawn/siteVariants.json'); vi.resetModules(); });

describe('Dawn site variant content', () => {
  it('loads authored weights and permits disabling individual known variants', () => {
    expect(DAWN_SITE_VARIANTS).toEqual(rawSiteVariants);
    expect(validateDawnSiteVariants({ wreck: { drone: 0, tractor: 1, minecart: 0 } }).wreck.tractor).toBe(1);
  });

  it.each([
    null, [], {}, { wreck: [] }, { wreck: { drone: 1 } },
    { ...rawSiteVariants, extractor: { tractor: 1 } },
    { wreck: { ...rawSiteVariants.wreck, unknown: 1 } },
    ...[-1, NaN, Infinity, '1', null].map(drone => ({ wreck: { ...rawSiteVariants.wreck, drone } })),
    { wreck: { drone: 0, tractor: 0, minecart: 0 } },
    { wreck: { drone: Number.MAX_VALUE, tractor: Number.MAX_VALUE, minecart: 1 } },
  ])('rejects invalid weights: %j', raw => {
    expect(() => validateDawnSiteVariants(raw)).toThrow('[dawnContent]');
  });

  it('includes variant weights in the Dawn content hash', async () => {
    vi.resetModules();
    vi.doMock('../src/config/dawn/siteVariants.json', () => ({ default: {
      wreck: { ...rawSiteVariants.wreck, tractor: rawSiteVariants.wreck.tractor + 1 },
    } }));
    const changed = await import('../src/config/dawn/dawnContent');
    expect(changed.DAWN_CONTENT_HASH).not.toBe(DAWN_CONTENT_HASH);
  });
});

describe('Dawn site variant composition', () => {
  const wrecks: readonly DawnSitePlan[] = [1, 2, 3].map(tier => ({ slotId: `slot-${tier}`, archetypeId: 'wreck', tier }));

  it('is deterministic and preserves every other plan field without mutating input', () => {
    const sites = [...wrecks, { slotId: 'extractor', archetypeId: 'extractor', tier: 1, hidden: true as const }];
    const before = structuredClone(sites);
    const first = composeDawnSiteVariants(2 ** 40 + 3, sites);
    expect(composeDawnSiteVariants(2 ** 40 + 3, sites)).toEqual(first);
    expect(sites).toEqual(before);
    expect(first.map(({ variant: _variant, ...site }) => site)).toEqual(sites);
    expect(first.at(-1)).not.toHaveProperty('variant');
    expect(first.slice(0, 3).every(site => DAWN_WRECK_VARIANTS.some(v => v === site.variant))).toBe(true);
  });

  it('does not consume a variant draw for non-wreck sites', () => {
    const first = composeDawnSiteVariants(91, wrecks);
    const mixed = composeDawnSiteVariants(91, [wrecks[0], { slotId: 'other', archetypeId: 'extractor', tier: 1 }, ...wrecks.slice(1)]);
    expect(mixed.filter(site => site.archetypeId === 'wreck')).toEqual(first);
  });
});
