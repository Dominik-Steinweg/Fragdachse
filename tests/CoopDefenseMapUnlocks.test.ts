import { describe, expect, it, vi } from 'vitest';
import { COOP_DEFENSE_MAP_CONFIGS } from '../src/config/coopDefenseMaps';
import {
  getCoopDefenseMapUnlockedByVictoryOn,
  COOP_DEFENSE_UNRELEASED_MAP_IDS,
  getHighestAvailableCoopDefenseMapId,
  getUnlockedCoopDefenseMapConfigs,
  INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID,
  isCoopDefenseMapUnlocked,
  maxHighestUnlockedCoopDefenseMapId,
  sanitizeHighestUnlockedCoopDefenseMapId,
} from '../src/config/coopDefenseMapUnlocks';

const LAST_MAP_ID = COOP_DEFENSE_MAP_CONFIGS[COOP_DEFENSE_MAP_CONFIGS.length - 1].mapId;

describe('Coop defense map unlocks', () => {
  it('keeps unfinished-map debug access independent and resets it with a new session', async () => {
    vi.resetModules();
    const session = await import('../src/utils/coopDefenseDebugSession');
    expect(session.areCoopDefenseUnreleasedMapsUnlocked()).toBe(false);
    session.unlockCoopDefenseUnreleasedMaps();
    expect(session.areCoopDefenseUnreleasedMapsUnlocked()).toBe(true);
    expect(session.isCoopDefenseTestMapUnlocked()).toBe(false);
    vi.resetModules();
    const reloaded = await import('../src/utils/coopDefenseDebugSession');
    expect(reloaded.areCoopDefenseUnreleasedMapsUnlocked()).toBe(false);
    reloaded.unlockCoopDefenseTestMap();
    expect(reloaded.areCoopDefenseUnreleasedMapsUnlocked()).toBe(false);
    vi.resetModules();
  });

  it('gives a new player map 1 only', () => {
    const unlockedMapIds = getUnlockedCoopDefenseMapConfigs(INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID)
      .map((mapConfig) => mapConfig.mapId);
    expect(unlockedMapIds).toEqual(['1']);
  });

  it('requires explicit debug access to the test map regardless of campaign progress', () => {
    for (const progress of [INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID, LAST_MAP_ID]) {
      expect(isCoopDefenseMapUnlocked('0', progress)).toBe(false);
      expect(isCoopDefenseMapUnlocked('0', progress, true)).toBe(true);
      expect(getUnlockedCoopDefenseMapConfigs(progress, true).map(map => map.mapId))
        .toEqual(['0', ...getUnlockedCoopDefenseMapConfigs(progress).map(map => map.mapId)]);
    }
    expect(isCoopDefenseMapUnlocked(LAST_MAP_ID, INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID, true)).toBe(false);
    expect(sanitizeHighestUnlockedCoopDefenseMapId('0')).toBe(INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID);
  });

  it('unlocks the next map in registry order after a victory and stops at the campaign end', () => {
    for (let index = 0; index < COOP_DEFENSE_MAP_CONFIGS.length - 1; index += 1) {
      expect(getCoopDefenseMapUnlockedByVictoryOn(COOP_DEFENSE_MAP_CONFIGS[index].mapId))
        .toBe(COOP_DEFENSE_UNRELEASED_MAP_IDS.includes(COOP_DEFENSE_MAP_CONFIGS[index + 1].mapId)
          ? null : COOP_DEFENSE_MAP_CONFIGS[index + 1].mapId);
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

  it('keeps map 17 as the final campaign map and rejects removed maps', () => {
    expect(LAST_MAP_ID).toBe('17');
    expect(sanitizeHighestUnlockedCoopDefenseMapId('17')).toBe('17');
    expect(getCoopDefenseMapUnlockedByVictoryOn('17')).toBeNull();
    expect(sanitizeHighestUnlockedCoopDefenseMapId('18')).toBe(INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID);
    expect(getCoopDefenseMapUnlockedByVictoryOn('18')).toBeNull();
    expect(getCoopDefenseMapUnlockedByVictoryOn('19')).toBeNull();
  });

  it('unlocks every earlier map once a late map is reached', () => {
    const unlockedMapIds = getUnlockedCoopDefenseMapConfigs(LAST_MAP_ID).map((mapConfig) => mapConfig.mapId);
    expect(unlockedMapIds).toEqual(COOP_DEFENSE_MAP_CONFIGS
      .filter(map => map.mapId !== '0' && !COOP_DEFENSE_UNRELEASED_MAP_IDS.includes(map.mapId)).map(map => map.mapId));
  });

  it.each(['16', '17'])('preserves saved progress %s but selects only released maps', highest => {
    expect(sanitizeHighestUnlockedCoopDefenseMapId(highest)).toBe(highest);
    expect(getHighestAvailableCoopDefenseMapId(highest)).toBe('15');
    expect(isCoopDefenseMapUnlocked(highest, highest)).toBe(false);
    expect(getCoopDefenseMapUnlockedByVictoryOn('15')).toBeNull();
  });

  it('offers unfinished maps only through their independent debug override', () => {
    const ids = getUnlockedCoopDefenseMapConfigs('1', false, true).map(map => map.mapId);
    expect(ids).toEqual(['1', ...COOP_DEFENSE_UNRELEASED_MAP_IDS]);
    for (const id of COOP_DEFENSE_UNRELEASED_MAP_IDS) {
      expect(isCoopDefenseMapUnlocked(id, LAST_MAP_ID, true)).toBe(false);
      expect(isCoopDefenseMapUnlocked(id, '1', false, true)).toBe(true);
      expect(COOP_DEFENSE_MAP_CONFIGS.some(map => map.mapId === id)).toBe(true);
    }
    expect(isCoopDefenseMapUnlocked('0', '1', false, true)).toBe(false);
  });
});
