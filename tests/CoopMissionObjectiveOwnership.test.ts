import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CoopMissionRuntime,
  type CoopMissionObjectiveRuntime,
  type CoopMissionRuntimePorts,
} from '../src/activity/CoopMissionRuntime';
import type { CoopMissionHostUpdatePort } from '../src/activity/CoopMissionHostUpdate';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { ActivityDescriptor } from '../src/world/ActivityDescriptor';
import { CoopDefenseTeamBuffSystem } from '../src/systems/CoopDefenseTeamBuffSystem';

/**
 * Phase 6: Ziele, Fortschritt, Abschluss und die lokale Missionsdarstellung gehoeren der
 * `CoopMissionRuntime`. Der Frame-Owner kennt nur benannte Schritte, und ein Activity-Wechsel in
 * derselben World materialisiert alles davon frisch.
 */

function descriptor(activityRevision = 31): ActivityDescriptor {
  return {
    activityRevision,
    worldRevision: 21,
    kind: 'coop-mission',
    definitionId: 'activity:coop-mission:1',
  };
}

function emptyHostUpdatePort(): CoopMissionHostUpdatePort {
  return {
    getPlayers: () => [],
    getPlayerPosition: () => null,
    isPlayerAlive: () => false,
    isPlayerBurrowed: () => false,
    isPlayerStealthed: () => false,
    canUseMissionActions: () => false,
    getDecoyTargets: () => [],
    getDecoyPosition: () => null,
    isDecoyTargetable: () => false,
    getArmedConstructions: () => [],
    getArmedOutposts: () => [],
    syncDormantBaseStates: () => { /* noop */ },
    getActiveBurnSources: () => [],
    getFireSystem: () => null,
    getSmokeSystem: () => null,
    publishEncounterPresentation: () => { /* noop */ },
    publishMapEventPresentation: () => { /* noop */ },
    publishSecondaryObjectivePresentation: () => { /* noop */ },
  };
}

function ports(
  overrides: {
    hostUpdate?: Partial<CoopMissionHostUpdatePort>;
    missionProgressPresentationState?: unknown;
  } = {},
): CoopMissionRuntimePorts {
  return {
    hostUpdate: { ...emptyHostUpdatePort(), ...overrides.hostUpdate },
    clientPresentation: {
      getMissionProgressPresentationState: () => (
        overrides.missionProgressPresentationState as never ?? null
      ),
    },
  };
}

function objectives(
  calls: string[],
  id: number,
  extras: Partial<CoopMissionObjectiveRuntime> = {},
): CoopMissionObjectiveRuntime {
  return {
    secondaryObjectives: { reset: () => { calls.push(`objectives:${id}:secondary`); } },
    missionProgress: { reset: () => { calls.push(`objectives:${id}:progress`); } },
    barriers: { destroy: () => { calls.push(`objectives:${id}:barriers`); } },
    carry: { destroy: () => { calls.push(`objectives:${id}:carry`); } },
    repair: { reset: () => { calls.push(`objectives:${id}:repair`); } },
    placementReward: { reset: () => { calls.push(`objectives:${id}:placement`); } },
    roundState: null,
    ...extras,
  } as unknown as CoopMissionObjectiveRuntime;
}

