import { resolveDawnExpansionCost } from '../dawn/economy/DawnEconomy';
import type { DawnProgress } from '../dawn/economy/DawnProgress';
import { resolveDawnThreat } from '../dawn/rules/DawnThreat';
import { resolvePersonalPersistentBaseAreaStage } from '../persistentBase/PersistentBaseAreaStageResolution';
import { resolvePersistentBaseBuildAreaForStage, type CampaignPersistentBaseAreaStage } from '../persistentBase/PersistentBaseCore';
import { DAWN_MERCHANT, isDawnMerchantCategoryWithin } from '../config/dawn/merchant';
import { getDawnInfrastructureLevel, resolveDawnInfrastructureCost } from '../dawn/economy/DawnMerchantInfrastructure';
import { canPurchaseDawnBossPoint, canPurchaseDawnBranch, isDawnBranchResearched, resolveDawnBossPointCost } from '../dawn/economy/DawnMerchantUpgrades';
import { canPurchaseDawnRecalibrationCore, canPurchaseDawnShopItem, canRecalibrateDawnItem,
  getDawnRecalibrationCorePrice, getDawnShopOffer, type DawnEquipmentProgressDraft } from '../dawn/economy/DawnMerchantEquipment';
import { describeCoopDefenseItem, formatCoopDefenseItemValue, isCoopDefenseStashFull } from '../utils/coopDefenseItems';
import type { CoopDefenseItem } from '../types';
import type { Locale } from '../i18n/types';
import { resolveDawnExpansionCoreHpBonus, resolveDawnExpansionReward, resolveDawnExpansionRewardUnlocks } from '../dawn/economy/DawnExpansionRewards';
import { DAWN_UI_TEXTURES } from '../assets/DawnUiAssets';

const INFRASTRUCTURE_ICONS = {
  'repair-drones': DAWN_UI_TEXTURES.dealerInfrastructure,
  'scrap-magnet': DAWN_UI_TEXTURES.scrapMagnet,
  'scrap-scanner': DAWN_UI_TEXTURES.scrapScanner,
};

export const DAWN_MERCHANT_FILTERS = ['all', 'available', 'blocked', 'owned'] as const;
export type DawnMerchantFilter = typeof DAWN_MERCHANT_FILTERS[number];

interface DawnMerchantBrowseOffer {
  name: string;
  categoryId: string;
  canBuy: boolean;
  owned: boolean;
  fresh?: boolean;
  requirements: readonly { met: boolean; locked?: boolean }[];
}

export function getDawnMerchantOfferStatus(entry: DawnMerchantBrowseOffer): 'owned' | 'blocked' | 'expensive' | 'available' {
  return entry.owned ? 'owned' : entry.requirements.some(row => !row.met && row.locked) ? 'blocked' : entry.canBuy ? 'available' : 'expensive';
}

/** Search, status and category intersect. Canonical/decomposed umlauts behave alike;
 * an unaccented query also finds the corresponding accented name. */
export function filterDawnMerchantOffers<T extends DawnMerchantBrowseOffer>(offers: readonly T[], categoryId: string,
  query: string, filter: DawnMerchantFilter, locale: Locale): T[] {
  const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase(locale);
  const needle = normalize(query.trim());
  return offers.filter(entry => isDawnMerchantCategoryWithin(entry.categoryId, categoryId)
    && normalize(entry.name).includes(needle)
    && (filter === 'all' || getDawnMerchantOfferStatus(entry) === filter));
}

/** Sidebar inventory totals do not depend on search, filters or purchasing state. */
export function summarizeDawnMerchantCategory(offers: readonly DawnMerchantBrowseOffer[], categoryId: string) {
  const branch = offers.filter(entry => isDawnMerchantCategoryWithin(entry.categoryId, categoryId));
  return { count: branch.length, attention: branch.some(entry => entry.canBuy || entry.fresh) };
}

export function buildDawnMerchantLevelSegments(level: number, max: number): boolean[] {
  return Array.from({ length: max }, (_, index) => index < level);
}

