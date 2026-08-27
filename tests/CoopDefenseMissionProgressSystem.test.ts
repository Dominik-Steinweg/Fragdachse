import { describe, expect, it, vi } from 'vitest';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE } from '../src/config';
import type { ResolvedCoopDefenseMapMissionProgressConfig } from '../src/config/coopDefenseMaps';
import { CoopDefenseMissionProgressSystem } from '../src/systems/CoopDefenseMissionProgressSystem';
import type { CoopDefenseSecondaryObjectiveState } from '../src/types';
import { resolveActiveArenaWorldMetrics } from '../src/world/WorldMetrics';

const TEST_WORLD_METRICS = resolveActiveArenaWorldMetrics();

function world(gridX: number, gridY = 2): { x: number; y: number } {
  return {
    x: ARENA_OFFSET_X + (gridX + 0.5) * CELL_SIZE,
    y: ARENA_OFFSET_Y + (gridY + 0.5) * CELL_SIZE,
  };
}

function config(): ResolvedCoopDefenseMapMissionProgressConfig {
  return {
    checkpoints: [
      { id: 'entry', gridX: 2, gridY: 2, radiusCells: 0.25, setRespawn: true },
      { id: 'exit', gridX: 8, gridY: 2, radiusCells: 0.25, setRespawn: false },
    ],
    mandatoryDefenses: [{ id: 'hold-entry', checkpointId: 'entry', objectiveId: 'hold-objective' }],
    barriers: [{
      id: 'gate',
      cells: [{ gridX: 5, gridY: 2 }],
      openOn: { type: 'after-defense', defenseId: 'hold-entry' },
    }],
  };
}

describe('CoopDefenseMissionProgressSystem', () => {
  it('activates every ordered checkpoint crossed by one fast movement segment', () => {
    const fastRoute: ResolvedCoopDefenseMapMissionProgressConfig = {
      checkpoints: [2, 5, 8].map((gridX, index) => ({
        id: `checkpoint-${index}`,
        gridX,
        gridY: 2,
        radiusCells: 0.25,
        setRespawn: false,
      })),
      mandatoryDefenses: [],
      barriers: [],
    };
    const system = new CoopDefenseMissionProgressSystem(fastRoute, {
      roundRevision: 1,
      getDefenseObjectiveState: () => null,
      worldMetrics: TEST_WORLD_METRICS,
    });

    system.hostUpdate(0, false, [{ playerId: 'p1', ...world(0), eligible: true }]);
    system.hostUpdate(16, false, [{ playerId: 'p1', ...world(10), eligible: true }]);

    expect(fastRoute.checkpoints.every(({ id }) => system.isCheckpointActivated(id))).toBe(true);
    expect(system.isRouteComplete()).toBe(true);
  });

  it('detects a fast segment, stops at the mandatory gate and unlocks on success', () => {
    let defenseState: CoopDefenseSecondaryObjectiveState = 'dormant';
    const publish = vi.fn();
    const system = new CoopDefenseMissionProgressSystem(config(), {
      roundRevision: 7,
      getDefenseObjectiveState: () => defenseState,
      onPresentationChanged: publish,
      worldMetrics: TEST_WORLD_METRICS,
    });
    const before = world(0);
    const beyondEverything = world(10);

    system.hostUpdate(0, false, [{ playerId: 'p1', ...before, eligible: true }]);
    system.hostUpdate(16, false, [{ playerId: 'p1', ...beyondEverything, eligible: true }]);

    expect(system.isCheckpointActivated('entry')).toBe(true);
    expect(system.isCheckpointActivated('exit')).toBe(false);
    expect(system.getPresentationState()).toMatchObject({
      roundRevision: 7,
      missionRevision: 1,
      routeLockDefenseId: 'hold-entry',
      respawnCheckpointId: 'entry',
      routeComplete: false,
    });

    defenseState = 'completed';
    system.hostUpdate(16, false, [{ playerId: 'p1', ...beyondEverything, eligible: true }]);
    expect(system.getDefenseOutcome('hold-entry')).toBe('completed');
    expect(system.isBarrierOpen('gate')).toBe(true);
    // Die waehrend der Sperre aktualisierte Position erzeugt keine rueckwirkende Ueberquerung.
    expect(system.isCheckpointActivated('exit')).toBe(false);

    const beforeExit = world(7);
    system.resetPlayerPosition('p1', beforeExit.x, beforeExit.y);
    system.hostUpdate(0, false, [{ playerId: 'p1', ...beforeExit, eligible: true }]);
    system.hostUpdate(16, false, [{ playerId: 'p1', ...world(9), eligible: true }]);
    expect(system.isRouteComplete()).toBe(true);
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it('treats a failed mandatory defense as terminal without reward semantics or softlock', () => {
    let defenseState: CoopDefenseSecondaryObjectiveState = 'active';
    const system = new CoopDefenseMissionProgressSystem(config(), {
      roundRevision: 1,
      getDefenseObjectiveState: () => defenseState,
      worldMetrics: TEST_WORLD_METRICS,
    });
    system.hostUpdate(1, false, [{ playerId: 'p1', ...world(2), eligible: true }]);
    defenseState = 'failed';
    system.hostUpdate(1, false, [{ playerId: 'p1', ...world(3), eligible: true }]);

    expect(system.isDefenseResolved('hold-entry')).toBe(true);
    expect(system.getDefenseOutcome('hold-entry')).toBe('failed');
    expect(system.getPresentationState().routeLockDefenseId).toBeNull();
  });

  it('ignores spectators and resets teleport segments at the target position', () => {
    const system = new CoopDefenseMissionProgressSystem(config(), {
      roundRevision: 1,
      getDefenseObjectiveState: () => 'dormant',
      worldMetrics: TEST_WORLD_METRICS,
    });
    system.resetPlayerPosition('spectator', world(0).x, world(0).y);
    system.hostUpdate(1, false, [{ playerId: 'spectator', ...world(4), eligible: false }]);
    expect(system.isCheckpointActivated('entry')).toBe(false);

    const beyond = world(4);
    system.resetPlayerPosition('p1', beyond.x, beyond.y);
    system.hostUpdate(1, false, [{ playerId: 'p1', ...beyond, eligible: true }]);
    expect(system.isCheckpointActivated('entry')).toBe(false);
  });
});