describe('CoopMissionRuntime – Ziele, Fortschritt und Abschluss', () => {
  it('macht die Missionsziele ueber genau einen Owner sichtbar', () => {
    const calls: string[] = [];
    const runtime = new CoopMissionRuntime(descriptor(), () => { /* noop */ }, ports());
    const owned = objectives(calls, 1);
    runtime.setObjectives(owned);

    expect(runtime.coopDefenseSecondaryObjectiveSystem).toBe(owned.secondaryObjectives);
    expect(runtime.coopDefenseMissionProgressSystem).toBe(owned.missionProgress);
    expect(runtime.coopDefenseMissionBarrierManager).toBe(owned.barriers);
    expect(runtime.coopDefenseCarrySystem).toBe(owned.carry);
    expect(runtime.coopDefenseObjectiveRepairSystem).toBe(owned.repair);
    expect(runtime.coopDefenseObjectivePlacementRewardSystem).toBe(owned.placementReward);
    expect(() => runtime.setObjectives(objectives(calls, 2)))
      .toThrow(/objective runtime is already attached/);
  });

  it('raeumt Ziele vor Directors, Gegnern und Navigation ab und bleibt idempotent', () => {
    const calls: string[] = [];
    const runtime = new CoopMissionRuntime(descriptor(), () => { /* noop */ }, ports());
    runtime.setObjectives(objectives(calls, 1));
    runtime.setEnemyManager({
      setLethalDamageGuard: () => { /* noop */ },
      setEnemySpawnedCallback: () => { /* noop */ },
      destroy: () => { calls.push('enemy:destroy'); },
      setVisualSink: () => { /* noop */ },
    } as unknown as EnemyManager);

    runtime.destroy();
    runtime.destroy();

    expect(calls).toEqual([
      'objectives:1:carry',
      'objectives:1:placement',
      'objectives:1:repair',
      'objectives:1:secondary',
      'objectives:1:progress',
      'objectives:1:barriers',
      'enemy:destroy',
    ]);
    expect(runtime.coopDefenseMissionProgressSystem).toBeNull();
    expect(runtime.coopDefenseMissionBarrierManager).toBeNull();
  });

  it('materialisiert die Ziele fuer Activity B in derselben World frisch', () => {
    const calls: string[] = [];
    let generation = 0;
    const recipe = (runtime: CoopMissionRuntime): void => {
      runtime.setObjectives(objectives(calls, ++generation));
    };

    const first = new CoopMissionRuntime(descriptor(), () => { /* noop */ }, ports());
    recipe(first);
    first.destroy();

    const second = new CoopMissionRuntime(descriptor(32), () => { /* noop */ }, ports());
    recipe(second);

    expect(generation).toBe(2);
    expect(second.coopDefenseMissionProgressSystem).not.toBeNull();
    expect(calls.filter((entry) => entry.startsWith('objectives:1:'))).toHaveLength(6);
  });

  it('besitzt fuer Activity B einen frischen TeamBuff und leert den alten beim A-Teardown', () => {
    const first = new CoopMissionRuntime(descriptor(), () => { /* noop */ }, ports());
    const firstBuff = new CoopDefenseTeamBuffSystem();
    first.setObjectives(objectives([], 1, { teamBuff: firstBuff }));

    expect(first.coopDefenseTeamBuffSystem).toBe(firstBuff);
    expect(firstBuff.activate({
      defId: 'test-buff',
      durationMs: 10_000,
      hpRegenPerSecond: 1,
      adrenalineRegenMultiplier: 1.2,
    }, 100)).toBe(true);
    first.destroy();
    expect(first.coopDefenseTeamBuffSystem).toBeNull();
    expect(firstBuff.getBuffEndsAt()).toBeNull();

    const second = new CoopMissionRuntime(descriptor(32), () => { /* noop */ }, ports());
    const secondBuff = new CoopDefenseTeamBuffSystem();
    second.setObjectives(objectives([], 2, { teamBuff: secondBuff }));

    expect(second.coopDefenseTeamBuffSystem).toBe(secondBuff);
    expect(secondBuff).not.toBe(firstBuff);
  });
});

