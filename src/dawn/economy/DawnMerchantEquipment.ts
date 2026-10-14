import { COOP_DEFENSE_ITEM_SLOTS } from '../../config/coopDefenseItems';
import { getDawnThreatCurve } from '../../config/dawn/dawnContent';
import { DAWN_MERCHANT, type DawnMerchantCatalog } from '../../config/dawn/merchant';
import type { CoopDefenseItem, CoopDefenseItemRarity } from '../../types';
import { isCoopDefenseStashFull, recalibrateCoopDefenseItem, rollCoopDefenseItem,
  type CoopDefenseEquippedItemIds } from '../../utils/coopDefenseItems';
import { resolveDawnThreat } from '../rules/DawnThreat';
import type { DawnProgress, DawnShopOffer } from './DawnProgress';

/** The equipment transaction owns only Dawn currency/crafting and personal item state. */
export interface DawnEquipmentProgressDraft {
  dawn: DawnProgress;
  items: CoopDefenseItem[];
  equippedItemIds: CoopDefenseEquippedItemIds;
  unseenItems: boolean;
}

export function getDawnShopItemPrice(
  rarity: CoopDefenseItemRarity,
  threat: number,
  catalog: DawnMerchantCatalog = DAWN_MERCHANT,
): number {
  return Math.round(catalog.equipment.itemPriceByRarity[rarity]
    * (1 + catalog.equipment.itemPriceGrowthPerThreat) ** (threat - 1));
}

/** Callers persist a changed draft immediately; expansion alone never refreshes an offer. */
export function ensureDawnShopOffer(
  draft: DawnProgress,
  unlocked: boolean,
  random: () => number = Math.random,
  catalog: DawnMerchantCatalog = DAWN_MERCHANT,
): boolean {
  if (!unlocked || draft.shopOffer?.roundsPlayed === draft.stats.roundsPlayed) return false;
  const threat = resolveDawnThreat(draft.expansionLevel);
  const itemLevel = getDawnThreatCurve(threat).itemLevel;
  const items: DawnShopOffer['items'] = [];
  let slots = [...COOP_DEFENSE_ITEM_SLOTS];
  for (let index = 0; index < catalog.equipment.itemOfferCount; index++) {
    if (slots.length === 0) slots = [...COOP_DEFENSE_ITEM_SLOTS];
    const slotIndex = Math.min(slots.length - 1, Math.floor(random() * slots.length));
    const [slot] = slots.splice(slotIndex, 1);
    const rolled = rollCoopDefenseItem(slot, itemLevel, null, random);
    // Round and offer index also guarantee uniqueness for deterministic random sources.
    const item = { ...rolled, uid: `dawn_shop_${draft.stats.roundsPlayed}_${index}_${rolled.uid}` };
    items.push({ item, price: getDawnShopItemPrice(item.rarity, threat, catalog), sold: false });
  }
  draft.shopOffer = { roundsPlayed: draft.stats.roundsPlayed, threat, items };
  return true;
}

/** A stale offer is unavailable until ensureDawnShopOffer has been saved. */
export function getDawnShopOffer(progress: DawnProgress): DawnShopOffer | null {
  return progress.shopOffer?.roundsPlayed === progress.stats.roundsPlayed ? progress.shopOffer : null;
}

export function canPurchaseDawnShopItem(
  progress: DawnEquipmentProgressDraft,
  index: number,
  unlocked: boolean,
): boolean {
  const entry = Number.isInteger(index) ? getDawnShopOffer(progress.dawn)?.items[index] : undefined;
  return !!entry && unlocked && !entry.sold && progress.dawn.scrap >= entry.price
    && !progress.items.some(item => item.uid === entry.item.uid)
    && !isCoopDefenseStashFull(progress.items, progress.equippedItemIds, entry.item.slot);
}

/** Use inside updateStoredDawnEquipmentProgress: debit, ownership and sold flag are one update. */
export function purchaseDawnShopItem(draft: DawnEquipmentProgressDraft, index: number, unlocked: boolean): boolean {
  if (!canPurchaseDawnShopItem(draft, index, unlocked)) return false;
  const entry = draft.dawn.shopOffer!.items[index];
  draft.items.push({ ...entry.item, affixes: entry.item.affixes.map(affix => ({ ...affix })) });
  draft.dawn.scrap -= entry.price;
  entry.sold = true;
  draft.unseenItems = true;
  return true;
}

export function getDawnRecalibrationCorePrice(catalog: DawnMerchantCatalog = DAWN_MERCHANT): number {
  return catalog.equipment.recalibrationCorePrice;
}

export function getDawnRecalibrationCores(progress: DawnProgress): number {
  return progress.crafting.recalibrationCores;
}

export function canPurchaseDawnRecalibrationCore(
  progress: DawnProgress, unlocked: boolean, catalog: DawnMerchantCatalog = DAWN_MERCHANT,
): boolean {
  return unlocked && progress.scrap >= getDawnRecalibrationCorePrice(catalog)
    && progress.crafting.recalibrationCores < Number.MAX_SAFE_INTEGER;
}

export function purchaseDawnRecalibrationCore(
  draft: DawnProgress, unlocked: boolean, catalog: DawnMerchantCatalog = DAWN_MERCHANT,
): boolean {
  if (!canPurchaseDawnRecalibrationCore(draft, unlocked, catalog)) return false;
  draft.scrap -= getDawnRecalibrationCorePrice(catalog);
  draft.crafting.recalibrationCores += 1;
  return true;
}

export function canRecalibrateDawnItem(progress: DawnEquipmentProgressDraft, uid: string, unlocked: boolean): boolean {
  return unlocked && getDawnRecalibrationCores(progress.dawn) > 0 && progress.items.some(item => item.uid === uid);
}

/** Equipped items share the ownership list, so their UID mapping remains unchanged. */
export function recalibrateDawnItem(
  draft: DawnEquipmentProgressDraft, uid: string, unlocked: boolean, random: () => number = Math.random,
): boolean {
  if (!canRecalibrateDawnItem(draft, uid, unlocked)) return false;
  const index = draft.items.findIndex(item => item.uid === uid);
  const item = recalibrateCoopDefenseItem(draft.items[index], random);
  draft.items[index] = item;
  draft.dawn.crafting.recalibrationCores -= 1;
  return true;
}
