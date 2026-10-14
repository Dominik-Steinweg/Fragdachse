import { describe, expect, it } from 'vitest';
import { DAWN_MERCHANT, type DawnInfrastructureId } from '../src/config/dawn/merchant';
import { createDefaultDawnProgress } from '../src/dawn/economy/DawnProgress';
import { freezeDawnInfrastructure, getDawnInfrastructureLevel, isDawnInfrastructureMaxed,
  purchaseDawnInfrastructure, resolveDawnInfrastructureCost } from '../src/dawn/economy/DawnMerchantInfrastructure';

describe('Dawn infrastructure purchases', () => {
  it.each(DAWN_MERCHANT.infrastructure)('buys every level of $id at its catalog price and stops at max', entry => {
    const draft = createDefaultDawnProgress();
    draft.scrap = entry.levelPrices.reduce((sum, price) => sum + price, 0);
    const other = createDefaultDawnProgress();
    expect(getDawnInfrastructureLevel(draft, entry.id)).toBe(0);
    entry.levelPrices.forEach((price, level) => {
      expect(isDawnInfrastructureMaxed(draft, entry.id)).toBe(false);
      expect(resolveDawnInfrastructureCost(draft, entry.id)).toBe(price);
      expect(purchaseDawnInfrastructure(draft, entry.id, true)).toBe(true);
      expect(getDawnInfrastructureLevel(draft, entry.id)).toBe(level + 1);
    });
    expect(draft.scrap).toBe(0);
    expect(isDawnInfrastructureMaxed(draft, entry.id)).toBe(true);
    expect(resolveDawnInfrastructureCost(draft, entry.id)).toBeNull();
    const before = structuredClone(draft);
    expect(purchaseDawnInfrastructure(draft, entry.id, true)).toBe(false);
    expect(draft).toEqual(before);
    expect(other).toEqual(createDefaultDawnProgress());
  });

  it('uses an injected catalog without changing the merchant contract', () => {
    const draft = createDefaultDawnProgress();
    draft.scrap = 7;
    const catalog = { ...DAWN_MERCHANT, infrastructure: [{ id: 'scrap-magnet' as const, levelPrices: [7, 11] }] };
    expect(purchaseDawnInfrastructure(draft, 'scrap-magnet', true, catalog)).toBe(true);
    expect(resolveDawnInfrastructureCost(draft, 'scrap-magnet', catalog)).toBe(11);
    expect(isDawnInfrastructureMaxed(draft, 'scrap-magnet', catalog)).toBe(false);
  });

  it.each([
    { scrap: 10000, level: 0, unlocked: false, id: 'repair-drones' },
    { scrap: 0, level: 0, unlocked: true, id: 'repair-drones' },
    { scrap: NaN, level: 0, unlocked: true, id: 'repair-drones' },
    { scrap: Infinity, level: 0, unlocked: true, id: 'repair-drones' },
    { scrap: 10000, level: -1, unlocked: true, id: 'repair-drones' },
    { scrap: 10000, level: 0.5, unlocked: true, id: 'repair-drones' },
    { scrap: 10000, level: 10, unlocked: true, id: 'repair-drones' },
    { scrap: 10000, level: 0, unlocked: true, id: 'unknown' },
  ])('rejects invalid or unavailable purchases atomically: %j', ({ scrap, level, unlocked, id }) => {
    const draft = createDefaultDawnProgress();
    draft.scrap = scrap; draft.infrastructure[id] = level;
    const before = structuredClone(draft);
    expect(purchaseDawnInfrastructure(draft, id as DawnInfrastructureId, unlocked)).toBe(false);
    expect(draft).toEqual(before);
  });

  it('freezes round input independently of later progress changes', () => {
    const progress = createDefaultDawnProgress();
    progress.infrastructure = { 'repair-drones': 2, 'scrap-magnet': 1, 'scrap-scanner': 1 };
    const frozen = freezeDawnInfrastructure(progress);
    progress.infrastructure['repair-drones'] = 3;
    progress.infrastructure['scrap-magnet'] = 0;
    expect(frozen).toEqual({ repairDrones: 2, scrapMagnet: 1, scrapScanner: 1 });
    expect(Object.isFrozen(frozen)).toBe(true);
  });
});
