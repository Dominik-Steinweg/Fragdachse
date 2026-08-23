import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizeCoopDefenseMapConfig,
  resolveCoopDefenseMapSecondaryObjectives,
  type CoopDefenseMapConfig,
  type CoopDefenseMapObjective,
} from '../src/config/coopDefenseMaps';
import { CoopDefenseSecondaryObjectiveSystem } from '../src/systems/CoopDefenseSecondaryObjectiveSystem';
import type { ResolvedCoopDefenseMapSecondaryObjectiveConfig } from '../src/config/coopDefenseMaps';
import { NetworkBridge } from '../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../src/network/peer/session';

/** Eine Hauptbasis plus zwei dormante Missionsstrukturen; jede muss von genau einem Objective referenziert werden. */
const TEST_BASES: CoopDefenseMapConfig['bases'] = [
  {
    id: 'friendly-main',
    hpMax: 100,
    anchor: { kind: 'right-center', edgeInsetCells: 0 },
    shape: { kind: 'rectangle', widthCells: 1, heightCells: 1 },
  },
  {
    id: 'friendly-outpost',
    hpMax: 100,
    role: 'outpost',
    dormant: true,
    anchor: { kind: 'left-center', edgeInsetCells: 0 },
    shape: { kind: 'rectangle', widthCells: 1, heightCells: 1 },
  },
  {
    id: 'friendly-outpost-b',
    hpMax: 100,
    role: 'outpost',
    dormant: true,
    anchor: { kind: 'center-offset', dxCells: -10, dyCells: 0 },
    shape: { kind: 'rectangle', widthCells: 1, heightCells: 1 },
  },
];

/** Karte für Hold-Fälle: genau eine dormante Struktur, weil ein Hold genau ein Ziel referenziert. */
function makeSingleTargetMap(
  secondaryObjectives: CoopDefenseMapConfig['secondaryObjectives'],
  objective: CoopDefenseMapObjective = 'repel-assault',
): CoopDefenseMapConfig {
  return makeMap(secondaryObjectives, objective, undefined, {
    bases: TEST_BASES.slice(0, 2),
    ...(objective === 'survive' ? { surviveDurationSec: 60, surviveRespawnsPerPlayer: 1 } : {}),
  });
}

function makeMap(
  secondaryObjectives: CoopDefenseMapConfig['secondaryObjectives'] = [],
  objective: CoopDefenseMapObjective = 'repel-assault',
  encounters: CoopDefenseMapConfig['encounters'] = [
    {
      id: 'assault-1',
      start: { type: 'time', atMs: 0 },
      groups: [{ enemyKind: 'zombie-badger', count: 1 }],
    },
    {
      id: 'assault-final',
      start: { type: 'after-previous' },
      groups: [{ enemyKind: 'zombie-badger', count: 1 }],
    },
  ],
  extras: Partial<CoopDefenseMapConfig> = {},
): CoopDefenseMapConfig {
  return {
    mapId: 'secondary-objective-test',
    displayName: 'Secondary objective test',
    balanceReferenceDurationSec: 60,
    bases: TEST_BASES,
    powerUps: [],
    encounters,
    secondaryObjectives,
    objective,
    ...extras,
  };
}

function resolvedObjective(
  overrides: Partial<ResolvedCoopDefenseMapSecondaryObjectiveConfig> = {},
): ResolvedCoopDefenseMapSecondaryObjectiveConfig {
  return {
    id: 'destroy-front',
    type: 'destroy',
    start: { type: 'time', atMs: 0 },
    targets: ['target-a', 'target-b', 'target-c'],
    targetGoal: 3,
    ...overrides,
  };
}

