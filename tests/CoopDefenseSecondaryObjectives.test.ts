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
        anchor: { kind: 'left-center', edgeInsetCells: 0 },
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

  it('normalizes objective ids, triggers, targets, goals and rewards', () => {
    const normalized = normalizeCoopDefenseMapConfig(makeMap([{
      id: '  destroy-front  ',
      type: 'destroy',
      start: { type: 'time', atMs: -25 },
      activeUntil: { type: 'time', atMs: 500.9 },
      targets: [' friendly-main ', 'friendly-outpost'],
      targetGoal: 99.9,
      rewards: { xpPerTarget: -4.5 },
    }]));

    expect(normalized.secondaryObjectives).toEqual([{
      id: 'destroy-front',
      type: 'destroy',
      start: { type: 'time', atMs: 0 },
      activeUntil: { type: 'time', atMs: 500 },
      targets: ['friendly-main', 'friendly-outpost'],
      targetGoal: 2,
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
      { id: 'first', type: 'destroy', start: { type: 'time', atMs: 100 }, activeUntil: { type: 'time', atMs: 500 }, targets: ['friendly-main'] },
      { id: 'second', type: 'carry', start: { type: 'time', atMs: 400 }, activeUntil: { type: 'time', atMs: 800 }, targets: ['friendly-outpost'] },
    ]))).toThrow('overlapping authored active windows');

    expect(() => normalizeCoopDefenseMapConfig(makeMap([{
      id: 'hold-final',
      type: 'hold',
      start: { type: 'time', atMs: 100 },
      activeUntil: { type: 'after-encounter', encounterId: 'assault-final' },
      targets: ['friendly-outpost'],
    }]))).toThrow('last repel-assault encounter');
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
    expect(system.getPresentationState()).toBeNull();
    system.hostUpdate(1, false);
    expect(system.getPresentationState()).toMatchObject({ objectiveId: 'destroy-front', state: 'active' });
    system.reportObjectiveFailed('destroy-front');
    encounterCleared = true;
    system.hostUpdate(0, false);
    expect(system.getPresentationState()).toMatchObject({ objectiveId: 'after-clear', state: 'active' });

    encounterCleared = false;
    const waiting = new CoopDefenseSecondaryObjectiveSystem([
      resolvedObjective({ start: { type: 'after-encounter', encounterId: 'assault-1' } }),
    ], { isEncounterCleared: () => encounterCleared });
    waiting.hostUpdate(100, false);
    expect(waiting.getPresentationState()).toBeNull();
    encounterCleared = true;
    waiting.hostUpdate(1, false);
    expect(waiting.getPresentationState()).toMatchObject({ state: 'active' });
  });

  it('keeps exactly one active objective and lets the dormant one trigger later', () => {
    const system = new CoopDefenseSecondaryObjectiveSystem([
      resolvedObjective({ id: 'first' }),
      resolvedObjective({ id: 'second' }),
    ]);

    system.hostUpdate(0, false);
    expect(system.getActiveObjectiveId()).toBe('first');
    expect(system.getObjectiveState('second')).toBe('dormant');

    expect(system.reportTargetResolved('first', 'target-a')).toBe(true);
    expect(system.reportTargetResolved('first', 'target-b')).toBe(true);
    expect(system.reportTargetResolved('first', 'target-c')).toBe(true);
    expect(system.getObjectiveState('first')).toBe('resolved');
    system.hostUpdate(0, false);
    expect(system.getActiveObjectiveId()).toBe('second');
  });

  it('resolves on target goal or active-window expiry and keeps counting after resolved', () => {
    const system = new CoopDefenseSecondaryObjectiveSystem([resolvedObjective({
      activeUntil: { type: 'time', atMs: 50 },
    })]);

    system.hostUpdate(0, false);
    expect(system.reportTargetResolved('destroy-front', 'target-a')).toBe(true);
    system.hostUpdate(50, false);
    expect(system.getPresentationState()).toMatchObject({ state: 'resolved', progressCurrent: 1, progressTotal: 3 });
    expect(system.reportTargetResolved('destroy-front', 'target-b')).toBe(true);
    expect(system.reportTargetResolved('destroy-front', 'target-b')).toBe(false);
    expect(system.getPresentationState()).toMatchObject({ state: 'resolved', progressCurrent: 2 });
  });

  it('makes failed terminal without creating a round outcome', () => {
    const system = new CoopDefenseSecondaryObjectiveSystem([resolvedObjective()]);
    system.hostUpdate(0, false);
    expect(system.reportObjectiveFailed('destroy-front')).toBe(true);
    expect(system.getPresentationState()).toMatchObject({ state: 'failed' });
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
    const snapshot = {
      objectiveId: 'destroy-front',
      type: 'destroy' as const,
      state: 'active' as const,
      progressCurrent: 1,
      progressTotal: 3,
      stateChangedAtMs: 125.5,
    };
    bridge.publishCoopDefenseSecondaryObjectivePresentationState(snapshot);
    expect(bridge.getCoopDefenseSecondaryObjectivePresentationState()).toEqual(snapshot);

    globalState.set('cso', { ...snapshot, progressCurrent: 4 });
    expect(bridge.getCoopDefenseSecondaryObjectivePresentationState()).toBeNull();
  });
});
