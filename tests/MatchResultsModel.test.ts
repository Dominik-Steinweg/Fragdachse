import { describe, expect, it } from 'vitest';
import type { RoundResult, RoundState } from '../src/network/NetworkBridge';
import {
  createMatchItemRewardPresentation,
  createMatchProgressDelta,
  resolvePersonalMatchOutcome,
  sortMatchLeaderboard,
} from '../src/ui/MatchResultsModel';
import { getCoopDefenseProgressSnapshot } from '../src/utils/coopDefenseProgression';
import { COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT } from '../src/config/coopDefenseItems';
import type { CoopDefenseItem } from '../src/types';

function result(
  id: string,
  frags: number,
  teamId: RoundResult['teamId'] = null,
  teamScore?: number,
): RoundResult {
  return {
    id,
    name: id,
    colorHex: 0xffffff,
    frags,
    teamId,
    teamScore,
    roundEndedAt: 100,
    gameMode: 'deathmatch',
    mapName: 'Zufallsarena',
  };
}

describe('MatchResultsModel', () => {
  it('resolves a unique free-for-all winner and a tied draw personally', () => {
    expect(resolvePersonalMatchOutcome(
      'deathmatch',
      'p1',
      [result('p1', 8), result('p2', 5)],
      null,
    )).toBe('victory');

    expect(resolvePersonalMatchOutcome(
      'deathmatch',
      'p1',
      [result('p1', 8), result('p2', 8)],
      null,
    )).toBe('draw');

    expect(resolvePersonalMatchOutcome(
      'deathmatch',
      'p3',
      [result('p1', 8), result('p3', 2)],
      null,
    )).toBe('defeat');
  });

  it('uses authoritative team scores and supports a draw', () => {
    const blue = result('blue-player', 2, 'blue', 3);
    const red = result('red-player', 9, 'red', 2);
    expect(resolvePersonalMatchOutcome('capture_the_beer', blue.id, [blue, red], null)).toBe('victory');
    expect(resolvePersonalMatchOutcome('capture_the_beer', red.id, [blue, red], null)).toBe('defeat');

    blue.teamScore = 2;
    expect(resolvePersonalMatchOutcome('capture_the_beer', blue.id, [blue, red], null)).toBe('draw');
  });

  it('prefers the authoritative coop conclusion and host abort', () => {
    const player = result('p1', 0, 'blue');
    const victory: RoundState = { status: 'victory', roundStartTime: 0, endedAt: 100 };
    const aborted: RoundState = { status: 'aborted', roundStartTime: 0, endedAt: 100 };
    expect(resolvePersonalMatchOutcome('coop_defense', player.id, [player], victory)).toBe('victory');
    expect(resolvePersonalMatchOutcome('coop_defense', player.id, [player], aborted)).toBe('aborted');
  });

  it('sorts deterministically and computes multiple level-up rewards', () => {
    expect(sortMatchLeaderboard([
      result('p2', 5),
      result('p1', 10),
      result('p3', 5),
    ]).map((entry) => entry.id)).toEqual(['p1', 'p2', 'p3']);

    const before = getCoopDefenseProgressSnapshot(0);
    const after = getCoopDefenseProgressSnapshot(100);
    const delta = createMatchProgressDelta(before, after, 100, 'Map 2');
    const levelUps = delta.after.level - delta.before.level;
    expect(levelUps).toBeGreaterThan(1);
    expect(delta.newSkillPoints).toBe(levelUps);
    expect(delta.unlockedMapName).toBe('Map 2');
    expect(delta.classesUnlocked).toBe(false);
  });

  it('reports the class reward only on the locked-to-unlocked transition', () => {
    const before = getCoopDefenseProgressSnapshot(0, undefined, 0, 'dachs_nukem', false);
    const after = getCoopDefenseProgressSnapshot(0, undefined, 0, 'dachs_nukem', true);
    expect(createMatchProgressDelta(before, after, 0, null).classesUnlocked).toBe(true);
    expect(createMatchProgressDelta(after, after, 0, null).classesUnlocked).toBe(false);
  });

  it('carries the item unlock through, because the snapshot does not hold it', () => {
    const progress = getCoopDefenseProgressSnapshot(0);
    expect(createMatchProgressDelta(progress, progress, 0, null).itemsUnlocked).toBe(false);
    expect(createMatchProgressDelta(progress, progress, 0, null, true).itemsUnlocked).toBe(true);
  });

  it('carries the first persistent-base area expansion as its own reward delta', () => {
    const progress = getCoopDefenseProgressSnapshot(0);
    expect(createMatchProgressDelta(progress, progress, 0, null).persistentBaseAreaStageUnlocked)
      .toBe(false);
    expect(createMatchProgressDelta(progress, progress, 0, null, false, false, true))
      .toMatchObject({ persistentBaseAreaStageUnlocked: true });
  });

  it('keeps a zero-XP match stable and waits when the local result is missing', () => {
    const progress = getCoopDefenseProgressSnapshot(42);
    expect(createMatchProgressDelta(progress, progress, 0, null)).toMatchObject({
      xpGained: 0,
      newSkillPoints: 0,
      newBossPoints: 0,
      unlockedMapName: null,
      classesUnlocked: false,
    });
    expect(resolvePersonalMatchOutcome(
      'deathmatch',
      'missing-player',
      [result('p1', 3)],
      null,
    )).toBe('syncing');
  });
});

describe('match item reward presentation', () => {
  const armor = (uid: string, baseValue = 25): CoopDefenseItem => ({
    uid, slot: 'armor', rarity: 'white', itemLevel: 1, baseValue, affixes: [],
  });

  it('is absent without a pending reward', () => {
    expect(createMatchItemRewardPresentation(null, [], {})).toBeNull();
    expect(createMatchItemRewardPresentation({ roundEndedAt: 1, offers: [] }, [], {})).toBeNull();
  });

  it('compares each offer against the equipped item of its category', () => {
    const equipped = armor('equipped', 20);
    const presentation = createMatchItemRewardPresentation(
      { roundEndedAt: 5, offers: [armor('offer', 30)] },
      [equipped],
      { armor: 'equipped' },
    );

    const option = presentation!.options[0];
    expect(option.equipped?.uid).toBe('equipped');
    expect(option.comparison.find((row) => row.stat === 'player.maxHp')).toMatchObject({
      candidateValue: 30,
      equippedValue: 20,
      delta: 10,
    });
    expect(option.salvageXp).toBeGreaterThan(0);
  });

  it('reports an empty slot and the free category space', () => {
    const presentation = createMatchItemRewardPresentation(
      { roundEndedAt: 5, offers: [armor('offer')] },
      [],
      {},
    );

    const option = presentation!.options[0];
    expect(option.equipped).toBeNull();
    expect(option.directEquip).toBe(true);
    expect(option.freeStashSlots).toBe(COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT);
    expect(option.stash).toEqual([]);
  });

  it('offers the category stash for salvaging once the category is full', () => {
    const owned = Array.from({ length: COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT }, (_, index) => armor(`s${index}`));
    const presentation = createMatchItemRewardPresentation(
      { roundEndedAt: 5, offers: [armor('offer')] },
      owned,
      {},
    );

    const option = presentation!.options[0];
    expect(option.freeStashSlots).toBe(0);
    expect(option.stash).toHaveLength(COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT);
  });
});
