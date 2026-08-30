import { describe, expect, it } from 'vitest';
import { CoopMissionPlayerRuntime } from '../src/activity/CoopMissionPlayerRuntime';
import {
  CoopMissionRuntime,
  type CoopMissionNavigationRuntime,
} from '../src/activity/CoopMissionRuntime';
import type { EnemyFlowFieldService } from '../src/systems/EnemyFlowFieldService';
import {
  FlowFieldCoordinator,
  allyFlowFieldId,
} from '../src/systems/flowfield/FlowFieldCoordinator';
import { InlineFlowFieldRunner } from '../src/systems/flowfield/FlowFieldRunner';
import {
  buildStaticKindRaster,
  createFlowFieldTuning,
} from '../src/systems/flowfield/FlowFieldSources';
import type { FlowFieldMetrics } from '../src/systems/flowfield/FlowFieldKernel';
import type { ActivityDescriptor } from '../src/world/ActivityDescriptor';
import { WorldRuntime } from '../src/world/WorldRuntime';
import type { WorldRuntimeContext } from '../src/world/WorldRuntimeContext';
import {
  PlayerWorldRuntime,
  resolvePlayerRuntimeFeatures,
} from '../src/world/PlayerWorldRuntime';
import type { ArenaLayout, PlayerProfile } from '../src/types';

const METRICS: FlowFieldMetrics = {
  cols: 8,
  rows: 6,
  cellSize: 32,
  arenaOffsetX: 0,
  arenaOffsetY: 0,
};

const LAYOUT = {
  seed: 1,
  rocks: [],
  trees: [],
  tracks: [],
  dirt: [],
  powerUpPedestals: [],
} as unknown as ArenaLayout;

function activityDescriptor(activityRevision: number): ActivityDescriptor {
  return {
    activityRevision,
    worldRevision: 21,
    kind: 'coop-mission',
    definitionId: `activity:coop-mission:${activityRevision}`,
  };
}

function createNavigation(): {
  readonly coordinator: FlowFieldCoordinator;
  readonly navigation: CoopMissionNavigationRuntime;
} {
  const coordinator = new FlowFieldCoordinator({
    metrics: METRICS,
    tuning: createFlowFieldTuning(),
    staticKind: buildStaticKindRaster(LAYOUT, METRICS),
    bases: [],
    activeBaseIds: new Set(),
    obstacleCellProvider: () => [],
    runner: new InlineFlowFieldRunner(),
    navTickIntervalMs: 50,
  });
  const inertFlowField = { destroy: () => {} } as unknown as EnemyFlowFieldService;
  return {
    coordinator,
    navigation: {
      coordinator,
      enemy: inertFlowField,
      player: inertFlowField,
      strategic: inertFlowField,
      boss: null,
      targetCatalog: { clear: () => {} },
      strategicTarget: { clear: () => {} },
      releaseGridChanges: () => {},
    } as unknown as CoopMissionNavigationRuntime,
  };
}

function createActivity(activityRevision: number): {
  readonly runtime: CoopMissionRuntime;
  readonly playerActivity: CoopMissionPlayerRuntime;
  readonly coordinator: FlowFieldCoordinator;
} {
  const activityRuntime = new CoopMissionRuntime(activityDescriptor(activityRevision));
  const { coordinator, navigation } = createNavigation();
  activityRuntime.setNavigation(navigation);
  const playerActivity = new CoopMissionPlayerRuntime({
    respawnBudget: null,
    releaseMissionObjectives: () => {},
    ensureAllyFlowField: (playerId) => { activityRuntime.ensureAllyFlowField(playerId); },
    removeAllyFlowField: (playerId) => { activityRuntime.removeAllyFlowField(playerId); },
    publishRespawnBudget: () => {},
  });
  activityRuntime.setPlayerActivity(playerActivity);
  return { runtime: activityRuntime, playerActivity, coordinator };
}

function allyFieldIds(coordinator: FlowFieldCoordinator): string[] {
  return Object.keys(coordinator.getDiagnostics().fields)
    .filter((fieldId) => fieldId.startsWith('ally:'));
}

function createWorld(): { readonly world: WorldRuntime; readonly players: PlayerWorldRuntime } {
  const world = new WorldRuntime({
    descriptor: {
      worldRevision: 21,
      definitionId: 'world:coop-defense:1',
      seed: 1,
      generatorVersion: 3,
      layoutFingerprint: 'test',
    },
  } as WorldRuntimeContext);
  const players = new PlayerWorldRuntime({ attach: [], detach: [] });
  world.setPlayers(players);
  players.attach(
    {
      profile: { id: 'p1', name: 'Dachs', colorHex: '#fff' } as unknown as PlayerProfile,
      reconnectAfterDeath: false,
    },
    resolvePlayerRuntimeFeatures({ isHost: true, participation: 'interactive' }),
  );
  return { world, players };
}

