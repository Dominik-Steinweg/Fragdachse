import { describe, expect, it } from 'vitest';
import {
  buildDefaultCoopDefenseUpgradeProfile,
  canLevelDownCoopDefenseUpgrade,
  canLevelUpCoopDefenseUpgrade,
  COOP_DEFENSE_UPGRADE_DEFINITIONS,
  getCoopDefenseUpgradeLoadoutSelection,
  getSpentCoopDefenseBossPoints,
  getSpentCoopDefenseUpgradePoints,
  levelUpCoopDefenseUpgrade,
} from '../src/utils/coopDefenseUpgrades';
import { resolveLoadoutSelectionIds } from '../src/loadout/LoadoutRules';
import { ULTIMATE_CONFIGS } from '../src/loadout/LoadoutConfig';

describe('coop-defense upgrade loadout selection', () => {
  it('keeps Holo equipped after buying Bomber and makes its free root non-refundable', () => {
    const classId = 'inspector_gadachs';
    const profile = buildDefaultCoopDefenseUpgradeProfile(classId);
    expect(canLevelDownCoopDefenseUpgrade(profile, 'unlock_holo_offensive', classId)).toBe(false);
    expect(getSpentCoopDefenseUpgradePoints(profile, classId)).toBe(0);
    const unlock = COOP_DEFENSE_UPGRADE_DEFINITIONS.unlock_bomber_squadron;
    const purchased = levelUpCoopDefenseUpgrade(profile, unlock.id, 1 + unlock.costPerLevel, 0, classId)!;
    expect(purchased).not.toBeNull();
    expect(getSpentCoopDefenseUpgradePoints(purchased, classId)).toBe(unlock.costPerLevel);
    expect(resolveLoadoutSelectionIds({ ultimate: ULTIMATE_CONFIGS.HOLO_OFFENSIVE }, 'coop_defense', purchased, classId).ultimate)
      .toBe('HOLO_OFFENSIVE');
    expect(resolveLoadoutSelectionIds({ ultimate: ULTIMATE_CONFIGS.BOMBER_SQUADRON }, 'coop_defense', purchased, classId).ultimate)
      .toBe('BOMBER_SQUADRON');
  });

  it('requires both Bomber branches and a boss point for the second pass', () => {
    const classId = 'inspector_gadachs';
    const definitions = COOP_DEFENSE_UPGRADE_DEFINITIONS;
    const boss = definitions.bomber_squadron_second_pass;
    const purchases = ['unlock_bomber_squadron', 'bomber_squadron_size', 'bomber_squadron_bomb_count', 'bomber_squadron_fire_chunks'];
    const level = 1 + purchases.reduce((sum, id) => sum + definitions[id].costPerLevel, 0);
    for (const omitted of ['bomber_squadron_size', 'bomber_squadron_fire_chunks', null]) {
      let profile = buildDefaultCoopDefenseUpgradeProfile(classId);
      for (const id of purchases.filter(id => id !== omitted)) {
        profile = levelUpCoopDefenseUpgrade(profile, id, level, boss.bossPointCostPerLevel, classId)!;
        expect(profile).not.toBeNull();
      }
      expect(canLevelUpCoopDefenseUpgrade(profile, boss.id, level, 0, classId)).toBe(false);
      expect(canLevelUpCoopDefenseUpgrade(profile, boss.id, level, boss.bossPointCostPerLevel, classId)).toBe(omitted === null);
      if (omitted !== null) continue;
      const next = levelUpCoopDefenseUpgrade(profile, boss.id, level, boss.bossPointCostPerLevel, classId)!;
      expect(getSpentCoopDefenseUpgradePoints(next, classId)).toBe(getSpentCoopDefenseUpgradePoints(profile, classId));
      expect(getSpentCoopDefenseBossPoints(next, classId)).toBe(boss.bossPointCostPerLevel);
    }
  });

  it('resolves a follow-up upgrade to the unlocked item', () => {
    expect(getCoopDefenseUpgradeLoadoutSelection('glock_adrenaline_gain')).toEqual({
      slot: 'weapon1',
      itemId: 'GLOCK',
    });
  });

  it('does not select an item for general upgrades', () => {
    expect(getCoopDefenseUpgradeLoadoutSelection('dash_range')).toBeNull();
  });
});
