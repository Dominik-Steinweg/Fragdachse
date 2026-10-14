import { DAWN_ECONOMY, type DawnEconomyRules } from '../../config/dawn/economy';
import { DAWN_MAX_SCRAP, type DawnProgress } from './DawnProgress';

export function resolveDawnRoundScrap(
  { sharedScrap, outcome }: { sharedScrap: number; outcome: string },
  rules: DawnEconomyRules = DAWN_ECONOMY,
): number {
  if (!Number.isFinite(sharedScrap) || sharedScrap <= 0) return 0;
  const share = outcome === 'victory' ? 1 : outcome === 'defeat' ? rules.defeatScrapShare : 0;
  return Math.min(DAWN_MAX_SCRAP, Math.floor(sharedScrap * share));
}

/** Cost of advancing from the current level; null means no further expansion. */
export function resolveDawnExpansionCost(level: number, rules: DawnEconomyRules = DAWN_ECONOMY): number | null {
  return Number.isSafeInteger(level) && level >= 0 ? rules.expansionCosts[level] ?? null : null;
}

/** Mutates a persistence draft only when the entire purchase is affordable and unlocked. */
export function purchaseDawnExpansion(draft: DawnProgress, unlocked: boolean): boolean {
  const cost = resolveDawnExpansionCost(draft.expansionLevel);
  if (!unlocked || cost === null || draft.scrap < cost) return false;
  draft.scrap -= cost;
  draft.expansionLevel += 1;
  return true;
}

export function applyDawnRoundProgress(draft: DawnProgress, sharedScrap: number, outcome: string): number {
  if (outcome !== 'victory' && outcome !== 'defeat') return 0;
  const credited = Math.min(DAWN_MAX_SCRAP - draft.scrap, resolveDawnRoundScrap({ sharedScrap, outcome }));
  draft.scrap += credited;
  draft.stats.roundsPlayed += 1;
  if (outcome === 'victory') {
    draft.stats.victories += 1;
    draft.stats.currentStreak += 1;
    draft.stats.bestStreak = Math.max(draft.stats.bestStreak, draft.stats.currentStreak);
  } else {
    draft.stats.defeats += 1;
    draft.stats.currentStreak = 0;
  }
  return credited;
}
