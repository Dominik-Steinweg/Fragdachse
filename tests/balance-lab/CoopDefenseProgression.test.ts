import { describe, expect, it } from 'vitest';
import {
  getCoopDefenseLevelForXp,
  getCoopDefenseXpThresholdForLevel,
} from '../../src/utils/coopDefenseProgression';

describe('Coop defense XP progression', () => {
  it('starts at 20 XP and increases each level cost by 80 XP', () => {
    expect([1, 2, 3, 4, 5, 6].map(getCoopDefenseXpThresholdForLevel)).toEqual([
      0, 20, 120, 300, 560, 900,
    ]);
  });

  it('resolves values immediately below, on and above thresholds', () => {
    const thresholds = Array.from({ length: 100 }, (_, index) => getCoopDefenseXpThresholdForLevel(index + 1));
    thresholds.forEach((threshold, index) => {
      const level = index + 1;
      expect(getCoopDefenseLevelForXp(threshold)).toBe(level);
      expect(getCoopDefenseLevelForXp(threshold + 1)).toBe(level);
      if (threshold > 0) expect(getCoopDefenseLevelForXp(threshold - 1)).toBe(level - 1);
    });
  });
});
