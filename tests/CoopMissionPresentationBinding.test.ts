import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getCoopDefenseMapConfig, type CoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import {
  CoopMissionPresentationBinding,
  type CoopMissionPresentationReadPort,
  type CoopMissionPresentationUiPort,
} from '../src/activity/CoopMissionPresentationBinding';
import { CoopMissionRuntime } from '../src/activity/CoopMissionRuntime';
import type { EnemyEntity } from '../src/entities/EnemyEntity';
import type { SyncedCoopDefenseCarryItem } from '../src/types';
import type { ActivityDescriptor } from '../src/world/ActivityDescriptor';

const activity = (revision: number): ActivityDescriptor => ({
  activityRevision: revision,
  worldRevision: 1,
  kind: 'coop-mission',
  definitionId: 'activity:coop-mission:1',
});

function createHarness(): {
  readonly binding: CoopMissionPresentationBinding;
  readonly runtime: CoopMissionRuntime;
  readonly calls: string[];
  readonly carrySnapshots: readonly SyncedCoopDefenseCarryItem[][];
} {
  const calls: string[] = [];
  const carrySnapshots: SyncedCoopDefenseCarryItem[][] = [];
  const ui: CoopMissionPresentationUiPort = {
    centerHud: {
      resetCoopMissionPresentation: () => calls.push('center:reset'),
      updateLifeStatus: () => calls.push('center:life'),
      updateMainObjectivePresentation: () => calls.push('center:main'),
      updateEncounterPresentation: () => calls.push('center:encounter'),
      updateMissionStackOcclusion: () => calls.push('center:occlusion'),
      updateTutorial: () => calls.push('center:tutorial'),
      updateTutorialStep: () => calls.push('center:tutorial-step'),
    },
    mapEvents: {
      setMapEvents: () => calls.push('map:set'),
      sync: () => calls.push('map:sync'),
      reset: () => calls.push('map:reset'),
    },
    secondaryObjectives: {
      sync: () => calls.push('secondary:sync'),
      updateOcclusionFade: () => calls.push('secondary:occlusion'),
      reset: () => calls.push('secondary:reset'),
    },
    worldSpace: {
      syncEncounterTelegraph: () => calls.push('world:encounter'),
      syncSecondaryObjectiveMarkers: () => calls.push('world:secondary'),
      syncCoopDefenseCarry: (items) => {
        carrySnapshots.push([...items]);
        calls.push('world:carry-items');
      },
      syncEnemyDashVisual: (_enemy: EnemyEntity) => calls.push('world:enemy-dash'),
      resetEnemyDashVisuals: () => calls.push('world:enemy-reset'),
      syncMissionProgress: () => calls.push('world:progress'),
      syncCarryZones: () => calls.push('world:carry'),
      syncObjectiveRepairDrones: () => calls.push('world:repair'),
      syncHostileBaseIndicator: () => calls.push('world:hostile-base'),
      destroy: () => calls.push('world:destroy'),
      reset: () => calls.push('world:reset'),
    },
  };
  const reads: CoopMissionPresentationReadPort = {
    getEncounterPresentationState: () => null,
    getMapEventPresentationState: () => null,
    getSecondaryObjectivePresentationState: () => null,
    getMissionProgressPresentationState: () => null,
    getLocalRespawnBudgetState: () => null,
    getSynchronizedNow: () => 1_000,
    getArenaStartTime: () => 0,
    getHostileBaseProgress: () => null,
    getBossProgress: () => null,
    getEnemyVulnerability: () => false,
    getCarryPresentationItems: () => [],
  };
  const binding = new CoopMissionPresentationBinding(
    getCoopDefenseMapConfig('1') as CoopDefenseMapConfig,
    reads,
    ui,
  );
  const runtime = new CoopMissionRuntime(activity(1));
  return { binding, runtime, calls, carrySnapshots };
}

