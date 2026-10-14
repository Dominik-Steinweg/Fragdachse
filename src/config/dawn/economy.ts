import authored from './economy.json';
import { DAWN_MAX_EXPANSION_LEVEL } from '../../dawn/economy/DawnProgress';

export interface DawnEconomyRules {
  readonly expansionCosts: readonly number[];
  readonly defeatScrapShare: number;
}

/** Personal progression tuning, deliberately outside the scenario content hash. */
export function validateDawnEconomy(raw: unknown): DawnEconomyRules {
  const value = raw as Partial<DawnEconomyRules> | null;
  if (!value || !Array.isArray(value.expansionCosts)
    || value.expansionCosts.length !== DAWN_MAX_EXPANSION_LEVEL
    || !value.expansionCosts.every(cost => Number.isSafeInteger(cost) && cost > 0)
    || typeof value.defeatScrapShare !== 'number' || !Number.isFinite(value.defeatScrapShare)
    || value.defeatScrapShare < 0 || value.defeatScrapShare > 1) {
    throw new Error('[DawnEconomy] Invalid economy rules');
  }
  return Object.freeze({ expansionCosts: Object.freeze([...value.expansionCosts]), defeatScrapShare: value.defeatScrapShare });
}

export const DAWN_ECONOMY = validateDawnEconomy(authored);
