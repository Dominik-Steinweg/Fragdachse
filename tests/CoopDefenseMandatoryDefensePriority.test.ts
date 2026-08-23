import { describe, expect, it } from 'vitest';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE } from '../src/config';
import type {
  ResolvedCoopDefenseMapMissionProgressConfig,
  ResolvedCoopDefenseMapSecondaryObjectiveConfig,
} from '../src/config/coopDefenseMaps';
import { CoopDefenseMissionProgressSystem } from '../src/systems/CoopDefenseMissionProgressSystem';
import { CoopDefenseSecondaryObjectiveSystem } from '../src/systems/CoopDefenseSecondaryObjectiveSystem';

function world(gridX: number, gridY = 2): { x: number; y: number } {
  return {
    x: ARENA_OFFSET_X + (gridX + 0.5) * CELL_SIZE,
    y: ARENA_OFFSET_Y + (gridY + 0.5) * CELL_SIZE,
  };
}

const missionConfig: ResolvedCoopDefenseMapMissionProgressConfig = {
  checkpoints: [{ id: 'entry', gridX: 2, gridY: 2, radiusCells: 0.25, setRespawn: false }],
  mandatoryDefenses: [{ id: 'defense-entry', checkpointId: 'entry', objectiveId: 'hold-entry' }],
  barriers: [],
};

function mandatoryHold(): ResolvedCoopDefenseMapSecondaryObjectiveConfig {
  return {
    id: 'hold-entry',
    type: 'hold',
    start: { type: 'after-checkpoint', checkpointId: 'entry' },
    targets: ['mandatory-target'],
    targetGoal: 1,
    holdDurationMs: 100,
  };
}

function optionalObjective(
  type: 'destroy' | 'carry',
): ResolvedCoopDefenseMapSecondaryObjectiveConfig {
  if (type === 'carry') {
    return {
      id: 'optional-carry',
      type,
      start: { type: 'time', atMs: 0 },
      targets: [],
      targetGoal: 1,
      carry: {
        spawnZone: { gridX: 0, gridY: 0, widthCells: 1, heightCells: 1 },
        deliveryZone: { gridX: 10, gridY: 0, widthCells: 1, heightCells: 1 },
        itemCount: 1,
      },
    };
  }
  return {
    id: 'optional-destroy',
    type,
    start: { type: 'time', atMs: 0 },
    targets: ['optional-target'],
    targetGoal: 1,
  };
}

function makeSystems(optional: ResolvedCoopDefenseMapSecondaryObjectiveConfig) {
  let missionProgress: CoopDefenseMissionProgressSystem | null = null;
  const objectiveSystem = new CoopDefenseSecondaryObjectiveSystem([optional, mandatoryHold()], {
    isObjectivePriorityRequested: (objectiveId) => (
      missionProgress?.isMandatoryDefenseObjectivePrioritized(objectiveId) ?? false
    ),
    isExternalTriggerSatisfied: (trigger) => (
      trigger.type === 'after-checkpoint'
        ? missionProgress?.isCheckpointActivated(trigger.checkpointId) ?? false
        : false
    ),
  });
  missionProgress = new CoopDefenseMissionProgressSystem(missionConfig, {
    roundRevision: 1,
    getDefenseObjectiveState: (objectiveId) => objectiveSystem.getObjectiveState(objectiveId),
  });
  return { missionProgress, objectiveSystem };
}

function reachMandatoryCheckpoint(
  missionProgress: CoopDefenseMissionProgressSystem,
  objectiveSystem: CoopDefenseSecondaryObjectiveSystem,
): void {
  const start = world(0);
  missionProgress.hostUpdate(0, false, [{ playerId: 'p1', ...start, eligible: true }]);
  objectiveSystem.hostUpdate(0, false);

  missionProgress.hostUpdate(16, false, [{ playerId: 'p1', ...world(2), eligible: true }]);
  objectiveSystem.hostUpdate(16, false);
}

