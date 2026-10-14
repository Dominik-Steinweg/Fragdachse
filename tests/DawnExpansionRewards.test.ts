import { describe, expect, it } from 'vitest';
import { DAWN_EXPANSION_CONFIG } from '../src/config/dawn/expansion';
import {
  DAWN_EXPANSION_PLASMA_TURRET_REWARDS, resolveDawnExpansionCoreHpBonus, resolveDawnExpansionReward, resolveDawnExpansionRewardUnlocks,
} from '../src/dawn/economy/DawnExpansionRewards';
import { resolvePersonalPersistentBaseAreaStage } from '../src/persistentBase/PersistentBaseAreaStageResolution';
import { resolvePersistentBaseBuildAreaForStage } from '../src/persistentBase/PersistentBaseCore';
import { resolvePersistentBaseConstructionCapacityBonus } from '../src/persistentBase/PersistentBaseConstructionCapacity';
import { resolvePersistentBaseMaxHp } from '../src/persistentBase/PersistentBaseHealth';
import { isKnownPersistentBaseRewardId } from '../src/persistentBase/PersistentBaseRewardCatalog';
import { resolveDawnThreat } from '../src/dawn/rules/DawnThreat';

describe('Dawn expansion track (D-46)', () => {
  it('grows the radius to 10 by threat 5 and never beyond', () => {
    const radius = (level: number) => {
      const area = resolvePersistentBaseBuildAreaForStage(resolvePersonalPersistentBaseAreaStage({ campaignStage: 2, dawnExpansionLevel: level }));
      return area.kind === 'radius' ? area.radiusCells : 0;
    };
    expect([1, 2, 3, 4].map(radius)).toEqual([7, 8, 9, 10]);
    for (let level = 4; level <= DAWN_EXPANSION_CONFIG.maxExpansionLevel; level++) expect(radius(level), `level ${level}`).toBe(10);
    expect(resolveDawnThreat(4)).toBe(5);
  });

  it('keeps capacity on the frozen area stage: it grows until threat 5 and stops', () => {
    const capacity = (level: number) => resolvePersistentBaseConstructionCapacityBonus(
      resolvePersonalPersistentBaseAreaStage({ campaignStage: 2, dawnExpansionLevel: level }));
    expect(capacity(4)).toBeGreaterThan(capacity(3));
    expect(capacity(DAWN_EXPANSION_CONFIG.maxExpansionLevel)).toBe(capacity(4));
  });

  it('rewards every later expansion with noticeable core HP and one more plasma turret placeholder', () => {
    expect(resolveDawnExpansionReward(4)).toMatchObject({ kind: 'radius', radiusCells: 10 });
    let previous = 0;
    for (let level = 5; level <= DAWN_EXPANSION_CONFIG.maxExpansionLevel; level++) {
      const reward = resolveDawnExpansionReward(level);
      expect(reward?.kind, `level ${level}`).toBe('core');
      const total = resolveDawnExpansionCoreHpBonus(level);
      // Each step is noticeable against the 2500 HP core.
      expect(total - previous, `level ${level}`).toBeGreaterThanOrEqual(500);
      previous = total;
      expect(resolveDawnExpansionRewardUnlocks(level)).toHaveLength(level - 4);
    }
    expect(resolveDawnExpansionCoreHpBonus(4)).toBe(0);
    expect(resolveDawnExpansionRewardUnlocks(4)).toEqual([]);
    expect(resolveDawnExpansionCoreHpBonus(99)).toBe(resolveDawnExpansionCoreHpBonus(DAWN_EXPANSION_CONFIG.maxExpansionLevel));
    expect(DAWN_EXPANSION_PLASMA_TURRET_REWARDS.every(isKnownPersistentBaseRewardId)).toBe(true);
    expect(resolvePersistentBaseMaxHp([], resolveDawnExpansionCoreHpBonus(9))).toBe(2500 + resolveDawnExpansionCoreHpBonus(9));
  });
});

describe('Base editor expansion preview (D-46)', () => {
  it('draws the ring only while the radius grows and shows the core reward as text afterwards', async () => {
    const { buildPersistentBaseExpansionPreview } = await import('../src/persistentBase/PersistentBaseExpansionPreview');
    const ring = buildPersistentBaseExpansionPreview({ expansionLevel: 3 }, 2, true, 6);
    expect(ring).toMatchObject({ radius: 10, reward: { kind: 'radius', radiusCells: 10 } });
    expect(ring!.edges.length).toBeGreaterThan(0);
    const core = buildPersistentBaseExpansionPreview({ expansionLevel: 4 }, 2, true, 6);
    expect(core).toMatchObject({ radius: 10, reward: { kind: 'core' } });
    expect(core!.edges).toEqual([]);
  });
});
