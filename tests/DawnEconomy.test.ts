import { describe, expect, it } from 'vitest';
import { DAWN_ECONOMY, validateDawnEconomy } from '../src/config/dawn/economy';
import { applyDawnRoundProgress, purchaseDawnExpansion, resolveDawnExpansionCost, resolveDawnRoundScrap } from '../src/dawn/economy/DawnEconomy';
import { createDefaultDawnProgress, DAWN_MAX_EXPANSION_LEVEL, DAWN_MAX_SCRAP } from '../src/dawn/economy/DawnProgress';
import { buildDawnMerchantModel } from '../src/ui/DawnMerchantModel';
import { resolveDawnThreat } from '../src/dawn/rules/DawnThreat';
import { getStoredCoopDefenseProgress, getStoredDawnProgress, getStoredPersonalPersistentBaseAreaStage,
  restoreStoredCoopDefenseProgress, updateStoredDawnProgress } from '../src/utils/localPreferences';
import { DAWN_UNLOCK_AFTER_MAP_ID, isDawnUnlocked } from '../src/dawn/rules/DawnUnlock';

describe('Dawn economy', () => {
  it('validates the entire personal rules document', () => {
    expect(validateDawnEconomy(DAWN_ECONOMY)).toEqual(DAWN_ECONOMY);
    for (const raw of [null, {}, { ...DAWN_ECONOMY, expansionCosts: [1] },
      { ...DAWN_ECONOMY, expansionCosts: DAWN_ECONOMY.expansionCosts.map(() => -1) },
      ...[-1, 2, NaN].map(defeatScrapShare => ({ ...DAWN_ECONOMY, defeatScrapShare }))]) {
      expect(() => validateDawnEconomy(raw)).toThrow();
    }
  });

  it('credits only completed outcomes and floors fractional scrap after the configured share', () => {
    const rules = { expansionCosts: [], defeatScrapShare: 0.5 };
    expect(resolveDawnRoundScrap({ sharedScrap: 101, outcome: 'victory' }, rules)).toBe(101);
    expect(resolveDawnRoundScrap({ sharedScrap: 101, outcome: 'defeat' }, rules)).toBe(50);
    expect(resolveDawnRoundScrap({ sharedScrap: 100, outcome: 'defeat' }, { ...rules, defeatScrapShare: 0.3 })).toBe(30);
    for (const outcome of ['active', 'aborted']) expect(resolveDawnRoundScrap({ sharedScrap: 100, outcome }, rules)).toBe(0);
    for (const sharedScrap of [-1, NaN, Infinity]) expect(resolveDawnRoundScrap({ sharedScrap, outcome: 'victory' }, rules)).toBe(0);
  });

  it('preserves the best consecutive victory streak across defeats and caps stored scrap', () => {
    const progress = createDefaultDawnProgress();
    for (const outcome of ['victory', 'victory', 'defeat', 'victory']) applyDawnRoundProgress(progress, 0, outcome);
    expect(progress.stats).toEqual({ roundsPlayed: 4, victories: 3, defeats: 1, currentStreak: 1, bestStreak: 2 });
    progress.scrap = DAWN_MAX_SCRAP - 3;
    expect(applyDawnRoundProgress(progress, 10, 'victory')).toBe(3);
    expect(progress.scrap).toBe(DAWN_MAX_SCRAP);
    const saved = structuredClone(progress);
    applyDawnRoundProgress(progress, 10, 'aborted');
    expect(progress).toEqual(saved);
  });

  it('uses authored costs for every purchase and rejects locked, unaffordable and maximal expansion', () => {
    const progress = createDefaultDawnProgress();
    for (let level = 0; level < DAWN_MAX_EXPANSION_LEVEL; level++) {
      const cost = resolveDawnExpansionCost(level)!;
      expect(cost).toBe(DAWN_ECONOMY.expansionCosts[level]);
      progress.scrap = cost - 1;
      expect(buildDawnMerchantModel(progress, 2, true).canBuy).toBe(false);
      expect(purchaseDawnExpansion(progress, true)).toBe(false);
      progress.scrap = cost;
      expect(purchaseDawnExpansion(progress, false)).toBe(false);
      expect(buildDawnMerchantModel(progress, 2, true)).toMatchObject({ cost, canBuy: true,
        threat: resolveDawnThreat(level), nextThreat: resolveDawnThreat(level + 1) });
      expect(buildDawnMerchantModel(progress, 2, false)).toMatchObject({ canBuy: false,
        nextThreat: resolveDawnThreat(level + 1) });
      expect(purchaseDawnExpansion(progress, true)).toBe(true);
      expect(progress).toMatchObject({ scrap: 0, expansionLevel: level + 1 });
    }
    progress.scrap = DAWN_MAX_SCRAP;
    expect(resolveDawnExpansionCost(progress.expansionLevel)).toBeNull();
    expect(purchaseDawnExpansion(progress, true)).toBe(false);
    expect(buildDawnMerchantModel(progress, 2, true)).toMatchObject({ canBuy: false, cost: null, nextThreat: null });
  });

  it('persists an unlocked purchase and exposes the new personal stage without a world mutation', () => {
    const saved = getStoredCoopDefenseProgress();
    try {
      restoreStoredCoopDefenseProgress({ ...saved, completedMapIds: [DAWN_UNLOCK_AFTER_MAP_ID], persistentBaseAreaStage: 2,
        dawn: { ...createDefaultDawnProgress(), scrap: resolveDawnExpansionCost(0)! } });
      const oldStage = getStoredPersonalPersistentBaseAreaStage();
      updateStoredDawnProgress(draft => { purchaseDawnExpansion(draft, isDawnUnlocked(getStoredCoopDefenseProgress())); });
      expect(getStoredDawnProgress()).toMatchObject({ scrap: 0, expansionLevel: 1 });
      expect(getStoredPersonalPersistentBaseAreaStage()).toBe(oldStage + 1);
    } finally { restoreStoredCoopDefenseProgress(saved); }
  });
});