describe('CoopDefense mandatory defense focus priority', () => {
  it.each(['destroy', 'carry'] as const)(
    'takes focus from an active optional %s objective without resetting it',
    (type) => {
      const { missionProgress, objectiveSystem } = makeSystems(optionalObjective(type));

      objectiveSystem.hostUpdate(0, false);
      expect(objectiveSystem.getFocusedObjectiveId()).toBe(`optional-${type}`);

      reachMandatoryCheckpoint(missionProgress, objectiveSystem);

      expect(missionProgress.getPresentationState().routeLockDefenseId).toBe('defense-entry');
      expect(objectiveSystem.getObjectiveState(`optional-${type}`)).toBe('active');
      expect(objectiveSystem.getFocusedObjectiveId()).toBe('hold-entry');
      expect(objectiveSystem.getPresentationState()).toEqual(expect.arrayContaining([
        expect.objectContaining({ objectiveId: `optional-${type}`, state: 'active', focused: false }),
        expect.objectContaining({ objectiveId: 'hold-entry', state: 'active', focused: true }),
      ]));
    },
  );

  it('does not activate the mandatory Hold before its after-checkpoint trigger', () => {
    const { missionProgress, objectiveSystem } = makeSystems(optionalObjective('destroy'));

    objectiveSystem.hostUpdate(0, false);

    expect(missionProgress.isCheckpointActivated('entry')).toBe(false);
    expect(missionProgress.getPresentationState().routeLockDefenseId).toBeNull();
    expect(objectiveSystem.getObjectiveState('hold-entry')).toBe('dormant');
    expect(objectiveSystem.getFocusedObjectiveId()).toBe('optional-destroy');
  });

  it('unlocks the route after a completed mandatory Hold and lets the optional objective finish', () => {
    const { missionProgress, objectiveSystem } = makeSystems(optionalObjective('destroy'));
    reachMandatoryCheckpoint(missionProgress, objectiveSystem);

    objectiveSystem.hostUpdate(100, false);
    expect(objectiveSystem.getObjectiveState('hold-entry')).toBe('completed');

    missionProgress.hostUpdate(0, false, [{ playerId: 'p1', ...world(2), eligible: true }]);
    expect(missionProgress.getPresentationState().routeLockDefenseId).toBeNull();
    expect(missionProgress.getDefenseOutcome('defense-entry')).toBe('completed');

    expect(objectiveSystem.reportTargetDestroyed('optional-destroy', 'optional-target')).toBe(0);
    expect(objectiveSystem.getObjectiveState('optional-destroy')).toBe('completed');
  });

  it('unlocks the route after a failed mandatory Hold', () => {
    const { missionProgress, objectiveSystem } = makeSystems(optionalObjective('carry'));
    reachMandatoryCheckpoint(missionProgress, objectiveSystem);

    expect(objectiveSystem.reportTargetDestroyed('hold-entry', 'mandatory-target')).toBe(0);
    expect(objectiveSystem.getObjectiveState('hold-entry')).toBe('failed');

    missionProgress.hostUpdate(0, false, [{ playerId: 'p1', ...world(2), eligible: true }]);
    expect(missionProgress.getPresentationState().routeLockDefenseId).toBeNull();
    expect(missionProgress.getDefenseOutcome('defense-entry')).toBe('failed');
  });

  it('does not let a normal optional Hold displace the existing focus', () => {
    const system = new CoopDefenseSecondaryObjectiveSystem([
      optionalObjective('destroy'),
      {
        ...mandatoryHold(),
        id: 'optional-hold',
        start: { type: 'time', atMs: 0 },
      },
    ], {
      isObjectivePriorityRequested: () => false,
    });

    system.hostUpdate(0, false);

    expect(system.getFocusedObjectiveId()).toBe('optional-destroy');
    expect(system.getObjectiveState('optional-hold')).toBe('dormant');
  });

  it('continues an optional Carry after the mandatory defense has resolved', () => {
    const { missionProgress, objectiveSystem } = makeSystems(optionalObjective('carry'));
    reachMandatoryCheckpoint(missionProgress, objectiveSystem);

    objectiveSystem.reportTargetDestroyed('hold-entry', 'mandatory-target');
    missionProgress.hostUpdate(0, false, [{ playerId: 'p1', ...world(2), eligible: true }]);
    expect(missionProgress.getPresentationState().routeLockDefenseId).toBeNull();

    expect(objectiveSystem.reportCarryDelivered('optional-carry', 'optional-carry:1')).toBe(true);
    expect(objectiveSystem.getObjectiveState('optional-carry')).toBe('completed');
  });
});
