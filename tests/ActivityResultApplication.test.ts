import { describe, expect, it } from 'vitest';
import {
  createCoopMissionCompletion,
  getCoopMissionConclusion,
  isCompletionForActivity,
} from '../src/activity/ActivityCompletion';
import {
  ResultApplication,
  type ResultApplicationPort,
} from '../src/activity/ResultApplication';
import type { PersistentBaseRewardId } from '../src/persistentBase/PersistentBaseRewardTypes';
import type { ActivityDescriptor } from '../src/world/ActivityDescriptor';

const ACTIVITY_A: ActivityDescriptor = {
  worldRevision: 21,
  activityRevision: 7,
  definitionId: 'activity:coop-mission:7',
  kind: 'coop-mission',
};

function createHarness(activity: ActivityDescriptor | null = ACTIVITY_A): {
  readonly application: ResultApplication;
  readonly calls: string[];
  readonly setActivity: (next: ActivityDescriptor | null) => void;
} {
  let currentActivity = activity;
  const calls: string[] = [];
  const rewards: readonly PersistentBaseRewardId[] = ['base_health_pedestal'];
  const port: ResultApplicationPort = {
    getCurrentActivity: () => currentActivity,
    resolveVictoryRewardIds: (definitionId) => {
      calls.push(`resolve-rewards:${definitionId}`);
      return rewards;
    },
    grantPersistentBaseRewards: (rewardIds) => {
      calls.push(`grant:${rewardIds.join(',')}`);
    },
    applyPersistentBaseOutcome: (outcome, identity) => {
      calls.push(`base:${outcome}:${identity.worldRevision}:${identity.activityRevision}`);
    },
    clearActivityPresentation: () => { calls.push('clear-presentation'); },
    publishCompletion: (completion, endedAt) => {
      calls.push(`publish:${getCoopMissionConclusion(completion)}:${endedAt}`);
    },
  };
  return {
    application: new ResultApplication(port),
    calls,
    setActivity: (next) => { currentActivity = next; },
  };
}

describe('activity completion', () => {
  it('bindet Coop-Ergebnis und Abbruch an die Activity-Revision', () => {
    const victory = createCoopMissionCompletion(ACTIVITY_A, 'victory');
    const aborted = createCoopMissionCompletion(ACTIVITY_A, 'aborted');

    expect(victory).toEqual({
      worldRevision: 21,
      activityRevision: 7,
      definitionId: 'activity:coop-mission:7',
      kind: 'coop-mission',
      conclusion: { type: 'result', result: { outcome: 'victory' } },
    });
    expect(aborted.conclusion).toEqual({ type: 'abort' });
    expect(getCoopMissionConclusion(victory)).toBe('victory');
    expect(getCoopMissionConclusion(aborted)).toBe('aborted');
    expect(isCompletionForActivity(victory, ACTIVITY_A)).toBe(true);
  });

  it('weist einen Coop-Abschluss fuer eine andere Activity-Art zurueck', () => {
    expect(() => createCoopMissionCompletion({
      ...ACTIVITY_A,
      kind: 'deathmatch',
    }, 'victory')).toThrow(/not coop-mission/);
  });
});

describe('result application', () => {
  it('wendet Victory-Folgen in Ownership-Reihenfolge genau einmal an', () => {
    const harness = createHarness();
    const completion = createCoopMissionCompletion(ACTIVITY_A, 'victory');

    expect(harness.application.apply(completion, 9_000)).toBe(true);
    expect(harness.calls).toEqual([
      'resolve-rewards:activity:coop-mission:7',
      'grant:base_health_pedestal',
      'base:commit:21:7',
      'clear-presentation',
      'publish:victory:9000',
    ]);

    expect(harness.application.apply(completion, 9_001)).toBe(false);
    expect(harness.calls).toHaveLength(5);
  });

  for (const conclusion of ['defeat', 'aborted'] as const) {
    it(`rollt bei ${conclusion} zurueck, ohne Victory-Rewards zu vergeben`, () => {
      const harness = createHarness();
      const completion = createCoopMissionCompletion(ACTIVITY_A, conclusion);

      expect(harness.application.apply(completion, 9_000)).toBe(true);
      expect(harness.calls).toEqual([
        'base:rollback:21:7',
        'clear-presentation',
        `publish:${conclusion}:9000`,
      ]);
    });
  }

  it('laesst stale Completion vor jeder Konsequenz wirkungslos', () => {
    const harness = createHarness();
    const variants = [
      { ...ACTIVITY_A, worldRevision: 22 },
      { ...ACTIVITY_A, activityRevision: 8 },
      { ...ACTIVITY_A, definitionId: 'activity:coop-mission:8' },
      { ...ACTIVITY_A, kind: 'deathmatch' as const },
    ];

    for (const currentActivity of variants) {
      harness.setActivity(currentActivity);
      expect(harness.application.apply(
        createCoopMissionCompletion(ACTIVITY_A, 'victory'),
        9_000,
      )).toBe(false);
    }
    harness.setActivity(null);
    expect(harness.application.apply(
      createCoopMissionCompletion(ACTIVITY_A, 'victory'),
      9_000,
    )).toBe(false);
    expect(harness.calls).toEqual([]);
  });

  it('kann nach einem Activity-Wechsel den frischen Abschluss anwenden', () => {
    const harness = createHarness();
    expect(harness.application.apply(
      createCoopMissionCompletion(ACTIVITY_A, 'defeat'),
      9_000,
    )).toBe(true);

    const activityB = { ...ACTIVITY_A, activityRevision: 8 };
    harness.setActivity(activityB);
    expect(harness.application.apply(
      createCoopMissionCompletion(activityB, 'victory'),
      10_000,
    )).toBe(true);
    expect(harness.calls).toContain('base:commit:21:8');
  });
});
