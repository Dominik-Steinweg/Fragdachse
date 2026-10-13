import { resolveDawnExpansionCost } from '../dawn/economy/DawnEconomy';
import type { DawnProgress } from '../dawn/economy/DawnProgress';
import { resolveDawnThreat } from '../dawn/rules/DawnThreat';
import { resolvePersonalPersistentBaseAreaStage } from '../persistentBase/PersistentBaseAreaStageResolution';
import { resolvePersistentBaseBuildAreaForStage, type CampaignPersistentBaseAreaStage } from '../persistentBase/PersistentBaseCore';

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
    cost, canBuy: unlocked && cost !== null && progress.scrap >= cost,
  };
}
