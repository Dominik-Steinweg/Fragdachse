import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COOP_DEFENSE_ITEM_SLOTS, COOP_DEFENSE_ITEM_RARITIES, COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT,
  getCoopDefenseItemRarityDefinition } from '../src/config/coopDefenseItems';
import { getDawnThreatCurve } from '../src/config/dawn/dawnContent';
import { DAWN_MERCHANT, validateDawnMerchantCatalog } from '../src/config/dawn/merchant';
import { canPurchaseDawnRecalibrationCore, canPurchaseDawnShopItem, canRecalibrateDawnItem,
  ensureDawnShopOffer, getDawnRecalibrationCorePrice, getDawnRecalibrationCores, getDawnShopItemPrice,
  getDawnShopOffer, purchaseDawnRecalibrationCore, purchaseDawnShopItem, recalibrateDawnItem,
  type DawnEquipmentProgressDraft,
} from '../src/dawn/economy/DawnMerchantEquipment';
import { createDefaultDawnProgress, DAWN_MAX_EXPANSION_LEVEL, DAWN_MAX_SCRAP } from '../src/dawn/economy/DawnProgress';
import { resolveDawnThreat } from '../src/dawn/rules/DawnThreat';
import { getCoopDefenseItemAffixIdsForSlot, recalibrateCoopDefenseItem, rollCoopDefenseItem,
  sanitizeCoopDefenseItem } from '../src/utils/coopDefenseItems';
import { getStoredCoopDefenseProgress, invalidateLocalStorageCache, LOCAL_PROGRESS_STORAGE_KEY,
  updateStoredDawnEquipmentProgress } from '../src/utils/localPreferences';

function draft(): DawnEquipmentProgressDraft {
  const dawn = createDefaultDawnProgress();
  dawn.scrap = DAWN_MAX_SCRAP;
  ensureDawnShopOffer(dawn, true, () => 0.8);
  return { dawn, items: [], equippedItemIds: {}, unseenItems: false };
}

