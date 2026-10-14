import { describe, expect, it } from 'vitest';
import { DAWN_INFRASTRUCTURE_IDS, DAWN_MERCHANT, getDawnInfrastructureMaxLevel, getDawnMerchantCategories,
  isDawnMerchantCategoryWithin, validateDawnMerchantCatalog } from '../src/config/dawn/merchant';
import { translate } from '../src/i18n/catalog';
import { DAWN_UPGRADE_BRANCHES } from '../src/config/dawn/upgradeBranches';
import { createDefaultDawnProgress, sanitizeDawnProgress } from '../src/dawn/economy/DawnProgress';
import { rollCoopDefenseItem } from '../src/utils/coopDefenseItems';

const item = rollCoopDefenseItem('helmet', 4, null, () => 0.5);

describe('Dawn merchant catalog', () => {
  it('resolves authored categories and hides only empty children', () => {
    const child = DAWN_MERCHANT.categories.find(entry => entry.parentId !== null)!;
    const visible = getDawnMerchantCategories([child.id]);
    expect(visible.filter(entry => entry.parentId !== null)).toEqual([child]);
    expect(visible.filter(entry => entry.parentId === null)).toEqual(DAWN_MERCHANT.categories.filter(entry => entry.parentId === null));
    expect(isDawnMerchantCategoryWithin(child.id, child.parentId!)).toBe(true);
    expect(isDawnMerchantCategoryWithin(child.id, child.id)).toBe(true);
    expect(isDawnMerchantCategoryWithin(child.parentId!, child.id)).toBe(false);
    for (const category of DAWN_MERCHANT.categories) {
      for (const locale of ['de', 'en'] as const) expect(translate(locale, category.nameKey)).not.toContain('⟦');
    }
  });

  it('rejects duplicate, cyclic, missing-parent and invalid category references', () => {
    const categories = DAWN_MERCHANT.categories;
    const root = categories.find(entry => entry.parentId === null)!;
    const child = categories.find(entry => entry.parentId === root.id)!;
    for (const invalid of [
      [], [...categories, root],
      categories.map(entry => entry.id === child.id ? { ...entry, parentId: 'missing' } : entry),
      categories.map(entry => entry.id === root.id ? { ...entry, parentId: child.id } : entry),
      categories.map(entry => ({ ...entry, order: NaN })),
      categories.map(entry => ({ ...entry, nameKey: '' })),
    ]) expect(() => validateDawnMerchantCatalog({ ...DAWN_MERCHANT, categories: invalid })).toThrow();
    expect(() => validateDawnMerchantCatalog({ ...DAWN_MERCHANT, expansion: { categoryId: 'missing' } })).toThrow();
    expect(() => validateDawnMerchantCatalog({ ...DAWN_MERCHANT,
      equipment: { ...DAWN_MERCHANT.equipment, itemCategoryId: 'missing' } })).toThrow();
  });

  it('prices every upgrade branch and infrastructure exactly once', () => {
    expect(validateDawnMerchantCatalog(DAWN_MERCHANT)).toEqual(DAWN_MERCHANT);
    expect(DAWN_MERCHANT.upgrades.branches.map(entry => entry.branchId).sort())
      .toEqual(DAWN_UPGRADE_BRANCHES.map(branch => branch.id).sort());
    expect(DAWN_MERCHANT.infrastructure.map(entry => entry.id)).toEqual([...DAWN_INFRASTRUCTURE_IDS]);
    for (const id of DAWN_INFRASTRUCTURE_IDS) expect(getDawnInfrastructureMaxLevel(id)).toBeGreaterThan(0);
  });

  it('rejects incomplete or invalid catalogs', () => {
    const { upgrades, infrastructure, equipment } = DAWN_MERCHANT;
    for (const raw of [
      null,
      { ...DAWN_MERCHANT, upgrades: { ...upgrades, branches: [] } },
      { ...DAWN_MERCHANT, upgrades: { ...upgrades, bossPointPrices: [0] } },
      { ...DAWN_MERCHANT, infrastructure: infrastructure.slice(1) },
      { ...DAWN_MERCHANT, infrastructure: [...infrastructure, infrastructure[0]] },
      { ...DAWN_MERCHANT, equipment: { ...equipment, itemOfferCount: 0 } },
      { ...DAWN_MERCHANT, equipment: { ...equipment, itemPriceByRarity: { white: 1, blue: 1 } } },
      { ...DAWN_MERCHANT, equipment: { ...equipment, itemPriceGrowthPerThreat: -0.1 } },
      { ...DAWN_MERCHANT, equipment: { ...equipment, recalibrationCorePrice: 1.5 } },
    ]) expect(() => validateDawnMerchantCatalog(raw)).toThrow();
  });
});

describe('Dawn shop offer persistence', () => {
  it('defaults to no offer and round-trips a persisted offer', () => {
    expect(createDefaultDawnProgress().shopOffer).toBeNull();
    const shopOffer = { roundsPlayed: 3, threat: 2, items: [{ item, price: 175, sold: false }] };
    const progress = sanitizeDawnProgress({ ...createDefaultDawnProgress(), shopOffer });
    expect(progress?.shopOffer).toEqual(shopOffer);
    expect(sanitizeDawnProgress({ scrap: 5 })?.shopOffer).toBeNull();
  });

  it('rejects a malformed offer instead of keeping a partial one', () => {
    for (const shopOffer of [
      { roundsPlayed: -1, threat: 1, items: [] },
      { roundsPlayed: 1, threat: 0, items: [] },
      { roundsPlayed: 1, threat: 1, items: [{ item, price: 0, sold: false }] },
      { roundsPlayed: 1, threat: 1, items: [{ item: { uid: 'x' }, price: 10, sold: false }] },
      { roundsPlayed: 1, threat: 1, items: Array.from({ length: 7 }, () => ({ item, price: 10, sold: false })) },
    ]) expect(sanitizeDawnProgress({ shopOffer })).toBeNull();
  });
});
