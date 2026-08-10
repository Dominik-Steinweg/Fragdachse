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
    bases: [
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
    ],
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

    expect(() => normalizeCoopDefenseMapConfig(makeMap([{
      id: 'hold-final',
      type: 'hold',
      start: { type: 'time', atMs: 100 },
      focusUntil: { type: 'after-encounter', encounterId: 'assault-final' },
      targets: ['friendly-outpost', 'friendly-outpost-b'],
    }]))).toThrow('last repel-assault encounter');
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
      resolvedObjective({ id: 'first', focusUntil: { type: 'time', atMs: 100 } }),
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

    expect(system.reportTargetResolved('first', 'target-a')).toBe(true);
    expect(system.reportTargetResolved('first', 'target-b')).toBe(true);
    expect(system.reportTargetResolved('first', 'target-c')).toBe(true);
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
    expect(system.reportTargetResolved('destroy-front', 'target-a')).toBe(true);
    expect(system.reportTargetResolved('destroy-front', 'target-b')).toBe(true);
    expect(system.getObjectiveState('destroy-front')).toBe('active');
    expect(system.reportTargetResolved('destroy-front', 'target-c')).toBe(true);
    expect(system.getObjectiveState('destroy-front')).toBe('completed');

    const expiring = new CoopDefenseSecondaryObjectiveSystem([resolvedObjective({
      focusUntil: { type: 'time', atMs: 50 },
    })]);

    expiring.hostUpdate(0, false);
    expect(expiring.reportTargetResolved('destroy-front', 'target-a')).toBe(true);
    expiring.hostUpdate(50, false);
    expect(expiring.getPresentationState()).toMatchObject([
      { state: 'active', focused: false, progressCurrent: 1, progressTotal: 3, stateChangedAtMs: 0 },
    ]);
    expect(expiring.reportTargetResolved('destroy-front', 'target-b')).toBe(true);
    expect(expiring.getPresentationState()).toMatchObject([{ state: 'active', progressCurrent: 2 }]);
    expect(expiring.reportTargetResolved('destroy-front', 'target-c')).toBe(true);
    expect(expiring.getObjectiveState('destroy-front')).toBe('completed');
  });

  it('uses targetGoal as the presentation total and completion threshold', () => {
    const system = new CoopDefenseSecondaryObjectiveSystem([resolvedObjective({ targetGoal: 2 })]);
    system.hostUpdate(0, false);

    expect(system.reportTargetResolved('destroy-front', 'target-a')).toBe(true);
    expect(system.reportTargetResolved('destroy-front', 'target-b')).toBe(true);
    expect(system.getObjectiveState('destroy-front')).toBe('completed');
    expect(system.getPresentationState()).toMatchObject([{
      progressCurrent: 2,
      progressTotal: 2,
      state: 'completed',
    }]);
    expect(system.reportTargetResolved('destroy-front', 'target-c')).toBe(false);
  });

  it('deduplicates target resolution and exposes only the normalized team reward', () => {
    const system = new CoopDefenseSecondaryObjectiveSystem([resolvedObjective({
      rewards: { xpPerTarget: 25.9 },
    })]);
    system.hostUpdate(0, false);

    expect(system.reportTargetResolved('destroy-front', 'unknown')).toBe(false);
    expect(system.reportTargetResolved('other-objective', 'target-a')).toBe(false);
    expect(system.reportTargetResolved('destroy-front', 'target-a')).toBe(true);
    expect(system.reportTargetResolved('destroy-front', 'target-a')).toBe(false);
    expect(system.getTargetResolutionXp('destroy-front')).toBe(25);

    const withoutReward = new CoopDefenseSecondaryObjectiveSystem([resolvedObjective()]);
    expect(withoutReward.getTargetResolutionXp('destroy-front')).toBe(0);
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
    expect(system.reportTargetResolved('destroy-front', 'target-a')).toBe(false);
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
});