export function buildDawnMerchantModel(progress: DawnProgress, campaignStage: CampaignPersistentBaseAreaStage, unlocked: boolean) {
  const cost = resolveDawnExpansionCost(progress.expansionLevel);
  const area = resolvePersistentBaseBuildAreaForStage(resolvePersonalPersistentBaseAreaStage({
    campaignStage, dawnExpansionLevel: progress.expansionLevel,
  }));
  return {
    scrap: progress.scrap, expansionLevel: progress.expansionLevel,
    threat: resolveDawnThreat(progress.expansionLevel),
    nextThreat: cost === null ? null : resolveDawnThreat(progress.expansionLevel + 1),
    radius: area.kind === 'radius' ? area.radiusCells : 3,
    coreHpBonus: resolveDawnExpansionCoreHpBonus(progress.expansionLevel),
    plasmaTurrets: resolveDawnExpansionRewardUnlocks(progress.expansionLevel).length,
    nextReward: cost === null ? null : resolveDawnExpansionReward(progress.expansionLevel + 1),
    cost, canBuy: unlocked && cost !== null && progress.scrap >= cost,
  };
}

/** Presentation projections only; transactions continue to validate at the economy boundary. */
export function buildDawnInfrastructureModel(progress: DawnProgress, unlocked: boolean) {
  return DAWN_MERCHANT.infrastructure.map(entry => {
    const level = getDawnInfrastructureLevel(progress, entry.id);
    const cost = resolveDawnInfrastructureCost(progress, entry.id);
    return { id: entry.id, icon: INFRASTRUCTURE_ICONS[entry.id], level, maxLevel: entry.levelPrices.length, cost,
      effectKey: `ui.dawn.infrastructure.${entry.id}.effect${Math.min(level + 1, entry.levelPrices.length)}`,
      // Below the maximum the line describes the purchasable next level, at the maximum the active one.
      effectIsNextLevel: level < entry.levelPrices.length,
      canBuy: unlocked && cost !== null && progress.scrap >= cost };
  });
}

export function buildDawnUpgradesModel(progress: DawnProgress, unlocked: boolean) {
  return {
    branches: DAWN_MERCHANT.upgrades.branches.map(entry => ({
      ...entry, researched: isDawnBranchResearched(progress, entry.branchId),
      canBuy: canPurchaseDawnBranch(progress, entry.branchId, unlocked),
    })),
    bossPoints: { purchased: progress.purchasedBossPoints, limit: DAWN_MERCHANT.upgrades.bossPointPrices.length,
      cost: resolveDawnBossPointCost(progress.purchasedBossPoints), canBuy: canPurchaseDawnBossPoint(progress, unlocked) },
  };
}

export function buildDawnEquipmentModel(progress: DawnEquipmentProgressDraft, unlocked: boolean) {
  const equipped = new Set(Object.values(progress.equippedItemIds));
  return {
    offers: (getDawnShopOffer(progress.dawn)?.items ?? []).map((entry, index) => ({
      ...entry, index, stashFull: isCoopDefenseStashFull(progress.items, progress.equippedItemIds, entry.item.slot),
      canBuy: canPurchaseDawnShopItem(progress, index, unlocked),
    })),
    cores: progress.dawn.crafting.recalibrationCores, coreCost: getDawnRecalibrationCorePrice(),
    canBuyCore: canPurchaseDawnRecalibrationCore(progress.dawn, unlocked),
    owned: progress.items.map(item => ({ item, equipped: equipped.has(item.uid),
      canRecalibrate: canRecalibrateDawnItem(progress, item.uid, unlocked) })),
    canUseCore: unlocked && progress.dawn.crafting.recalibrationCores > 0 && progress.items.length > 0,
  };
}

export function buildDawnMerchantItemModel(item: CoopDefenseItem, locale: Locale) {
  const description = describeCoopDefenseItem(item, locale);
  return { ...description, lines: [
    ...description.lines.map(line => `${line.label}: ${formatCoopDefenseItemValue(line.value, line.displayAsPercent, locale)}`),
    ...description.affixLines.map(line => `${line.label}: ${line.text}`),
  ] };
}
