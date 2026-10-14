import { describe, expect, it } from 'vitest';
import { DAWN_INFRASTRUCTURE_IDS, DAWN_MERCHANT, getDawnInfrastructureMaxLevel, validateDawnMerchantCatalog } from '../src/config/dawn/merchant';
import { DAWN_UPGRADE_BRANCHES } from '../src/config/dawn/upgradeBranches';
import { createDefaultDawnProgress, sanitizeDawnProgress } from '../src/dawn/economy/DawnProgress';
import { rollCoopDefenseItem } from '../src/utils/coopDefenseItems';

const item = rollCoopDefenseItem('helmet', 4, null, () => 0.5);

describe('Dawn merchant catalog', () => {
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
