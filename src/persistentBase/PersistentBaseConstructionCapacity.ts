import { DAWN_EXPANSION_CONFIG } from '../config/dawn/expansion';
import { PERSISTENT_BASE_CAMPAIGN_MAX_AREA_STAGE, type PersistentBaseAreaStage } from './PersistentBaseCore';

/** Uses the frozen World stage, never the owner's uncapped personal progression. */
export function resolvePersistentBaseConstructionCapacityBonus(frozenStage: PersistentBaseAreaStage): number {
  return Math.max(0, frozenStage - PERSISTENT_BASE_CAMPAIGN_MAX_AREA_STAGE)
    * DAWN_EXPANSION_CONFIG.constructionCapacityBonusPerStageAboveCampaign;
}