describe('Dawn equipment rules', () => {
  it('rolls only when unlocked and missing or on a different round, never on expansion alone', () => {
    const progress = createDefaultDawnProgress();
    const random = vi.fn(() => 0.5);
    expect(ensureDawnShopOffer(progress, false, random)).toBe(false);
    expect(random).not.toHaveBeenCalled();
    expect(ensureDawnShopOffer(progress, true, random)).toBe(true);
    const first = structuredClone(progress.shopOffer);
    progress.expansionLevel++;
    random.mockClear();
    expect(ensureDawnShopOffer(progress, true, random)).toBe(false);
    expect(random).not.toHaveBeenCalled();
    expect(getDawnShopOffer(progress)).toEqual(first);
    progress.stats.roundsPlayed++;
    expect(getDawnShopOffer(progress)).toBeNull();
    expect(ensureDawnShopOffer(progress, true, random)).toBe(true);
    expect(progress.shopOffer!.items.every(entry => !first!.items.some(old => old.item.uid === entry.item.uid))).toBe(true);
  });

  it('derives levels and rounded prices from personal threat and the supplied catalog', () => {
    const catalog = validateDawnMerchantCatalog({ ...DAWN_MERCHANT, equipment: {
      ...DAWN_MERCHANT.equipment, itemPriceGrowthPerThreat: 0.31, itemPriceByRarity: { white: 17, blue: 39, yellow: 83 },
    } });
    for (let expansionLevel = 0; expansionLevel <= DAWN_MAX_EXPANSION_LEVEL; expansionLevel++) {
      const progress = { ...createDefaultDawnProgress(), expansionLevel };
      const threat = resolveDawnThreat(expansionLevel);
      ensureDawnShopOffer(progress, true, () => 0.9, catalog);
      expect(progress.shopOffer!.threat).toBe(threat);
      expect(progress.shopOffer!.items).toHaveLength(catalog.equipment.itemOfferCount);
      for (const { item, price } of progress.shopOffer!.items) {
        expect(item.itemLevel).toBe(getDawnThreatCurve(threat).itemLevel);
        expect(price).toBe(Math.round(catalog.equipment.itemPriceByRarity[item.rarity] * 1.31 ** (threat - 1)));
      }
      for (const rarity of COOP_DEFENSE_ITEM_RARITIES) {
        expect(getDawnShopItemPrice(rarity, threat, catalog)).toBe(Math.round(catalog.equipment.itemPriceByRarity[rarity] * 1.31 ** (threat - 1)));
      }
    }
  });

  it.each([1, 3, 6])('maximizes slot variety and keeps %s IDs unique even with constant random', itemOfferCount => {
    const progress = createDefaultDawnProgress();
    const catalog = validateDawnMerchantCatalog({ ...DAWN_MERCHANT, equipment: { ...DAWN_MERCHANT.equipment, itemOfferCount } });
    ensureDawnShopOffer(progress, true, () => 0, catalog);
    const items = progress.shopOffer!.items.map(entry => entry.item);
    expect(new Set(items.map(item => item.uid)).size).toBe(itemOfferCount);
    expect(new Set(items.map(item => item.slot)).size).toBe(Math.min(itemOfferCount, COOP_DEFENSE_ITEM_SLOTS.length));
  });

  it.each(['locked', 'sold', 'expensive', 'full', 'stale', 'duplicate', 'invalid-index'])('rejects %s purchases without changing any state', reason => {
    const progress = draft();
    const entry = progress.dawn.shopOffer!.items[0];
    if (reason === 'sold') entry.sold = true;
    if (reason === 'expensive') progress.dawn.scrap = entry.price - 1;
    if (reason === 'stale') progress.dawn.stats.roundsPlayed++;
    if (reason === 'duplicate') progress.items.push(entry.item);
    if (reason === 'full') progress.items = Array.from({ length: COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT },
      (_, i) => ({ ...entry.item, uid: `owned_${i}` }));
    const before = structuredClone(progress);
    const index = reason === 'invalid-index' ? 0.5 : 0;
    expect(canPurchaseDawnShopItem(progress, index, reason !== 'locked')).toBe(false);
    expect(purchaseDawnShopItem(progress, index, reason !== 'locked')).toBe(false);
    expect(progress).toEqual(before);
  });

  it('buys at exact price and excludes equipped items from the category limit', () => {
    const progress = draft();
    const entry = progress.dawn.shopOffer!.items[0];
    progress.items = Array.from({ length: COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT }, (_, i) => ({ ...entry.item, uid: `owned_${i}` }));
    progress.equippedItemIds[entry.item.slot] = 'owned_0';
    progress.dawn.scrap = entry.price;
    expect(canPurchaseDawnShopItem(progress, 0, true)).toBe(true);
    expect(purchaseDawnShopItem(progress, 0, true)).toBe(true);
    expect(progress.dawn.scrap).toBe(0);
    expect(progress.items.at(-1)).toEqual(entry.item);
    expect(entry.sold).toBe(true);
    expect(progress.unseenItems).toBe(true);
  });

  it('prices cores from the catalog and rejects locked, unaffordable or overflowing purchases', () => {
    const catalog = validateDawnMerchantCatalog({ ...DAWN_MERCHANT, equipment: { ...DAWN_MERCHANT.equipment, recalibrationCorePrice: 13 } });
    const progress = createDefaultDawnProgress();
    const price = getDawnRecalibrationCorePrice(catalog);
    progress.scrap = price - 1;
    expect(canPurchaseDawnRecalibrationCore(progress, true, catalog)).toBe(false);
    expect(purchaseDawnRecalibrationCore(progress, true, catalog)).toBe(false);
    progress.scrap = price;
    expect(purchaseDawnRecalibrationCore(progress, false, catalog)).toBe(false);
    expect(purchaseDawnRecalibrationCore(progress, true, catalog)).toBe(true);
    expect(progress.scrap).toBe(0);
    expect(getDawnRecalibrationCores(progress)).toBe(1);
    progress.scrap = price;
    progress.crafting.recalibrationCores = Number.MAX_SAFE_INTEGER;
    const before = structuredClone(progress);
    expect(purchaseDawnRecalibrationCore(progress, true, catalog)).toBe(false);
    expect(progress).toEqual(before);
  });

  it('rerolls all affixes with normal slot, rarity and level rules without mutating the original', () => {
    for (const slot of COOP_DEFENSE_ITEM_SLOTS) for (const rarity of COOP_DEFENSE_ITEM_RARITIES) {
      const rolled = rollCoopDefenseItem(slot, 7, null, () => 0.9);
      const item = { ...rolled, rarity, affixes: rolled.affixes.slice(0, getCoopDefenseItemRarityDefinition(rarity).affixCount) };
      const before = structuredClone(item);
      const result = recalibrateCoopDefenseItem(item, () => 0.1);
      expect(item).toEqual(before);
      expect({ ...result, affixes: [] }).toEqual({ ...item, affixes: [] });
      expect(result.affixes).toHaveLength(getCoopDefenseItemRarityDefinition(rarity).affixCount);
      expect(new Set(result.affixes.map(affix => affix.affixId)).size).toBe(result.affixes.length);
      expect(result.affixes.every(affix => getCoopDefenseItemAffixIdsForSlot(slot).includes(affix.affixId))).toBe(true);
      expect(sanitizeCoopDefenseItem(result)).toEqual(result);
      if (result.affixes.length) expect(result.affixes).not.toEqual(item.affixes);
      // The same draws choose the same affixes; their values must use the item's level.
      const low = recalibrateCoopDefenseItem({ ...item, itemLevel: 1 }, () => 0.1);
      if (result.affixes.length) expect(result.affixes).not.toEqual(low.affixes);
    }
  });

  it.each(['locked', 'missing', 'no-core'])('rejects %s recalibration before drawing random or spending a core', reason => {
    const progress = draft();
    const item = progress.dawn.shopOffer!.items[0].item;
    progress.items.push(item);
    progress.dawn.crafting.recalibrationCores = reason === 'no-core' ? 0 : 2;
    const before = structuredClone(progress);
    const random = vi.fn(() => 0.1);
    const uid = reason === 'missing' ? 'unknown' : item.uid;
    expect(canRecalibrateDawnItem(progress, uid, reason !== 'locked')).toBe(false);
    expect(recalibrateDawnItem(progress, uid, reason !== 'locked', random)).toBe(false);
    expect(random).not.toHaveBeenCalled();
    expect(progress).toEqual(before);
  });
});