describe('CoopMissionPresentationBinding', () => {
  it('uses the Activity binding, is idempotent on runtime rebinding, and falls inert after destroy', () => {
    const { binding, runtime, calls } = createHarness();

    runtime.bind(binding);
    binding.sync(16, true);
    expect(calls).toContain('map:set');
    expect(calls).toContain('center:main');
    expect(calls).toContain('center:encounter');
    expect(calls).toContain('secondary:sync');
    expect(calls).toContain('world:encounter');
    expect(calls).toContain('world:secondary');
    expect(calls).toContain('world:carry-items');
    expect(calls).toContain('world:progress');
    expect(calls).toContain('world:carry');
    expect(calls).toContain('world:repair');
    expect(calls).toContain('world:hostile-base');

    const mapSetCount = calls.filter((call) => call === 'map:set').length;
    runtime.setSecondaryObjectiveConfigs([]);
    expect(calls.filter((call) => call === 'map:set')).toHaveLength(mapSetCount);

    runtime.destroy();
    expect(calls).toContain('center:reset');
    expect(calls).toContain('map:reset');
    expect(calls).toContain('secondary:reset');
    expect(calls).toContain('world:reset');
    const callsAfterDestroy = calls.length;
    binding.sync(16, true);
    expect(calls).toHaveLength(callsAfterDestroy);
  });

  it('zieht Enemy-Projection und replizierte Carry-Daten ueber den kanonischen Activity-Step', () => {
    const { binding, runtime, calls, carrySnapshots } = createHarness();
    runtime.bind(binding);
    const enemy = {
      id: 'enemy-a',
      setVulnerable: (active: boolean) => calls.push(`enemy:vulnerable:${active}`),
    } as unknown as EnemyEntity;
    const enemyManager = {
      applySnapshot: () => calls.push('enemy:snapshot'),
      updateClientInterpolation: (factor: number) => calls.push(`enemy:lerp:${factor}`),
      getAllEnemies: () => [enemy],
      setLethalDamageGuard: () => undefined,
      setEnemySpawnedCallback: () => undefined,
      destroy: () => undefined,
      setVisualSink: () => undefined,
    } as never;
    runtime.setEnemyManager(enemyManager);

    runtime.clientPresentationStep({
      stateAvailable: true,
      newSnapshot: true,
      enemySnapshot: null,
      carryItems: [{
        id: 'carry-a', objectiveId: 'objective-a', x: 10, y: 20, holderId: null, state: 'spawned',
      }],
      interpolationFactor: 0.25,
    });
    binding.sync(16, true);

    expect(calls).toContain('enemy:snapshot');
    expect(calls).toContain('enemy:lerp:0.25');
    expect(calls).toContain('world:enemy-dash');
    expect(calls).toContain('enemy:vulnerable:false');
    expect(carrySnapshots.at(-1)).toEqual([
      { id: 'carry-a', objectiveId: 'objective-a', x: 10, y: 20, holderId: null, state: 'spawned' },
    ]);

    const callsAfterDestroy = calls.length;
    runtime.destroy();
    binding.clientPresentationStep({
      stateAvailable: true,
      newSnapshot: true,
      enemySnapshot: null,
      carryItems: [],
      interpolationFactor: 0.25,
    });
    expect(calls).toHaveLength(callsAfterDestroy + 4);
    expect(calls.slice(-4)).toEqual([
      'center:reset',
      'map:reset',
      'secondary:reset',
      'world:reset',
    ]);

    const next = createHarness();
    next.runtime.bind(next.binding);
    next.binding.sync(16, true);
    expect(next.carrySnapshots.at(-1)).toEqual([]);
  });

  it('keeps network access at the composition boundary', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/activity/CoopMissionPresentationBinding.ts'),
      'utf8',
    );
    expect(source).not.toContain("from '../network/bridge'");
    expect(source).not.toContain('NetworkBridge');
    for (const laterPhaseOwner of [
      'secondaryObjectiveMarkers',
      'missionProgress.sync',
      'carryZones',
      'objectiveRepairDrones',
    ]) {
      expect(source).not.toContain(laterPhaseOwner);
    }

    const scene = readFileSync(resolve(process.cwd(), 'src/scenes/ArenaScene.ts'), 'utf8');
    expect(scene).toContain('this.arenaRuntime.presentation.syncCoopMissionPresentation(delta, coopDefensePresentationActive);');
    expect(scene).toContain('this.captureTheBeerPresentation.syncClient(');
    expect(scene).not.toContain('syncClientCaptureTheBeerPresentation');
    expect(scene).not.toContain('syncClientActivitySnapshotPresentation');
    const visualStart = scene.indexOf('// ── Per-frame visuals');
    const updateEnd = scene.indexOf('\n  private ', visualStart);
    const visualSource = scene.slice(visualStart, updateEnd);
    expect(visualSource).not.toContain('updateMainObjectivePresentation');
    expect(visualSource).not.toContain('updateEncounterPresentation');
    expect(visualSource).not.toContain('secondaryObjectiveHud?.sync');
    expect(visualSource).not.toContain('mapEventAnnouncementPresenter?.sync');
    for (const sceneOwnedCoopPresentation of [
      'this.renderers.encounterTelegraph.sync',
      'this.renderers.secondaryObjectiveMarkers.sync',
      'this.renderers.missionProgress.sync',
      'this.renderers.carryZones.sync',
      'this.renderers.objectiveRepairDrones.sync',
      'this.hostileBaseIndicator?.sync',
    ]) {
      expect(visualSource).not.toContain(sceneOwnedCoopPresentation);
    }
  });
});
