import { DAWN_MERCHANT, type DawnMerchantCatalog } from '../../config/dawn/merchant';
import type { DawnProgress } from './DawnProgress';

export function resolveDawnBranchCost(branchId: string, catalog: DawnMerchantCatalog = DAWN_MERCHANT): number | null {
  return catalog.upgrades.branches.find(entry => entry.branchId === branchId)?.price ?? null;
}

export function isDawnBranchResearched(progress: DawnProgress, branchId: string): boolean {
  return progress.unlockedBranchIds.includes(branchId);
}

export function canPurchaseDawnBranch(
  progress: DawnProgress, branchId: string, unlocked: boolean, catalog: DawnMerchantCatalog = DAWN_MERCHANT,
): boolean {
  const cost = resolveDawnBranchCost(branchId, catalog);
  return unlocked && cost !== null && !isDawnBranchResearched(progress, branchId) && progress.scrap >= cost;
}

/** Mutates only a fully valid, affordable personal purchase. */
export function purchaseDawnBranch(
  draft: DawnProgress, branchId: string, unlocked: boolean, catalog: DawnMerchantCatalog = DAWN_MERCHANT,
): boolean {
  if (!canPurchaseDawnBranch(draft, branchId, unlocked, catalog)) return false;
  draft.scrap -= resolveDawnBranchCost(branchId, catalog)!;
  draft.unlockedBranchIds = [...draft.unlockedBranchIds, branchId].sort();
  return true;
}

/** The next price; null means the catalog offers no further point. */
export function resolveDawnBossPointCost(purchasedBossPoints: number, catalog: DawnMerchantCatalog = DAWN_MERCHANT): number | null {
  return Number.isSafeInteger(purchasedBossPoints) && purchasedBossPoints >= 0
    ? catalog.upgrades.bossPointPrices[purchasedBossPoints] ?? null : null;
}

export function isDawnBossPointLimitReached(progress: DawnProgress, catalog: DawnMerchantCatalog = DAWN_MERCHANT): boolean {
  return resolveDawnBossPointCost(progress.purchasedBossPoints, catalog) === null;
}

export function canPurchaseDawnBossPoint(
  progress: DawnProgress, unlocked: boolean, catalog: DawnMerchantCatalog = DAWN_MERCHANT,
): boolean {
  const cost = resolveDawnBossPointCost(progress.purchasedBossPoints, catalog);
  return unlocked && cost !== null && progress.scrap >= cost;
}

export function purchaseDawnBossPoint(
  draft: DawnProgress, unlocked: boolean, catalog: DawnMerchantCatalog = DAWN_MERCHANT,
): boolean {
  if (!canPurchaseDawnBossPoint(draft, unlocked, catalog)) return false;
  draft.scrap -= resolveDawnBossPointCost(draft.purchasedBossPoints, catalog)!;
  draft.purchasedBossPoints += 1;
  return true;
}
