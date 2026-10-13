import {
  PERSISTENT_BASE_CAMPAIGN_MAX_AREA_STAGE,
  PERSISTENT_BASE_MAX_AREA_STAGE,
  type CampaignPersistentBaseAreaStage,
  type PersistentBaseAreaStage,
} from './PersistentBaseCore';

/** Personal progression is resolved before a World freezes its site-limited stage. */
export function resolvePersonalPersistentBaseAreaStage(input: {
  readonly campaignStage: CampaignPersistentBaseAreaStage;
  readonly dawnExpansionLevel: number;
}): PersistentBaseAreaStage {
  return input.dawnExpansionLevel > 0
    ? Math.min(PERSISTENT_BASE_MAX_AREA_STAGE,
      PERSISTENT_BASE_CAMPAIGN_MAX_AREA_STAGE + input.dawnExpansionLevel) as PersistentBaseAreaStage
    : input.campaignStage;
}

export function resolveFrozenPersistentBaseAreaStage(input: {
  readonly personalStage: PersistentBaseAreaStage;
  readonly siteMaxAreaStage: PersistentBaseAreaStage;
}): PersistentBaseAreaStage {
  return Math.min(input.personalStage, input.siteMaxAreaStage) as PersistentBaseAreaStage;
}
