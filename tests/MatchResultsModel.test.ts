import { describe, expect, it } from 'vitest';
import type { RoundResult, RoundState } from '../src/network/NetworkBridge';
import {
  createMatchProgressDelta,
  resolvePersonalMatchOutcome,
  sortMatchLeaderboard,
} from '../src/ui/MatchResultsModel';
import { getCoopDefenseProgressSnapshot } from '../src/utils/coopDefenseProgression';

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
    expect(delta.levelUps).toBeGreaterThan(1);
    expect(delta.newSkillPoints).toBe(delta.levelUps);
    expect(delta.unlockedMapName).toBe('Map 2');
    expect(delta.classesUnlocked).toBe(false);
  });

  it('reports the class reward only on the locked-to-unlocked transition', () => {
    const before = getCoopDefenseProgressSnapshot(0, undefined, 0, 'dachs_nukem', false);
    const after = getCoopDefenseProgressSnapshot(0, undefined, 0, 'dachs_nukem', true);
    expect(createMatchProgressDelta(before, after, 0, null).classesUnlocked).toBe(true);
    expect(createMatchProgressDelta(after, after, 0, null).classesUnlocked).toBe(false);
  });

  it('keeps a zero-XP match stable and waits when the local result is missing', () => {
    const progress = getCoopDefenseProgressSnapshot(42);
    expect(createMatchProgressDelta(progress, progress, 0, null)).toMatchObject({
      xpGained: 0,
      levelUps: 0,
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