describe('Coop defense secondary objectives', () => {
  afterEach(() => {
    clearActiveSession();
  });

  it('normalizes objective ids, triggers, complete targets and rewards', () => {
    const normalized = normalizeCoopDefenseMapConfig(makeMap([{
      id: '  destroy-front  ',
      type: 'destroy',
      start: { type: 'time', atMs: -25 },
      focusUntil: { type: 'time', atMs: 500.9 },
      targets: [' friendly-outpost ', 'friendly-outpost-b'],
      targetGoal: 1,
      rewards: { xpPerTarget: -4.5 },
    }]));

    expect(normalized.secondaryObjectives).toEqual([{
      id: 'destroy-front',
      type: 'destroy',
      start: { type: 'time', atMs: 0 },
      focusUntil: { type: 'time', atMs: 500 },
      targetGoal: 1,
      targets: ['friendly-outpost', 'friendly-outpost-b'],
      rewards: { xpPerTarget: 0 },
    }]);
    expect(resolveCoopDefenseMapSecondaryObjectives(normalized, 4)).toEqual(normalized.secondaryObjectives);
  });

  it('rejects malformed ids, target references, unsupported triggers and unknown encounters', () => {
    expect(() => normalizeCoopDefenseMapConfig(makeMap([{
      id: ' ', type: 'destroy', start: { type: 'time', atMs: 0 }, targets: ['friendly-main'],
    }]))).toThrow('non-empty id');

    expect(() => normalizeCoopDefenseMapConfig(makeMap([
      { id: 'same', type: 'destroy', start: { type: 'time', atMs: 0 }, targets: ['friendly-main'] },
      { id: ' same ', type: 'carry', start: { type: 'time', atMs: 1 }, targets: ['friendly-outpost'] },
    ]))).toThrow('Duplicate secondary objective id');

    expect(() => normalizeCoopDefenseMapConfig(makeMap([{
      id: 'unknown-target', type: 'destroy', start: { type: 'time', atMs: 0 }, targets: ['missing'],
    }]))).toThrow('unknown target base');

    expect(() => normalizeCoopDefenseMapConfig(makeMap([{
      id: 'unknown-encounter',
      type: 'destroy',
      start: { type: 'after-encounter', encounterId: 'missing' },
      targets: ['friendly-main'],
    }]))).toThrow('unknown encounter');

    expect(() => normalizeCoopDefenseMapConfig(makeMap([{
      id: 'unsupported',
      type: 'destroy',
      start: { type: 'base-destroyed', baseId: 'friendly-main' },
      targets: ['friendly-main'],
    }]))).toThrow('unsupported start trigger');
  });

  it('rejects overlapping authored windows and a Hold ending on the last repel encounter', () => {
    expect(() => normalizeCoopDefenseMapConfig(makeMap([
      { id: 'first', type: 'destroy', start: { type: 'time', atMs: 100 }, focusUntil: { type: 'time', atMs: 500 }, targets: ['friendly-outpost'] },
      { id: 'second', type: 'carry', start: { type: 'time', atMs: 400 }, focusUntil: { type: 'time', atMs: 800 }, targets: ['friendly-outpost-b'] },
    ]))).toThrow('overlapping authored active windows');

    expect(() => normalizeCoopDefenseMapConfig(makeSingleTargetMap([{
      id: 'hold-final',
      type: 'hold',
      start: { type: 'time', atMs: 100 },
      holdUntil: { type: 'after-encounter', encounterId: 'assault-final' },
      targets: ['friendly-outpost'],
    }]))).toThrow('last repel-assault encounter');
  });

  it('rejects a Hold without its own window and a hold window on any other archetype', () => {
    expect(() => normalizeCoopDefenseMapConfig(makeSingleTargetMap([{
      id: 'hold-open', type: 'hold', start: { type: 'time', atMs: 100 }, targets: ['friendly-outpost'],
    }]))).toThrow('needs exactly one of holdUntil or holdDurationMs');

    expect(() => normalizeCoopDefenseMapConfig(makeSingleTargetMap([{
      id: 'hold-double',
      type: 'hold',
      start: { type: 'time', atMs: 100 },
      holdUntil: { type: 'time', atMs: 300 },
      holdDurationMs: 200,
      targets: ['friendly-outpost'],
    }]))).toThrow('needs exactly one of holdUntil or holdDurationMs');

    expect(() => normalizeCoopDefenseMapConfig(makeSingleTargetMap([{
      id: 'hold-focus',
      type: 'hold',
      start: { type: 'time', atMs: 100 },
      focusUntil: { type: 'time', atMs: 200 },
      holdUntil: { type: 'time', atMs: 300 },
      targets: ['friendly-outpost'],
    }]))).toThrow('must not declare focusUntil');

    expect(normalizeCoopDefenseMapConfig(makeMap([{
      id: 'hold-many',
      type: 'hold',
      start: { type: 'time', atMs: 100 },
      holdUntil: { type: 'time', atMs: 300 },
      targets: ['friendly-outpost', 'friendly-outpost-b'],
    }]))).toMatchObject({
      secondaryObjectives: [{ targets: ['friendly-outpost', 'friendly-outpost-b'], targetGoal: 2 }],
    });

    expect(() => normalizeCoopDefenseMapConfig(makeMap([{
      id: 'hold-invalid-survivors',
      type: 'hold',
      start: { type: 'time', atMs: 100 },
      holdUntil: { type: 'time', atMs: 300 },
      requiredSurvivors: 3,
      targets: ['friendly-outpost', 'friendly-outpost-b'],
    }]))).toThrow('has invalid requiredSurvivors');

    expect(() => normalizeCoopDefenseMapConfig(makeMap([{
      id: 'destroy-survivors',
      type: 'destroy',
      start: { type: 'time', atMs: 100 },
      requiredSurvivors: 1,
      targets: ['friendly-outpost', 'friendly-outpost-b'],
    }]))).toThrow('must not declare requiredSurvivors');

    expect(() => normalizeCoopDefenseMapConfig(makeSingleTargetMap([{
      id: 'destroy-hold',
      type: 'destroy',
      start: { type: 'time', atMs: 100 },
      holdUntil: { type: 'time', atMs: 300 },
      targets: ['friendly-outpost'],
    }]))).toThrow('must not declare holdUntil');

    expect(() => normalizeCoopDefenseMapConfig(makeSingleTargetMap([{
      id: 'destroy-repair',
      type: 'destroy',
      start: { type: 'time', atMs: 100 },
      targets: ['friendly-outpost'],
      rewards: { repairTargetOnComplete: true },
    }]))).toThrow('must not declare repairTargetOnComplete');

    expect(() => normalizeCoopDefenseMapConfig(makeSingleTargetMap([{
      id: 'hold-backwards',
      type: 'hold',
      start: { type: 'time', atMs: 300 },
      holdUntil: { type: 'time', atMs: 300 },
      targets: ['friendly-outpost'],
    }]))).toThrow('has a holdUntil before its start');

    expect(() => normalizeCoopDefenseMapConfig(makeSingleTargetMap([{
      id: 'hold-backwards-encounter',
      type: 'hold',
      start: { type: 'after-encounter', encounterId: 'assault-final' },
      holdUntil: { type: 'after-encounter', encounterId: 'assault-1' },
      targets: ['friendly-outpost'],
    }], 'survive')))
      .toThrow('holdUntil encounter before or equal to its start encounter');
  });

  it('treats holdUntil as the authored window end and defaults the repair reward', () => {
    const normalized = normalizeCoopDefenseMapConfig(makeSingleTargetMap([
      {
        id: 'hold-outpost',
        type: 'hold',
        start: { type: 'after-encounter', encounterId: 'assault-1' },
        holdUntil: { type: 'after-encounter', encounterId: 'assault-final' },
        targets: ['friendly-outpost'],
      },
    ], 'survive'));

    expect(normalized.secondaryObjectives).toEqual([{
      id: 'hold-outpost',
      type: 'hold',
      start: { type: 'after-encounter', encounterId: 'assault-1' },
      holdUntil: { type: 'after-encounter', encounterId: 'assault-final' },
      targets: ['friendly-outpost'],
      targetGoal: 1,
      rewards: { repairTargetOnComplete: true },
    }]);
    // Ohne Durchreichen bliebe der Laufzeit-Hold ohne Fenster und könnte nie erfüllt werden.
    expect(resolveCoopDefenseMapSecondaryObjectives(normalized, 4)).toEqual(normalized.secondaryObjectives);

    // Das Haltefenster [assault-1, assault-final) belegt den Fokus wie ein focusUntil.
    expect(() => normalizeCoopDefenseMapConfig(makeMap([
      {
        id: 'hold-outpost',
        type: 'hold',
        start: { type: 'after-encounter', encounterId: 'assault-1' },
        holdUntil: { type: 'after-encounter', encounterId: 'assault-final' },
        targets: ['friendly-outpost'],
      },
      {
        id: 'carry-later',
        type: 'carry',
        start: { type: 'after-encounter', encounterId: 'assault-1' },
        targets: ['friendly-outpost-b'],
      },
    ], 'survive', undefined, { surviveDurationSec: 60, surviveRespawnsPerPlayer: 1 })))
      .toThrow('same start encounter');
  });

  it('normalizes mission checkpoints and requires mandatory defenses to reference matching Holds', () => {
    const normalized = normalizeCoopDefenseMapConfig(makeMap([{
      id: 'hold-gate',
      type: 'hold',
      start: { type: 'after-checkpoint', checkpointId: 'gate' },
      holdDurationMs: 2_500.9,
      targets: ['friendly-outpost'],
    }], 'survive', undefined, {
      bases: TEST_BASES.slice(0, 2),
      surviveDurationSec: 60,
      surviveRespawnsPerPlayer: 1,
      missionProgress: {
        checkpoints: [{ id: ' gate ', gridX: 3, gridY: 4, setRespawn: true }],
        mandatoryDefenses: [{ id: ' defend ', checkpointId: 'gate', objectiveId: 'hold-gate' }],
        barriers: [{
          id: ' door ',
          cells: [{ gridX: 5, gridY: 4 }],
          openOn: { type: 'after-defense', defenseId: 'defend' },
        }],
      },
    }));

    expect(normalized.secondaryObjectives?.[0]).toMatchObject({ holdDurationMs: 2_500 });
    expect(normalized.missionProgress).toEqual({
      checkpoints: [{ id: 'gate', gridX: 3, gridY: 4, radiusCells: 1, setRespawn: true }],
      mandatoryDefenses: [{ id: 'defend', checkpointId: 'gate', objectiveId: 'hold-gate' }],
      barriers: [{
        id: 'door',
        cells: [{ gridX: 5, gridY: 4 }],
        openOn: { type: 'after-defense', defenseId: 'defend' },
      }],
    });
  });

  it('validates deterministic after-encounter conflicts without rejecting sequential handoffs', () => {
    expect(() => normalizeCoopDefenseMapConfig(makeMap([
      { id: 'first', type: 'destroy', start: { type: 'after-encounter', encounterId: 'assault-1' }, targets: ['friendly-outpost'] },
      { id: 'second', type: 'carry', start: { type: 'after-encounter', encounterId: 'assault-1' }, targets: ['friendly-outpost-b'] },
    ]))).toThrow('overlapping authored active windows');

    expect(() => normalizeCoopDefenseMapConfig(makeMap([
      { id: 'first', type: 'destroy', start: { type: 'after-encounter', encounterId: 'assault-1' }, focusUntil: { type: 'time', atMs: 500 }, targets: ['friendly-outpost'] },
      { id: 'second', type: 'carry', start: { type: 'after-encounter', encounterId: 'assault-1' }, focusUntil: { type: 'time', atMs: 800 }, targets: ['friendly-outpost-b'] },
    ]))).toThrow('same start encounter');

    const threeEncounters: CoopDefenseMapConfig['encounters'] = [
      ...makeMap().encounters!.slice(0, 1),
      {
        id: 'assault-2',
        start: { type: 'after-previous' },
        groups: [{ enemyKind: 'zombie-badger', count: 1 }],
      },
      {
        id: 'assault-final',
        start: { type: 'after-previous' },
        groups: [{ enemyKind: 'zombie-badger', count: 1 }],
      },
    ];

    expect(() => normalizeCoopDefenseMapConfig(makeMap([
      { id: 'first', type: 'destroy', start: { type: 'after-encounter', encounterId: 'assault-1' }, focusUntil: { type: 'after-encounter', encounterId: 'assault-final' }, targets: ['friendly-outpost'] },
      { id: 'second', type: 'carry', start: { type: 'after-encounter', encounterId: 'assault-2' }, focusUntil: { type: 'after-encounter', encounterId: 'assault-final' }, targets: ['friendly-outpost-b'] },
    ], 'repel-assault', threeEncounters))).toThrow('overlapping authored active windows');

    expect(() => normalizeCoopDefenseMapConfig(makeMap([
      { id: 'first', type: 'destroy', start: { type: 'after-encounter', encounterId: 'assault-1' }, focusUntil: { type: 'after-encounter', encounterId: 'assault-2' }, targets: ['friendly-outpost'] },
      { id: 'second', type: 'carry', start: { type: 'after-encounter', encounterId: 'assault-2' }, focusUntil: { type: 'after-encounter', encounterId: 'assault-final' }, targets: ['friendly-outpost-b'] },
    ], 'repel-assault', threeEncounters))).not.toThrow();
  });

  it('activates from time and encounter-clear triggers', () => {
    let encounterCleared = false;
    const system = new CoopDefenseSecondaryObjectiveSystem([
      resolvedObjective({ start: { type: 'time', atMs: 100 } }),
      resolvedObjective({
        id: 'after-clear',
        start: { type: 'after-encounter', encounterId: 'assault-1' },
      }),
    ], { isEncounterCleared: () => encounterCleared });

    system.hostUpdate(99, false);
    expect(system.getPresentationState()).toEqual([]);
    system.hostUpdate(1, false);
    expect(system.getPresentationState().find((entry) => entry.objectiveId === 'destroy-front'))
      .toMatchObject({ state: 'active', focused: true });
    system.reportObjectiveFailed('destroy-front');
    encounterCleared = true;
    system.hostUpdate(0, false);
    expect(system.getPresentationState().find((entry) => entry.objectiveId === 'after-clear'))
      .toMatchObject({ state: 'active', focused: true });

    encounterCleared = false;
    const waiting = new CoopDefenseSecondaryObjectiveSystem([
      resolvedObjective({ start: { type: 'after-encounter', encounterId: 'assault-1' } }),
    ], { isEncounterCleared: () => encounterCleared });
    waiting.hostUpdate(100, false);
    expect(waiting.getPresentationState()).toEqual([]);
    encounterCleared = true;
    waiting.hostUpdate(1, false);
    expect(waiting.getPresentationState()).toMatchObject([{ state: 'active', focused: true }]);
  });

  it('releases focus without completing the objective and lets the next objective take focus', () => {
    const system = new CoopDefenseSecondaryObjectiveSystem([
      resolvedObjective({
        id: 'first',
        focusUntil: { type: 'time', atMs: 100 },
        rewards: { xpPerTarget: 5 },
      }),
      resolvedObjective({ id: 'second', start: { type: 'time', atMs: 100 } }),
    ]);

    system.hostUpdate(0, false);
    expect(system.getFocusedObjectiveId()).toBe('first');
    expect(system.getObjectiveState('second')).toBe('dormant');

    system.hostUpdate(100, false);
    expect(system.getObjectiveState('first')).toBe('active');
    expect(system.getFocusedObjectiveId()).toBe('second');
    expect(system.getPresentationState()).toEqual([
      expect.objectContaining({ objectiveId: 'first', state: 'active', focused: false, progressCurrent: 0 }),
      expect.objectContaining({ objectiveId: 'second', state: 'active', focused: true }),
    ]);

    for (const targetId of ['target-a', 'target-b', 'target-c']) {
      system.reportTargetContribution('first', targetId);
    }
    expect(system.reportTargetDestroyed('first', 'target-a')).toBe(5);
    expect(system.reportTargetDestroyed('first', 'target-b')).toBe(5);
    expect(system.reportTargetDestroyed('first', 'target-c')).toBe(5);
    expect(system.getObjectiveState('first')).toBe('completed');
    expect(system.getFocusedObjectiveId()).toBe('second');
    expect(system.getPresentationState().find((entry) => entry.objectiveId === 'first'))
      .toMatchObject({ state: 'completed', focused: false, progressCurrent: 3, progressTotal: 3 });
  });

  it('keeps a trigger dormant while focus is occupied and retries it after focus loss', () => {
    let encounterCleared = false;
    const system = new CoopDefenseSecondaryObjectiveSystem([
      resolvedObjective({ id: 'first', focusUntil: { type: 'time', atMs: 200 } }),
      resolvedObjective({ id: 'after-clear', start: { type: 'after-encounter', encounterId: 'assault-1' } }),
    ], { isEncounterCleared: () => encounterCleared });

    system.hostUpdate(0, false);
    encounterCleared = true;
    system.hostUpdate(100, false);
    expect(system.getObjectiveState('after-clear')).toBe('dormant');
    system.hostUpdate(100, false);
    expect(system.getObjectiveState('first')).toBe('active');
    expect(system.getObjectiveState('after-clear')).toBe('active');
    expect(system.getFocusedObjectiveId()).toBe('after-clear');
  });

  it('completes only after targetGoal and keeps progress countable after focus loss', () => {
    const system = new CoopDefenseSecondaryObjectiveSystem([resolvedObjective()]);

    system.hostUpdate(0, false);
    system.reportTargetDestroyed('destroy-front', 'target-a');
    system.reportTargetDestroyed('destroy-front', 'target-b');
    expect(system.getObjectiveState('destroy-front')).toBe('active');
    system.reportTargetDestroyed('destroy-front', 'target-c');
    expect(system.getObjectiveState('destroy-front')).toBe('completed');

    const expiring = new CoopDefenseSecondaryObjectiveSystem([resolvedObjective({
      focusUntil: { type: 'time', atMs: 50 },
    })]);

    expiring.hostUpdate(0, false);
    expiring.reportTargetDestroyed('destroy-front', 'target-a');
    expiring.hostUpdate(50, false);
    expect(expiring.getPresentationState()).toMatchObject([
      { state: 'active', focused: false, progressCurrent: 1, progressTotal: 3, stateChangedAtMs: 0 },
    ]);
    expiring.reportTargetDestroyed('destroy-front', 'target-b');
    expect(expiring.getPresentationState()).toMatchObject([{ state: 'active', progressCurrent: 2 }]);
    expiring.reportTargetDestroyed('destroy-front', 'target-c');
    expect(expiring.getObjectiveState('destroy-front')).toBe('completed');
  });

  it('uses targetGoal as the presentation total and completion threshold', () => {
    const system = new CoopDefenseSecondaryObjectiveSystem([resolvedObjective({ targetGoal: 2 })]);
    system.hostUpdate(0, false);

    system.reportTargetDestroyed('destroy-front', 'target-a');
    system.reportTargetDestroyed('destroy-front', 'target-b');
    expect(system.getObjectiveState('destroy-front')).toBe('completed');
    expect(system.getPresentationState()).toMatchObject([{
      progressCurrent: 2,
      progressTotal: 2,
      state: 'completed',
    }]);
    expect(system.reportTargetDestroyed('destroy-front', 'target-c')).toBe(0);
    expect(system.getPresentationState()).toMatchObject([{ progressCurrent: 2 }]);
  });

  it('deduplicates target resolution and exposes only the normalized team reward', () => {
    const system = new CoopDefenseSecondaryObjectiveSystem([resolvedObjective({
      rewards: { xpPerTarget: 25.9 },
    })]);
    system.hostUpdate(0, false);

    system.reportTargetContribution('destroy-front', 'target-a');
    expect(system.reportTargetDestroyed('destroy-front', 'unknown')).toBe(0);
    expect(system.reportTargetDestroyed('other-objective', 'target-a')).toBe(0);
    expect(system.reportTargetDestroyed('destroy-front', 'target-a')).toBe(25);
    expect(system.reportTargetDestroyed('destroy-front', 'target-a')).toBe(0);
    expect(system.getPresentationState()).toMatchObject([{ progressCurrent: 1 }]);

    const withoutReward = new CoopDefenseSecondaryObjectiveSystem([resolvedObjective()]);
    expect(withoutReward.getTargetResolutionXp('destroy-front')).toBe(0);
  });

  it('completes a Hold at holdUntil, hands focus on in the same tick and requests its reward', () => {
    const completedHolds: string[] = [];
    let encounterCleared = false;
    const system = new CoopDefenseSecondaryObjectiveSystem([
      resolvedObjective({
        id: 'hold-outpost',
        type: 'hold',
        targets: ['outpost'],
        targetGoal: 1,
        holdUntil: { type: 'after-encounter', encounterId: 'assault-2' },
        rewards: { repairTargetOnComplete: true },
      }),
      resolvedObjective({ id: 'follow-up', start: { type: 'time', atMs: 1_000 } }),
    ], {
      isEncounterCleared: () => encounterCleared,
      onHoldCompleted: (objectiveId) => completedHolds.push(objectiveId),
    });

    system.hostUpdate(500, false);
    expect(system.getObjectiveState('hold-outpost')).toBe('active');
    expect(system.getFocusedObjectiveId()).toBe('hold-outpost');
    expect(completedHolds).toEqual([]);

    // Haltefenster erreicht und Folgemission fällig: derselbe Tick schließt ab und übergibt.
    encounterCleared = true;
    system.hostUpdate(500, false);
    expect(system.getObjectiveState('hold-outpost')).toBe('completed');
    expect(system.getFocusedObjectiveId()).toBe('follow-up');
    expect(completedHolds).toEqual(['hold-outpost']);

    system.hostUpdate(500, false);
    expect(completedHolds).toEqual(['hold-outpost']);

    system.reset();
    system.hostUpdate(500, false);
    expect(completedHolds).toEqual(['hold-outpost']);
  });

  it('completes a Hold from a time window and never books XP for a lost hold target', () => {
    const completedHolds: string[] = [];
    const timed = new CoopDefenseSecondaryObjectiveSystem([resolvedObjective({
      id: 'hold-supply',
      type: 'hold',
      targets: ['outpost'],
      targetGoal: 1,
      holdUntil: { type: 'time', atMs: 5_000 },
    })], { onHoldCompleted: (objectiveId) => completedHolds.push(objectiveId) });

    timed.hostUpdate(4_999, false);
    expect(timed.getObjectiveState('hold-supply')).toBe('active');
    timed.hostUpdate(1, false);
    expect(timed.getObjectiveState('hold-supply')).toBe('completed');
    expect(completedHolds).toEqual(['hold-supply']);

    const lost = new CoopDefenseSecondaryObjectiveSystem([resolvedObjective({
      id: 'hold-supply',
      type: 'hold',
      targets: ['outpost'],
      targetGoal: 1,
      holdUntil: { type: 'time', atMs: 5_000 },
      // Ein authored XP-Wert darf den Verlust des Ziels niemals belohnen.
      rewards: { xpPerTarget: 25 },
    })], { onHoldCompleted: (objectiveId) => completedHolds.push(objectiveId) });

    lost.hostUpdate(1_000, false);
    expect(lost.reportTargetDestroyed('hold-supply', 'outpost')).toBe(0);
    expect(lost.getObjectiveState('hold-supply')).toBe('failed');
    expect(lost.getFocusedObjectiveId()).toBeNull();

    // Ein gescheiterter Hold darf beim Erreichen seines Fensters nicht doch noch erfüllt werden.
    lost.hostUpdate(5_000, false);
    expect(lost.getObjectiveState('hold-supply')).toBe('failed');
    expect(completedHolds).toEqual(['hold-supply']);
  });

  it('measures holdDurationMs from actual activation in host round time', () => {
    let checkpointReached = false;
    const system = new CoopDefenseSecondaryObjectiveSystem([resolvedObjective({
      id: 'hold-route',
      type: 'hold',
      start: { type: 'after-checkpoint', checkpointId: 'entry' },
      targets: ['outpost'],
      targetGoal: 1,
      holdDurationMs: 1_000,
    })], {
      isExternalTriggerSatisfied: (trigger) => (
        trigger.type === 'after-checkpoint' && trigger.checkpointId === 'entry' && checkpointReached
      ),
    });

    system.hostUpdate(5_000, false);
    expect(system.getObjectiveState('hold-route')).toBe('dormant');
    checkpointReached = true;
    system.hostUpdate(250, false);
    expect(system.getObjectiveState('hold-route')).toBe('active');
    system.hostUpdate(999, false);
    expect(system.getObjectiveState('hold-route')).toBe('active');
    system.hostUpdate(1, false);
    expect(system.getObjectiveState('hold-route')).toBe('completed');
  });

  it('supports a minimum survivor count and fails only when it becomes unreachable', () => {
    const completedHolds: string[] = [];
    const failedHolds: string[] = [];
    const system = new CoopDefenseSecondaryObjectiveSystem([resolvedObjective({
      id: 'hold-bastion',
      type: 'hold',
      targets: ['north', 'center', 'south'],
      requiredSurvivors: 1,
      targetGoal: 3,
      holdUntil: { type: 'time', atMs: 100 },
    })], {
      onHoldCompleted: (objectiveId) => completedHolds.push(objectiveId),
      onHoldFailed: (objectiveId) => failedHolds.push(objectiveId),
    });

    system.hostUpdate(0, false);
    system.reportTargetDestroyed('hold-bastion', 'north');
    system.reportTargetDestroyed('hold-bastion', 'center');
    expect(system.getObjectiveState('hold-bastion')).toBe('active');

    system.hostUpdate(100, false);
    expect(system.getObjectiveState('hold-bastion')).toBe('completed');
    expect(completedHolds).toEqual(['hold-bastion']);
    expect(failedHolds).toEqual([]);

    const allLost = new CoopDefenseSecondaryObjectiveSystem([resolvedObjective({
      id: 'hold-bastion',
      type: 'hold',
      targets: ['north', 'center', 'south'],
      requiredSurvivors: 1,
      holdUntil: { type: 'time', atMs: 100 },
    })]);
    allLost.hostUpdate(0, false);
    allLost.reportTargetDestroyed('hold-bastion', 'north');
    allLost.reportTargetDestroyed('hold-bastion', 'center');
    allLost.reportTargetDestroyed('hold-bastion', 'south');
    expect(allLost.getObjectiveState('hold-bastion')).toBe('failed');
  });

  it('ignores a destroyed carry object instead of resolving it', () => {
    const system = new CoopDefenseSecondaryObjectiveSystem([resolvedObjective({
      id: 'carry-beer',
      type: 'carry',
      rewards: { xpPerTarget: 25 },
    })]);
    system.hostUpdate(0, false);

    expect(system.reportTargetDestroyed('carry-beer', 'target-a')).toBe(0);
    expect(system.getObjectiveState('carry-beer')).toBe('active');
    expect(system.getPresentationState()).toMatchObject([{ progressCurrent: 0 }]);
  });

  it('leaves an incomplete Hold active at round end without implicit success', () => {
    const system = new CoopDefenseSecondaryObjectiveSystem([resolvedObjective({ type: 'hold' })]);
    system.hostUpdate(60_000, false);

    expect(system.getObjectiveState('destroy-front')).toBe('active');
    expect(system.getObjectiveState('destroy-front')).not.toBe('completed');
    expect(system.getPresentationState()).toMatchObject([{ type: 'hold', state: 'active', focused: true }]);
  });

  it('makes failed terminal without creating a round outcome', () => {
    const system = new CoopDefenseSecondaryObjectiveSystem([resolvedObjective()]);
    system.hostUpdate(0, false);
    expect(system.reportObjectiveFailed('destroy-front')).toBe(true);
    expect(system.getPresentationState()).toMatchObject([{ state: 'failed', focused: false }]);
    expect(system.reportTargetDestroyed('destroy-front', 'target-a')).toBe(0);
    system.hostUpdate(1_000, false);
    expect(system.getObjectiveState('destroy-front')).toBe('failed');
  });

  it('round-trips a sanitized presentation snapshot and rejects manipulated values', () => {
    const globalState = new Map<string, unknown>();
    const room = {
      isHost: () => true,
      setGlobal: (key: string, value: unknown) => globalState.set(key, value),
      getGlobal: (key: string) => globalState.get(key),
      destroy: () => undefined,
    };
    setActiveSession({ room: room as never, transport: {} as never, roomCode: 'test' });

    const bridge = new NetworkBridge();
    const snapshot = [{
      objectiveId: 'destroy-front',
      type: 'destroy' as const,
      state: 'active' as const,
      focused: true,
      progressCurrent: 1,
      progressTotal: 3,
      stateChangedAtMs: 125.5,
    }];
    bridge.publishCoopDefenseSecondaryObjectivePresentationState(snapshot);
    expect(bridge.getCoopDefenseSecondaryObjectivePresentationState()).toEqual(snapshot);

    globalState.set('cso', [{ ...snapshot[0], progressCurrent: 4 }]);
    expect(bridge.getCoopDefenseSecondaryObjectivePresentationState()).toBeNull();

    globalState.set('cso', [snapshot[0], { ...snapshot[0], focused: false }]);
    expect(bridge.getCoopDefenseSecondaryObjectivePresentationState()).toBeNull();

    globalState.set('cso', [
      { ...snapshot[0], focused: true },
      { ...snapshot[0], objectiveId: 'destroy-backup', focused: true },
    ]);
    expect(bridge.getCoopDefenseSecondaryObjectivePresentationState()).toBeNull();

    globalState.set('cso', Array.from({ length: 33 }, (_, index) => ({
      ...snapshot[0], objectiveId: `objective-${index}`, focused: index === 0,
    })));
    expect(bridge.getCoopDefenseSecondaryObjectivePresentationState()).toBeNull();
  });

  it('replicates a sanitized mission snapshot to a late reader and clears it on teardown', () => {
    const globalState = new Map<string, unknown>();
    const room = {
      isHost: () => true,
      setGlobal: (key: string, value: unknown) => globalState.set(key, value),
      getGlobal: (key: string) => globalState.get(key),
      destroy: () => undefined,
    };
    setActiveSession({ room: room as never, transport: {} as never, roomCode: 'test' });

    const hostBridge = new NetworkBridge();
    const snapshot = {
      roundRevision: 42,
      missionRevision: 3,
      activatedCheckpoints: [{ checkpointId: 'entry', activatedAtRoundMs: 1_250 }],
      nextCheckpointId: 'exit',
      respawnCheckpointId: 'entry',
      routeLockDefenseId: null,
      resolvedDefenses: [{ defenseId: 'entry-hold', outcome: 'failed' as const, resolvedAtRoundMs: 4_500 }],
      barriers: [{ barrierId: 'entry-gate', open: true }],
      routeComplete: false,
    };
    hostBridge.publishCoopDefenseMissionProgressPresentationState(snapshot);

    const lateBridge = new NetworkBridge();
    expect(lateBridge.getCoopDefenseMissionProgressPresentationState()).toEqual(snapshot);

    globalState.set('cmp', { ...snapshot, activatedCheckpoints: [{ checkpointId: 'entry', activatedAtRoundMs: -1 }] });
    expect(lateBridge.getCoopDefenseMissionProgressPresentationState()).toBeNull();
    globalState.set('cmp', { ...snapshot, nextCheckpointId: ` ${snapshot.nextCheckpointId}` });
    expect(lateBridge.getCoopDefenseMissionProgressPresentationState()).toBeNull();

    hostBridge.publishCoopDefenseMissionProgressPresentationState(null);
    expect(lateBridge.getCoopDefenseMissionProgressPresentationState()).toBeNull();
  });
});