describe('Dawn equipment persistence', () => {
  let values: Map<string, string>;
  let setItem: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    values = new Map();
    setItem = vi.fn((key: string, value: string) => { values.set(key, value); });
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => values.get(key) ?? null, setItem, removeItem: (key: string) => values.delete(key),
    } });
    invalidateLocalStorageCache();
    getStoredCoopDefenseProgress();
    updateStoredDawnEquipmentProgress(progress => { Object.assign(progress, draft()); return true; });
    // Finish the existing new-save owner-ID normalization before testing transactions.
    invalidateLocalStorageCache();
    getStoredCoopDefenseProgress();
    setItem.mockClear();
  });
  afterEach(() => { invalidateLocalStorageCache(); vi.unstubAllGlobals(); });

  function expectSingleWriteAndReload(): void {
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem.mock.calls[0][0]).toBe(LOCAL_PROGRESS_STORAGE_KEY);
    const saved = getStoredCoopDefenseProgress();
    invalidateLocalStorageCache();
    expect(getStoredCoopDefenseProgress()).toEqual(saved);
  }

  it('persists the first offer immediately and reload never rerolls it', () => {
    const saved = getStoredCoopDefenseProgress().dawn.shopOffer;
    invalidateLocalStorageCache();
    const random = vi.fn(() => 0);
    expect(updateStoredDawnEquipmentProgress(progress => ensureDawnShopOffer(progress.dawn, true, random))).toBe(false);
    expect(random).not.toHaveBeenCalled();
    expect(getStoredCoopDefenseProgress().dawn.shopOffer).toEqual(saved);
    setItem.mockClear();
    expect(updateStoredDawnEquipmentProgress(progress => {
      progress.dawn.stats.roundsPlayed++;
      return ensureDawnShopOffer(progress.dawn, true, random);
    })).toBe(true);
    expectSingleWriteAndReload();
  });

  it('persists debit, item and sold flag in exactly one write, and does not write rejected purchases', () => {
    const before = getStoredCoopDefenseProgress();
    const entry = before.dawn.shopOffer!.items[0];
    expect(updateStoredDawnEquipmentProgress(progress => purchaseDawnShopItem(progress, 0, true))).toBe(true);
    expectSingleWriteAndReload();
    const after = getStoredCoopDefenseProgress();
    expect(after.dawn.scrap).toBe(before.dawn.scrap - entry.price);
    expect(after.items).toEqual([entry.item]);
    expect(after.dawn.shopOffer!.items[0].sold).toBe(true);
    setItem.mockClear();
    expect(updateStoredDawnEquipmentProgress(progress => purchaseDawnShopItem(progress, 0, true))).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });

  it.each([false, true])('persists core purchase and recalibration of equipped=%s with exactly one core consumed', equipped => {
    updateStoredDawnEquipmentProgress(progress => {
      purchaseDawnShopItem(progress, 0, true);
      if (equipped) progress.equippedItemIds[progress.items[0].slot] = progress.items[0].uid;
      return true;
    });
    setItem.mockClear();
    expect(updateStoredDawnEquipmentProgress(progress => purchaseDawnRecalibrationCore(progress.dawn, true))).toBe(true);
    expectSingleWriteAndReload();
    const before = getStoredCoopDefenseProgress();
    const item = before.items[0];
    setItem.mockClear();
    expect(updateStoredDawnEquipmentProgress(progress => recalibrateDawnItem(progress, item.uid, true, () => 0.1))).toBe(true);
    expectSingleWriteAndReload();
    const after = getStoredCoopDefenseProgress();
    expect(after.dawn.crafting.recalibrationCores).toBe(0);
    expect(after.dawn.scrap).toBe(before.dawn.scrap);
    expect(after.items).toEqual([recalibrateCoopDefenseItem(item, () => 0.1)]);
    expect(after.equippedItemIds).toEqual(before.equippedItemIds);
  });

  it('preserves cache and saved progress when storage rejects the atomic purchase', () => {
    const before = getStoredCoopDefenseProgress();
    setItem.mockImplementation(() => { throw new Error('quota'); });
    expect(updateStoredDawnEquipmentProgress(progress => purchaseDawnShopItem(progress, 0, true))).toBe(false);
    expect(getStoredCoopDefenseProgress()).toEqual(before);
    invalidateLocalStorageCache();
    expect(getStoredCoopDefenseProgress()).toEqual(before);
  });

  it('rejects an invalid combined draft without partial currency changes or reference leaks', () => {
    const before = getStoredCoopDefenseProgress();
    expect(updateStoredDawnEquipmentProgress(progress => {
      purchaseDawnShopItem(progress, 0, true);
      progress.dawn.crafting.recalibrationCores = -1;
      return true;
    })).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
    expect(getStoredCoopDefenseProgress()).toEqual(before);
  });
});
