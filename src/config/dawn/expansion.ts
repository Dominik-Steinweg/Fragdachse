import authoredExpansion from './expansion.json';
import { PERSISTENT_BASE_CAMPAIGN_MAX_AREA_STAGE, PERSISTENT_BASE_MAX_AREA_STAGE } from '../../persistentBase/PersistentBaseCore';

export interface DawnExpansionConfig {
  readonly maxExpansionLevel: number;
  readonly constructionCapacityBonusPerStageAboveCampaign: number;
}

export function validateDawnExpansionConfig(value: unknown): asserts value is DawnExpansionConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('[dawn/expansion] Expected an expansion config object');
  }
  const config = value as Record<string, unknown>;
  for (const key of ['maxExpansionLevel', 'constructionCapacityBonusPerStageAboveCampaign'] as const) {
    if (typeof config[key] !== 'number' || !Number.isSafeInteger(config[key]) || config[key] < 0) {
      throw new Error(`[dawn/expansion] ${key} must be a non-negative safe integer`);
    }
  }
  if ((config.maxExpansionLevel as number) > PERSISTENT_BASE_MAX_AREA_STAGE - PERSISTENT_BASE_CAMPAIGN_MAX_AREA_STAGE) {
    throw new Error('[dawn/expansion] maxExpansionLevel exceeds supported area stages');
  }
}

validateDawnExpansionConfig(authoredExpansion);
export const DAWN_EXPANSION_CONFIG: Readonly<DawnExpansionConfig> = Object.freeze(authoredExpansion);
