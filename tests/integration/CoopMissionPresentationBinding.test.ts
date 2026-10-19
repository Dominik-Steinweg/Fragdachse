import { describe, expect, it, vi } from 'vitest';
import { getCoopDefenseMapConfig, type CoopDefenseMapConfig } from '../../src/config/coopDefenseMaps';
import {
  CoopMissionPresentationBinding,
  type CoopMissionPresentationReadPort,
  type CoopMissionPresentationUiPort,
} from '../../src/activity/CoopMissionPresentationBinding';
import { CoopMissionRuntime } from '../../src/activity/CoopMissionRuntime';
import type { EnemyEntity } from '../../src/entities/EnemyEntity';
import type { SyncedCoopDefenseCarryItem } from '../../src/types';
import type { ActivityDescriptor } from '../../src/world/ActivityDescriptor';
import { krakenAbyssMap } from '../../src/dev/scenario/krakenAbyssMap';
import { kraken } from '../krakenNetworkFixtures';

const activity = (revision: number): ActivityDescriptor => ({
  activityRevision: revision,
  worldRevision: 1,
  kind: 'coop-mission',
  definitionId: 'activity:coop-mission:1',
});

function createHarness(mapConfig = getCoopDefenseMapConfig('1') as CoopDefenseMapConfig): {
  readonly reads: CoopMissionPresentationReadPort;
  readonly ui: CoopMissionPresentationUiPort;
  readonly binding: CoopMissionPresentationBinding;
  readonly runtime: CoopMissionRuntime;
  readonly calls: string[];
  readonly carrySnapshots: readonly SyncedCoopDefenseCarryItem[][];
  readonly mortarSnapshots: readonly import('../../src/types').SyncedMortarStrike[][];
  readonly progressTimes: readonly number[];
  readonly bossSnapshots: readonly import('../../src/effects/BossPresenceRenderer').BossPresenceSource[][];
  readonly clock: { now: number; arenaStart: number };
} {
  const calls: string[] = [];
  const carrySnapshots: SyncedCoopDefenseCarryItem[][] = [];
  const mortarSnapshots: import('../../src/types').SyncedMortarStrike[][] = [];
  const progressTimes: number[] = [];
  const bossSnapshots: import('../../src/effects/BossPresenceRenderer').BossPresenceSource[][] = [];
  const clock = { now: 1_000, arenaStart: 0 };
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
      syncMortarStrikes: strikes => { mortarSnapshots.push([...strikes]); },
      syncCoopDefenseCarry: (items) => {
        carrySnapshots.push([...items]);
        calls.push('world:carry-items');
      },
      syncEnemyDashVisual: (_enemy: EnemyEntity) => calls.push('world:enemy-dash'),
      resetEnemyDashVisuals: () => calls.push('world:enemy-reset'),
      syncMissionProgress: (_config, _state, elapsedMs) => {
        calls.push('world:progress');
        progressTimes.push(elapsedMs);
      },
      syncObjectiveRepairDrones: () => calls.push('world:repair'),
      syncMainObjectiveMarkers: () => calls.push('world:hostile-base'),
      syncBossIntro: () => {},
      syncBossPresence: sources => bossSnapshots.push([...sources]),
      bossIntroOwnsSpawn: () => false,
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
    getSynchronizedNow: () => clock.now,
    getArenaStartTime: () => clock.arenaStart,
    getHostileBaseProgress: () => null,
    getBossProgress: () => null,
    getBossIntroState: () => null,
    getEnemyVulnerability: () => false,
    getCarryPresentationItems: () => [],
    getVisibleWorldCentre: () => ({ x: 0, y: 0 }),
  };
  const binding = new CoopMissionPresentationBinding(
    mapConfig,
    reads,
    ui,
  );
  const runtime = new CoopMissionRuntime(activity(1));
  return { reads, ui, binding, runtime, calls, carrySnapshots, mortarSnapshots, progressTimes, bossSnapshots, clock };
}

