import { describe, expect, it } from 'vitest';
import { DAWN_MERCHANT, type DawnMerchantCatalog } from '../src/config/dawn/merchant';
import { createDefaultDawnProgress } from '../src/dawn/economy/DawnProgress';
import {
  canPurchaseDawnBossPoint, canPurchaseDawnBranch, isDawnBossPointLimitReached, isDawnBranchResearched,
  purchaseDawnBossPoint, purchaseDawnBranch, resolveDawnBossPointCost, resolveDawnBranchCost,
} from '../src/dawn/economy/DawnMerchantUpgrades';
import { getCoopDefenseProgressSnapshot } from '../src/utils/coopDefenseProgression';
import {
  buildDefaultCoopDefenseUpgradeProfile, COOP_DEFENSE_UPGRADE_DEFINITIONS,
  levelUpCoopDefenseUpgrade, resolveEarnedCoopDefenseBossPoints,
} from '../src/utils/coopDefenseUpgrades';

const branch = DAWN_MERCHANT.upgrades.branches[0];
const catalog: DawnMerchantCatalog = {
  ...DAWN_MERCHANT,
  upgrades: { branches: [{ branchId: branch.branchId, price: 17 }], bossPointPrices: [11, 23] },
};

describe('Dawn merchant upgrades', () => {
  it.each(['locked', 'unknown', 'researched', 'unaffordable'])(
    'rejects a %s branch purchase without changing the draft', reason => {
      const draft = { ...createDefaultDawnProgress(), scrap: reason === 'unaffordable' ? 16 : 17 };
      if (reason === 'researched') draft.unlockedBranchIds = [branch.branchId];
      const before = structuredClone(draft);
      const id = reason === 'unknown' ? 'unknown-branch' : branch.branchId;
      expect(canPurchaseDawnBranch(draft, id, reason !== 'locked', catalog)).toBe(false);
      expect(purchaseDawnBranch(draft, id, reason !== 'locked', catalog)).toBe(false);
      expect(draft).toEqual(before);
    },
  );

  it('charges exactly the branch price, sorts the owned IDs and cannot charge twice', () => {
    const draft = { ...createDefaultDawnProgress(), scrap: 17, unlockedBranchIds: ['z-existing', 'a-existing'] };
    expect(resolveDawnBranchCost(branch.branchId, catalog)).toBe(17);
    expect(resolveDawnBranchCost('unknown', catalog)).toBeNull();
    expect(isDawnBranchResearched(draft, branch.branchId)).toBe(false);
    expect(canPurchaseDawnBranch(draft, branch.branchId, true, catalog)).toBe(true);
    expect(purchaseDawnBranch(draft, branch.branchId, true, catalog)).toBe(true);
    expect(draft.scrap).toBe(0);
    expect(draft.unlockedBranchIds).toEqual(['a-existing', branch.branchId, 'z-existing'].sort());
    expect(isDawnBranchResearched(draft, branch.branchId)).toBe(true);
    expect(purchaseDawnBranch(draft, branch.branchId, true, catalog)).toBe(false);
  });

  it.each(['locked', 'unaffordable', 'limit', 'beyond-limit', 'invalid-count'])(
    'rejects a %s boss point purchase without changing the draft', reason => {
      const draft = { ...createDefaultDawnProgress(), scrap: reason === 'unaffordable' ? 10 : 100 };
      draft.purchasedBossPoints = reason === 'limit' ? 2 : reason === 'beyond-limit' ? 3 : reason === 'invalid-count' ? -1 : 0;
      const before = structuredClone(draft);
      expect(canPurchaseDawnBossPoint(draft, reason !== 'locked', catalog)).toBe(false);
      expect(purchaseDawnBossPoint(draft, reason !== 'locked', catalog)).toBe(false);
      expect(draft).toEqual(before);
    },
  );

  it('uses successive prices and stops at the catalog limit, including an empty list', () => {
    const draft = { ...createDefaultDawnProgress(), scrap: 34 };
    for (const [index, cost] of catalog.upgrades.bossPointPrices.entries()) {
      expect(isDawnBossPointLimitReached(draft, catalog)).toBe(false);
      expect(resolveDawnBossPointCost(draft.purchasedBossPoints, catalog)).toBe(cost);
      expect(canPurchaseDawnBossPoint(draft, true, catalog)).toBe(true);
      const balance = draft.scrap;
      expect(purchaseDawnBossPoint(draft, true, catalog)).toBe(true);
      expect(draft.scrap).toBe(balance - cost);
      expect(draft.purchasedBossPoints).toBe(index + 1);
    }
    expect(draft.scrap).toBe(0);
    expect(isDawnBossPointLimitReached(draft, catalog)).toBe(true);
    expect(resolveDawnBossPointCost(draft.purchasedBossPoints, catalog)).toBeNull();
    const empty = { ...catalog, upgrades: { ...catalog.upgrades, bossPointPrices: [] } };
    expect(purchaseDawnBossPoint(createDefaultDawnProgress(), true, empty)).toBe(false);
    expect(isDawnBossPointLimitReached(createDefaultDawnProgress(), empty)).toBe(true);
  });

  it('defaults to authored prices', () => {
    const draft = { ...createDefaultDawnProgress(), scrap: branch.price + DAWN_MERCHANT.upgrades.bossPointPrices[0] };
    expect(purchaseDawnBranch(draft, branch.branchId, true)).toBe(true);
    expect(purchaseDawnBossPoint(draft, true)).toBe(true);
    expect(draft.scrap).toBe(0);
  });

  it('makes purchased boss points available and spendable in the upgrade tree', () => {
    const upgrade = Object.values(COOP_DEFENSE_UPGRADE_DEFINITIONS).find(definition =>
      definition.bossPointCostPerLevel > 0 && definition.requires.length === 0 && !definition.availableClasses)!;
    const dawn = { ...createDefaultDawnProgress(), scrap: 10000 };
    for (let i = 0; i < upgrade.bossPointCostPerLevel; i++) expect(purchaseDawnBossPoint(dawn, true)).toBe(true);
    const earned = resolveEarnedCoopDefenseBossPoints({ completedBossMapIds: [], dawn });
    const profile = buildDefaultCoopDefenseUpgradeProfile();
    const before = getCoopDefenseProgressSnapshot(0, profile, earned);
    expect(before.availableBossPoints).toBe(upgrade.bossPointCostPerLevel);
    expect(before.upgradeCategories.flatMap(category => category.upgrades).find(node => node.id === upgrade.id)?.canLevelUp).toBe(true);
    const leveled = levelUpCoopDefenseUpgrade(profile, upgrade.id, before.level, earned);
    expect(leveled).not.toBeNull();
    expect(getCoopDefenseProgressSnapshot(0, leveled!, earned).availableBossPoints).toBe(0);
  });
});