describe('Coop-Ally-Flowfield-Lifetime', () => {
  it('registriert beim Activity-Join genau ein persoenliches Feld', () => {
    const activity = createActivity(1);
    try {
      activity.playerActivity.attach('p1');

      expect(activity.runtime.allyFlowFields.size).toBe(1);
      expect(allyFieldIds(activity.coordinator)).toEqual([allyFlowFieldId('p1')]);
      expect(activity.coordinator.getFieldView(allyFlowFieldId('p1'))).not.toBeNull();
    } finally {
      activity.runtime.destroy();
    }
  });

  it('macht doppeltes Attach und Ensure idempotent', () => {
    const activity = createActivity(1);
    try {
      activity.playerActivity.attach('p1');
      activity.playerActivity.attach('p1');
      activity.runtime.ensureAllyFlowField('p1');
      activity.runtime.ensureAllyFlowField('p1');

      expect(activity.runtime.allyFlowFields.size).toBe(1);
      expect(allyFieldIds(activity.coordinator)).toEqual([allyFlowFieldId('p1')]);
    } finally {
      activity.runtime.destroy();
    }
  });

  it('entfernt beim Leave Map-Eintrag und Coordinator-Ressource vollstaendig', () => {
    const activity = createActivity(1);
    try {
      activity.playerActivity.attach('p1');
      const field = activity.runtime.allyFlowFields.get('p1');

      activity.playerActivity.detach('p1');
      activity.playerActivity.detach('p1');

      expect(field).toBeDefined();
      expect(activity.runtime.allyFlowFields.has('p1')).toBe(false);
      expect(activity.coordinator.getFieldView(allyFlowFieldId('p1'))).toBeNull();
      expect(allyFieldIds(activity.coordinator)).toEqual([]);
    } finally {
      activity.runtime.destroy();
    }
  });

  it('erzeugt beim Rejoin ein frisches Feld', () => {
    const activity = createActivity(1);
    try {
      activity.playerActivity.attach('p1');
      const oldField = activity.runtime.allyFlowFields.get('p1');
      const oldView = activity.coordinator.getFieldView(allyFlowFieldId('p1'));

      activity.playerActivity.detach('p1');
      activity.playerActivity.attach('p1');

      expect(activity.runtime.allyFlowFields.get('p1')).not.toBe(oldField);
      expect(activity.coordinator.getFieldView(allyFlowFieldId('p1'))).not.toBe(oldView);
      expect(allyFieldIds(activity.coordinator)).toEqual([allyFlowFieldId('p1')]);
    } finally {
      activity.runtime.destroy();
    }
  });

  it('ersetzt A durch B in derselben World ohne World-Player-Rebuild', () => {
    const { world, players } = createWorld();
    const activityA = createActivity(1);
    const activityB = createActivity(2);
    try {
      world.activity.attach(activityDescriptor(1), activityA.runtime);
      activityA.playerActivity.attach('p1');
      const fieldA = activityA.runtime.allyFlowFields.get('p1');

      world.activity.attach(activityDescriptor(2), activityB.runtime);
      activityB.playerActivity.attach('p1');

      expect(fieldA).toBeDefined();
      expect(activityA.runtime.allyFlowFields.size).toBe(0);
      expect(activityA.coordinator.getFieldView(allyFlowFieldId('p1'))).toBeNull();
      expect(activityB.runtime.allyFlowFields.size).toBe(1);
      expect(activityB.runtime.allyFlowFields.get('p1')).not.toBe(fieldA);
      expect(players.isAttached('p1')).toBe(true);
    } finally {
      world.destroy();
      activityA.runtime.destroy();
      activityB.runtime.destroy();
    }
  });

  it('bleibt nach individuellem Leave beim Activity-Destroy idempotent', () => {
    const activity = createActivity(1);
    activity.playerActivity.attach('p1');
    activity.playerActivity.detach('p1');

    expect(() => {
      activity.runtime.destroy();
      activity.runtime.destroy();
    }).not.toThrow();
    expect(activity.runtime.allyFlowFields.size).toBe(0);
    expect(allyFieldIds(activity.coordinator)).toEqual([]);
  });

  it('erzeugt ohne Coop-Activity im World-Player-Lifecycle kein Ally-Feld', () => {
    const { world, players } = createWorld();
    try {
      expect(players.isAttached('p1')).toBe(true);
      expect(world.activity.isAttached()).toBe(false);
      expect(world.activity.descriptor).toBeNull();
    } finally {
      world.destroy();
    }
  });
});
