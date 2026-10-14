import { describe, expect, it } from 'vitest';
import type { RoundResult, RoundState } from '../src/network/NetworkBridge';
import {
  createMatchItemRewardPresentation,
  createMatchProgressDelta,
  createDawnMatchSummary,
  getDawnMatchSummaryRows,
  hasNewMatchRewards,
  type MatchResultsPresentation,
  resolvePersonalMatchOutcome,
  sortMatchLeaderboard,
} from '../src/ui/MatchResultsModel';
import { getCoopDefenseProgressSnapshot, getCoopDefenseXpThresholdForLevel } from '../src/utils/coopDefenseProgression';
import { COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT } from '../src/config/coopDefenseItems';
import type { CoopDefenseItem } from '../src/types';
import { t } from '../src/i18n';

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
  it.each(['victory', 'defeat'] as const)('projects the shared Dawn %s snapshot independently of personal progress', outcome => {
    const round: RoundState = { status: outcome, roundStartTime: 1, dawn: { dayNumber: 8, threat: 3 } };
    const wire = [{ sharedScrap: 241 }];
    const host = createDawnMatchSummary(round, wire, 500)!;
    const client = createDawnMatchSummary(JSON.parse(JSON.stringify(round)), wire, 900)!;
    const { balanceAfter: _hostBalance, ...hostShared } = host;
    const { balanceAfter: _clientBalance, ...clientShared } = client;
    expect(clientShared).toEqual(hostShared);
    expect(host).toMatchObject({ dayNumber: 8, threat: 3, sharedScrap: 241,
      retainedScrap: outcome === 'victory' ? 241 : 120, retainedPercent: outcome === 'victory' ? 100 : 50 });
    const row = getDawnMatchSummaryRows(host).find(row => row.label === t('ui.dawn.results.scrap'))!;
    expect(row.value).toBe(outcome === 'victory' ? '241' : t('ui.dawn.results.share', { saved: '120', total: '241' }));
    expect(row.detail).toBe(outcome === 'victory' ? undefined : t('ui.dawn.results.saved', { percent: 50 }));
  });

  it('omits unavailable Dawn counters instead of inventing zeros or deriving them from personal history', () => {
    const round: RoundState = { status: 'defeat', roundStartTime: 1, dawn: { dayNumber: NaN, threat: 0 } };
    const summary = createDawnMatchSummary(round, [{ sharedScrap: NaN }])!;
    expect(getDawnMatchSummaryRows(summary)).toEqual([]);
    expect(summary).not.toHaveProperty('sharedScrap');
    expect(summary).not.toHaveProperty('dayNumber');
    expect(summary).not.toHaveProperty('threat');
    expect(getDawnMatchSummaryRows(createDawnMatchSummary(round, [{ sharedScrap: 0 }], 0)!)).toHaveLength(2);
    expect(createDawnMatchSummary(null, [])).toBeUndefined();
    expect(createDawnMatchSummary({ status: 'victory', roundStartTime: 1, coopDefenseMapId: '1' }, [])).toBeUndefined();
    expect(createDawnMatchSummary({ ...round, status: 'aborted' }, [])).toBeUndefined();
  });

  it('keeps the shared salvage share separate from a capped or failed personal credit', () => {
    const summary = createDawnMatchSummary({ status: 'defeat', roundStartTime: 1, dawn: { dayNumber: 1, threat: 1 } },
      [{ sharedScrap: 240 }], 1000, 0)!;
    expect(summary.retainedScrap).toBe(120);
    expect(getDawnMatchSummaryRows(summary)).toContainEqual({ label: t('ui.dawn.results.credited'), value: '0' });
  });
  it('does not use damage to rank players or break a frag tie', () => {
    const a = { ...result('a', 5), damageDealt: 1 };
    const b = { ...result('b', 5), damageDealt: 1000 };
    const c = { ...result('c', 4), damageDealt: 2000 };
    expect(sortMatchLeaderboard([c, b, a]).map(entry => entry.id)).toEqual(['a', 'b', 'c']);
    expect(resolvePersonalMatchOutcome('deathmatch', 'a', [a, b, c], null)).toBe('draw');
    expect(resolvePersonalMatchOutcome('deathmatch', 'c', [a, b, c], null)).toBe('defeat');
  });

  it('requires restart confirmation for new rewards, but not XP alone or old unspent points', () => {
    const before = getCoopDefenseProgressSnapshot(getCoopDefenseXpThresholdForLevel(3));
    const after = getCoopDefenseProgressSnapshot(before.totalXp + 1);
    const progress = createMatchProgressDelta(before, after, 1, null);
    const presentation: MatchResultsPresentation = {
      outcome: 'defeat', mode: 'coop_defense', modeLabel: '', mapLabel: '',
      localPlayerId: 'local', leaderboard: [], technicalMessage: null, itemReward: null, progress,
    };
    expect(hasNewMatchRewards(presentation)).toBe(false);
    for (const reward of [
      { after: { ...after, level: before.level + 1 } }, { newSkillPoints: 1 }, { newBossPoints: 1 },
      { unlockedMapName: 'Next map' }, { classesUnlocked: true }, { itemsUnlocked: true },
      { persistentBaseUnlocked: true }, { persistentBaseAreaStageUnlocked: true },
      { persistentBaseHealthReward: { bonusHp: 1, maxHp: 2 } },
    ]) expect(hasNewMatchRewards({ ...presentation, progress: { ...progress, ...reward } })).toBe(true);
    expect(hasNewMatchRewards({ ...presentation, progress: null, itemReward: {
      roundEndedAt: 1, queueIndex: 1, queueSize: 1, epicGuaranteeCount: 0, options: [],
    } })).toBe(true);
  });

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

  it.each([
    { blue: 1, red: 3, outcome: 'defeat' },
    { blue: 2, red: 2, outcome: 'draw' },
    { blue: 3, red: 1, outcome: 'victory' },
  ])('uses both CTB final scores without an opposing result row: $outcome', ({ blue, red, outcome }) => {
    const player = { ...result('remaining', 99, 'blue', blue), teamScores: { blue, red } };
    expect(resolvePersonalMatchOutcome('capture_the_beer', player.id, [player], null)).toBe(outcome);
  });

  it('sorts deterministically and computes multiple level-up rewards', () => {
    expect(sortMatchLeaderboard([
      result('p2', 5),
      result('p1', 10),
      result('p3', 5),
    ]).map((entry) => entry.id)).toEqual(['p1', 'p2', 'p3']);

    const before = getCoopDefenseProgressSnapshot(0);
    const xpGained = getCoopDefenseXpThresholdForLevel(before.level + 2);
    const after = getCoopDefenseProgressSnapshot(xpGained);
    const delta = createMatchProgressDelta(before, after, xpGained, 'Map 2');
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
