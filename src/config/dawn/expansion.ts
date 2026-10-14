import authoredExpansion from './expansion.json';
import { PERSISTENT_BASE_CAMPAIGN_MAX_AREA_STAGE, PERSISTENT_BASE_MAX_AREA_STAGE } from '../../persistentBase/PersistentBaseCore';

export interface DawnExpansionConfig {
  readonly maxExpansionLevel: number;
  readonly constructionCapacityBonusPerStageAboveCampaign: number;
  /** Expansions 1..n grow the base radius by one cell each (area stage 2 + n, D-46). */
  readonly radiusExpansionLevels: number;
  /** Cumulative core HP bonus for the expansions after the radius track (threat 6..10). */
  readonly coreHpBonusByLevel: readonly number[];
}

export function validateDawnExpansionConfig(value: unknown): asserts value is DawnExpansionConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('[dawn/expansion] Expected an expansion config object');
  }
  const config = value as Record<string, unknown>;
  for (const key of ['maxExpansionLevel', 'constructionCapacityBonusPerStageAboveCampaign', 'radiusExpansionLevels'] as const) {
    if (typeof config[key] !== 'number' || !Number.isSafeInteger(config[key]) || config[key] < 0) {
      throw new Error(`[dawn/expansion] ${key} must be a non-negative safe integer`);
    }
  }
  // The radius stops at the last area stage (radius 10); later expansions reward core HP instead.
  if ((config.radiusExpansionLevels as number) !== PERSISTENT_BASE_MAX_AREA_STAGE - PERSISTENT_BASE_CAMPAIGN_MAX_AREA_STAGE
    || (config.radiusExpansionLevels as number) > (config.maxExpansionLevel as number)) {
    throw new Error('[dawn/expansion] radiusExpansionLevels must cover exactly the Dawn area stages');
  }
  const hp = config.coreHpBonusByLevel;
  if (!Array.isArray(hp) || hp.length !== (config.maxExpansionLevel as number) - (config.radiusExpansionLevels as number)
    || hp.some((value, index) => !Number.isSafeInteger(value) || value <= (index > 0 ? hp[index - 1] : 0) || value > 50_000)) {
    throw new Error('[dawn/expansion] coreHpBonusByLevel needs one strictly increasing cumulative bonus per later expansion');
  }
}

validateDawnExpansionConfig(authoredExpansion);
export const DAWN_EXPANSION_CONFIG: Readonly<DawnExpansionConfig> = Object.freeze(authoredExpansion);
