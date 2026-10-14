import { describe, expect, it } from 'vitest';
import { resolveFrozenPersistentBaseAreaStage, resolvePersonalPersistentBaseAreaStage } from '../src/persistentBase/PersistentBaseAreaStageResolution';
import { resolvePersistentBaseConstructionCapacityBonus } from '../src/persistentBase/PersistentBaseConstructionCapacity';
import { DAWN_EXPANSION_CONFIG, validateDawnExpansionConfig } from '../src/config/dawn/expansion';
import { PERSISTENT_BASE_AREA_STAGES, PERSISTENT_BASE_CAMPAIGN_MAX_AREA_STAGE, PERSISTENT_BASE_MAX_AREA_STAGE } from '../src/persistentBase/PersistentBaseCore';

describe('personal progression and World freeze', () => {
  it.each([0, 1, 2] as const)('preserves campaign stage %s without Dawn expansion', campaignStage => {
    expect(resolvePersonalPersistentBaseAreaStage({ campaignStage, dawnExpansionLevel: 0 })).toBe(campaignStage);
  });
  it.each([1, 3, DAWN_EXPANSION_CONFIG.maxExpansionLevel, 100])('resolves expansion %s above the campaign maximum and caps it', dawnExpansionLevel => {
    expect(resolvePersonalPersistentBaseAreaStage({ campaignStage: 0, dawnExpansionLevel }))
      .toBe(Math.min(PERSISTENT_BASE_MAX_AREA_STAGE, PERSISTENT_BASE_CAMPAIGN_MAX_AREA_STAGE + dawnExpansionLevel));
  });
  it.each([[0, 11, 0], [2, 6, 2], [11, 2, 2], [11, 6, 6], [11, 11, 11]] as const)
    ('freezes personal stage %s at site ceiling %s', (personalStage, siteMaxAreaStage, expected) => {
      expect(resolveFrozenPersistentBaseAreaStage({ personalStage, siteMaxAreaStage })).toBe(expected);
    });
  it.each(PERSISTENT_BASE_AREA_STAGES)('derives capacity from frozen stage %s and authored tuning', frozenStage => {
    expect(resolvePersistentBaseConstructionCapacityBonus(frozenStage)).toBe(
      Math.max(0, frozenStage - PERSISTENT_BASE_CAMPAIGN_MAX_AREA_STAGE)
      * DAWN_EXPANSION_CONFIG.constructionCapacityBonusPerStageAboveCampaign);
  });
});

describe('Dawn expansion config validation', () => {
  it('loads authored tuning and accepts alternative supported tuning', () => {
    expect(() => validateDawnExpansionConfig(DAWN_EXPANSION_CONFIG)).not.toThrow();
    expect(() => validateDawnExpansionConfig({ maxExpansionLevel: 6, constructionCapacityBonusPerStageAboveCampaign: 7,
      radiusExpansionLevels: 4, coreHpBonusByLevel: [100, 300] })).not.toThrow();
  });
  it('ends the radius at stage 6 and needs a strictly increasing core HP table for the rest (D-46)', () => {
    const base = { maxExpansionLevel: 6, constructionCapacityBonusPerStageAboveCampaign: 2, radiusExpansionLevels: 4 };
    for (const coreHpBonusByLevel of [[100], [100, 100], [300, 100], [100, 300, 500]]) {
      expect(() => validateDawnExpansionConfig({ ...base, coreHpBonusByLevel }), JSON.stringify(coreHpBonusByLevel)).toThrow();
    }
    expect(() => validateDawnExpansionConfig({ ...base, radiusExpansionLevels: 5, coreHpBonusByLevel: [100] })).toThrow();
  });
  it.each([null, [], {}, { maxExpansionLevel: 100, constructionCapacityBonusPerStageAboveCampaign: 1 },
    { maxExpansionLevel: -1, constructionCapacityBonusPerStageAboveCampaign: 1 },
    { maxExpansionLevel: 1.5, constructionCapacityBonusPerStageAboveCampaign: 1 },
    { maxExpansionLevel: 1, constructionCapacityBonusPerStageAboveCampaign: NaN },
    { maxExpansionLevel: 1, constructionCapacityBonusPerStageAboveCampaign: -1 }])('rejects malformed config %j', config => {
    expect(() => validateDawnExpansionConfig(config)).toThrow();
  });
});
