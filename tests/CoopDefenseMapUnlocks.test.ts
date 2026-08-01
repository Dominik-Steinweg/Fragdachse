import { describe, expect, it } from 'vitest';
import { COOP_DEFENSE_MAP_CONFIGS } from '../src/config/coopDefenseMaps';
import {
  getCoopDefenseMapUnlockedByVictoryOn,
  getUnlockedCoopDefenseMapConfigs,
  INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID,
  isCoopDefenseMapUnlocked,
  maxHighestUnlockedCoopDefenseMapId,
  sanitizeHighestUnlockedCoopDefenseMapId,
} from '../src/config/coopDefenseMapUnlocks';

const LAST_MAP_ID = COOP_DEFENSE_MAP_CONFIGS[COOP_DEFENSE_MAP_CONFIGS.length - 1].mapId;

describe('Coop defense map unlocks', () => {
  it('gives a new player the test map and map 1 only', () => {
    const unlockedMapIds = getUnlockedCoopDefenseMapConfigs(INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID)
      .map((mapConfig) => mapConfig.mapId);
    expect(unlockedMapIds).toEqual(['0', '1']);
  });

  it('keeps the test map unlocked regardless of progress', () => {
    expect(isCoopDefenseMapUnlocked('0', INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID)).toBe(true);
  });

  it('unlocks the next map in registry order after a victory and stops at the campaign end', () => {
    for (let index = 0; index < COOP_DEFENSE_MAP_CONFIGS.length - 1; index += 1) {
      expect(getCoopDefenseMapUnlockedByVictoryOn(COOP_DEFENSE_MAP_CONFIGS[index].mapId))
        .toBe(COOP_DEFENSE_MAP_CONFIGS[index + 1].mapId);
    }
    expect(getCoopDefenseMapUnlockedByVictoryOn(LAST_MAP_ID)).toBeNull();
    expect(getCoopDefenseMapUnlockedByVictoryOn('__cheat_boss_point_1')).toBeNull();
  });

  it('never lowers the unlock level and never trusts unknown ids', () => {
    expect(maxHighestUnlockedCoopDefenseMapId('3', '2')).toBe('3');
    expect(maxHighestUnlockedCoopDefenseMapId('2', '3')).toBe('3');
    expect(sanitizeHighestUnlockedCoopDefenseMapId('nope')).toBe(INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID);
    expect(sanitizeHighestUnlockedCoopDefenseMapId(undefined)).toBe(INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID);
  });

  it('keeps map 16 as the final campaign map', () => {
    expect(LAST_MAP_ID).toBe('16');
    expect(sanitizeHighestUnlockedCoopDefenseMapId('16')).toBe('16');
    expect(getCoopDefenseMapUnlockedByVictoryOn('16')).toBeNull();
  });

  it('unlocks every earlier map once a late map is reached', () => {
    const unlockedMapIds = getUnlockedCoopDefenseMapConfigs(LAST_MAP_ID).map((mapConfig) => mapConfig.mapId);
    expect(unlockedMapIds).toEqual(COOP_DEFENSE_MAP_CONFIGS.map((mapConfig) => mapConfig.mapId));
  });
});
