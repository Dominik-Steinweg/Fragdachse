import { describe, expect, it } from 'vitest';
import {
  getCoopDefenseLevelForXp,
  getCoopDefenseXpThresholdForLevel,
} from '../src/utils/coopDefenseProgression';

describe('Coop defense XP progression', () => {
  it('starts at 10 XP and increases each level cost by 25 XP', () => {
    expect([1, 2, 3, 4, 5, 6].map(getCoopDefenseXpThresholdForLevel)).toEqual([
      0, 10, 45, 105, 190, 300,
    ]);
  });

  it('resolves values immediately below, on and above thresholds', () => {
    const thresholds = [0, 10, 45, 105, 190, 300];
    thresholds.forEach((threshold, index) => {
      const level = index + 1;
      expect(getCoopDefenseLevelForXp(threshold)).toBe(level);
      expect(getCoopDefenseLevelForXp(threshold + 1)).toBe(level);
      if (threshold > 0) expect(getCoopDefenseLevelForXp(threshold - 1)).toBe(level - 1);
    });
  });
});