describe('CoopMissionPresentationBinding', () => {
  it('passes the map clock endpoint to the main objective on the client presentation path', () => {
    const harness = createHarness({ ...getCoopDefenseMapConfig('1'), objective: 'defend-until-dawn',
      surviveDurationSec: 480, dynamicTimeOfDay: { transitions: [
        { start: { type: 'time', atMs: 0 }, targetTimeOfDay: '06:15', durationMs: 480000 },
      ] } });
    const present = vi.spyOn(harness.ui.centerHud, 'updateMainObjectivePresentation');
    harness.runtime.bind(harness.binding);
    harness.binding.sync(16, true);
    expect(present.mock.calls.at(-1)?.[0]?.progressLabel).toContain('06:15');
    harness.runtime.destroy();
  });

  it('names attack directions for the HUD and hands fronts or zones to the edge telegraph', () => {
    const harness = createHarness();
    const encounter = {
      encounterId: 'wave-1', sequenceIndex: 1, sequenceCount: 2, phase: 'incoming' as const,
      phaseStartedAtMs: 0, phaseEndsAtMs: 1000, encounterFronts: ['north' as const], fronts: ['north' as const],
    };
    Object.assign(harness.reads, { getEncounterPresentationState: () => encounter });
    const hud = vi.spyOn(harness.ui.centerHud, 'updateEncounterPresentation');
    const telegraph = vi.spyOn(harness.ui.worldSpace, 'syncEncounterTelegraph');
    harness.runtime.bind(harness.binding);
    harness.binding.sync(16, true);
    expect(hud.mock.calls.at(-1)?.[2]).toEqual(['north']);
    expect(telegraph.mock.calls.at(-1)?.[2]).toEqual({ fronts: ['north'], zones: [] });

    // Replizierte Zonen-IDs kommen als Welt-Rechtecke; die Richtung zählt ab der Bildmitte.
    const nest = { id: 'nest-1', x: 1800, y: -200, width: 200, height: 200 };
    Object.assign(harness.reads, {
      getEncounterPresentationState: () => ({ ...encounter, encounterFronts: [], fronts: [] }),
      getEncounterSpawnZones: () => ({ encounter: [nest], live: [nest] }),
      getVisibleWorldCentre: () => ({ x: 1000, y: 500 }),
    });
    harness.binding.sync(16, true);
    expect(hud.mock.calls.at(-1)?.[2]).toEqual(['northEast']);
    expect(telegraph.mock.calls.at(-1)?.[2]).toEqual({ fronts: [], zones: [nest] });
    harness.runtime.destroy();
  });

  it('presents the mortar slice and clears scene-owned markers on Activity detach', () => {
    const harness = createHarness();
    harness.runtime.bind(harness.binding);
    const shot = { id: 1, sourceEnemyId: 'mortar', sourceX: 0, sourceY: 0, targetX: 800, targetY: 0,
      radius: 90, armedAt: 0, launchAt: 2000, impactAt: 3000, faction: 'hostile' as const };
    harness.runtime.clientPresentationStep({ stateAvailable: true, newSnapshot: true, enemySnapshot: null,
      carryItems: [], mortarStrikes: [shot], interpolationFactor: 0 });
    expect(harness.mortarSnapshots.at(-1)).toEqual([shot]);
    harness.runtime.destroy();
    expect(harness.mortarSnapshots.at(-1)).toEqual([]);
  });
  it('hydrates a submerged Kraken into the local replica scope and detaches reliable callbacks', () => {
    const f = createHarness(krakenAbyssMap()), state = kraken();
    state.boss.scope.worldRevision = 1; state.boss.instance.activityRevision = 1;
    const apply = vi.fn(), hide = vi.fn(), releaseClaw = vi.fn(), releaseHit = vi.fn();
    const localTarget = { ...state.boss, scope: { worldRevision: 1, runtimeGeneration: 99 } };
    const enemy = { sprite: { x: 1, y: 2, setVisible: hide }, getAimAngle: () => 0,
      getAreaClawState: () => ({ revision: 0, attack: null }), getHp: () => 60, getMaxHp: () => 100, setVulnerable() {} };
    const manager = { getCombatTargetRef: () => localTarget, applyKrakenState: apply, getEnemy: () => enemy,
      getAllEnemies: () => [], setSpawnEffectSuppressor() {}, applySnapshot() {}, updateClientInterpolation() {} };
    f.runtime.setEnemyManager(manager as never);
    Object.assign(f.reads, { getKrakenState: () => state,
      subscribeAreaClaw: vi.fn(() => releaseClaw), subscribePartHit: vi.fn(() => releaseHit) });
    const render = vi.fn(); Object.assign(f.ui.worldSpace, { syncKraken: render });
    f.binding.attach(f.runtime); f.binding.attach(f.runtime);
    f.binding.clientPresentationStep({ stateAvailable: true, newSnapshot: true, enemySnapshot: null,
      carryItems: [], mortarStrikes: [], interpolationFactor: 1 });
    expect(apply).toHaveBeenCalledWith({ ...state, boss: localTarget });
    f.binding.sync(16, true);
    expect(render.mock.calls[0][0]).toBe(state); // wire/part identities are not rewritten
    expect(render.mock.calls[0][1].hpRatio).toBe(.6);
    expect(hide).toHaveBeenCalledWith(false);
    f.binding.detach(); f.binding.detach();
    expect(releaseClaw).toHaveBeenCalledOnce(); expect(releaseHit).toHaveBeenCalledOnce();
    render.mockClear(); f.binding.sync(16, true); expect(render).not.toHaveBeenCalled();
  });
  it('freezes displayed mission time and resumes without counting paused combat time', () => {
    const { binding, runtime, clock, progressTimes } = createHarness();
    runtime.bind(binding);
    runtime.setScenarioOptions(true, true, clock.now);
    binding.sync(16, true);
    clock.now += 4000;
    binding.sync(16, true);
    runtime.setScenarioOptions(false, false, clock.now);
    clock.now += 100;
    binding.sync(16, true);
    expect(progressTimes).toEqual([1000, 1000, 1100]);
    runtime.destroy();
  });
  it('passes synchronized round time to checkpoint animation every active frame', () => {
    const { binding, runtime, clock, progressTimes } = createHarness();
    runtime.bind(binding);
    clock.arenaStart = 700;
    binding.sync(16, true);
    clock.now += 250;
    binding.sync(16, true);
    expect(progressTimes).toEqual([300, 550]);
    binding.sync(16, false);
    runtime.destroy();
    binding.sync(16, true);
    expect(progressTimes).toHaveLength(2);
  });

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
    const { binding, runtime, calls, carrySnapshots, bossSnapshots } = createHarness();
    runtime.bind(binding);
    let enemyHp = 100;
    const enemy = {
      id: 'enemy-a',
      kind: 'void-hunter',
      sprite: { x: 80, y: 120, active: true, visible: true },
      getBossPresence: () => undefined,
      getBossPhase: () => 2,
      getHp: () => enemyHp,
      getSize: () => 78,
      isBurrowed: () => false,
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
      setSpawnEffectSuppressor: () => undefined,
    } as never;
    runtime.setEnemyManager(enemyManager);

    runtime.clientPresentationStep({
      stateAvailable: true,
      newSnapshot: true,
      enemySnapshot: null,
      mortarStrikes: [],
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
    expect(bossSnapshots.at(-1)).toEqual([{
      id: enemy.id, x: enemy.sprite.x, y: enemy.sprite.y, size: enemy.getSize(),
      visible: true, voidPhase: enemy.getBossPhase(), presence: undefined,
    }]);
    enemyHp = 0;
    binding.sync(16, true);
    expect(bossSnapshots.at(-1)).toEqual([]);
    expect(carrySnapshots.at(-1)).toEqual([
      { id: 'carry-a', objectiveId: 'objective-a', x: 10, y: 20, holderId: null, state: 'spawned' },
    ]);

    const callsAfterDestroy = calls.length;
    runtime.destroy();
    binding.clientPresentationStep({
      stateAvailable: true,
      newSnapshot: true,
      enemySnapshot: null,
      mortarStrikes: [],
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

});