describe('CoopMissionRuntime – Missionsschritte des Frames', () => {
  it('haelt die Activity-Reihenfolge im eigenen Owner', () => {
    const order: string[] = [];
    const runtime = new CoopMissionRuntime(descriptor(), () => { /* noop */ }, ports({
      hostUpdate: {
        // Der Weltanteil des Ports wird zwischen Fortschritt und Kampf gelesen.
        syncDormantBaseStates: () => { order.push('world:dormant-bases'); },
      },
    }));
    runtime.setObjectives(objectives([], 1, {
      missionProgress: {
        hostUpdate: () => { order.push('progress'); },
        reset: () => { /* noop */ },
      },
      secondaryObjectives: {
        hostUpdate: () => { order.push('objectives'); },
        getPresentationState: () => null,
        reset: () => { /* noop */ },
      },
      repair: {
        hostUpdate: () => { order.push('repair'); },
        reset: () => { /* noop */ },
      },
    } as unknown as Partial<CoopMissionObjectiveRuntime>));

    runtime.hostSimulationStep(16, 1000, false, false);

    expect(order).toEqual(['progress', 'objectives', 'world:dormant-bases', 'repair']);
  });

  it('meldet den Missionsabschluss, ohne ihn anzuwenden', () => {
    let updates = 0;
    const runtime = new CoopMissionRuntime(descriptor(), () => { /* noop */ }, ports());
    runtime.setObjectives(objectives([], 1, {
      roundState: {
        update: () => { updates += 1; return 'victory'; },
        applyDebugBaseDamage: () => { /* noop */ },
      },
    } as unknown as Partial<CoopMissionObjectiveRuntime>));

    expect(runtime.hostResolveCompletion()).toBe('victory');
    expect(updates).toBe(1);

    runtime.destroy();
    // Nach dem Ende der Activity gibt es kein Ergebnis mehr zu melden.
    expect(runtime.hostResolveCompletion()).toBeNull();
    expect(updates).toBe(1);
  });

  it('stellt den replizierten Missionsstand ueber die eigene Darstellung dar', () => {
    const synced: unknown[] = [];
    const state = { respawnCheckpointId: 'cp-2' };
    const runtime = new CoopMissionRuntime(descriptor(), () => { /* noop */ }, ports({
      missionProgressPresentationState: state,
    }));
    runtime.setObjectives(objectives([], 1, {
      barriers: {
        syncPresentationState: (value: unknown) => { synced.push(value); },
        destroy: () => { /* noop */ },
      },
    } as unknown as Partial<CoopMissionObjectiveRuntime>));

    runtime.clientPresentationStep();
    runtime.destroy();
    runtime.clientPresentationStep();

    expect(synced).toEqual([state]);
  });
});

describe('Phase 6 – Aufbau und Consumer der Missionsziele', () => {
  const coordinator = readFileSync(
    resolve(process.cwd(), 'src/scenes/arena/ArenaLifecycleCoordinator.ts'),
    'utf8',
  );

  it('erzeugt die Ziele als Child-Owner der Activity ueber die Activity-Composition', () => {
    const composition = readFileSync(
      resolve(process.cwd(), 'src/activity/CoopMissionObjectiveComposition.ts'),
      'utf8',
    );
    expect(coordinator).toContain('this.coopMissionComposition.materializeDependents(');
    expect(coordinator).not.toContain('new CoopMissionObjectiveComposition(');
    expect(composition).toContain('runtime.setObjectives({');
    expect(composition).toContain('new CoopDefenseTeamBuffSystem()');
    expect(coordinator).toContain('this.syncCoopMissionCompatibilityBindings(runtime);');
  });

  it('haelt die migrierten Missionssysteme aus dem ArenaContext heraus', () => {
    const context = readFileSync(
      resolve(process.cwd(), 'src/scenes/arena/ArenaContext.ts'),
      'utf8',
    );
    for (const migrated of [
      'coopDefenseSecondaryObjectiveSystem',
      'coopDefenseMissionProgressSystem',
      'coopDefenseMissionBarrierManager',
      'coopDefenseCarrySystem',
      'coopDefenseObjectiveRepairSystem',
      'coopDefenseObjectivePlacementRewardSystem',
      'coopDefenseRoundStateSystem',
    ]) {
      expect(context.includes(migrated), `${migrated} is still a context field`).toBe(false);
      expect(coordinator.includes(`this.ctx.${migrated}`), `${migrated} keeps a context consumer`)
        .toBe(false);
    }
  });

  it('bindet die Missionsbarrieren an die Lifetime der Activity', () => {
    const start = coordinator.indexOf('    runtime.bind({');
    const end = coordinator.indexOf('    this.syncCoopMissionCompatibilityBindings(runtime);', start);
    const binding = coordinator.slice(start, end);
    expect(binding).toContain('current.coopDefenseMissionBarrierManager?.getObstacleRectangles() ?? null');
    expect(binding).toContain('this.ctx.combatSystem.setBarrierObstacles(null);');
  });
});
