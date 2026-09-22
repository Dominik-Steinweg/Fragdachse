import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({
  Scene: class {},
  Core: { Events: { POST_RENDER: 'postrender' } },
  GameObjects: {
    Image: class {}, Sprite: class {}, Container: class {},
    Particles: { ParticleProcessor: class {} },
  },
  Math: {
    Vector2: class {},
    Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    Linear: (a: number, b: number, t: number) => a + (b - a) * t,
    Distance: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) },
  },
  BlendModes: { ADD: 1, NORMAL: 0 },
  Geom: {
    Circle: class {},
    Rectangle: class {
      x = 0; y = 0; width = 0; height = 0;
      constructor(x = 0, y = 0, width = 0, height = 0) { this.setTo(x, y, width, height); }
      setTo(x: number, y: number, width: number, height: number) {
        Object.assign(this, { x, y, width, height });
        return this;
      }
      get left() { return this.x; }
      get right() { return this.x + this.width; }
      get top() { return this.y; }
      get bottom() { return this.y + this.height; }
    },
    Line: class {
      setTo(x1: number, y1: number, x2: number, y2: number) {
        Object.assign(this, { x1, y1, x2, y2 });
        return this;
      }
      static Length(line: { x1: number; y1: number; x2: number; y2: number }) {
        return Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
      }
    },
  },
  Filters: { ParallelFilters: class {}, Displacement: class {} },
}));

import { ArenaScene } from '../../src/scenes/ArenaScene';
import { ArenaLifecycleCoordinator } from '../../src/scenes/arena/ArenaLifecycleCoordinator';
import { ResultApplication } from '../../src/activity/ResultApplication';
import { bridge } from '../../src/network/bridge';
import { registerDiagnosticMap, getCoopDefenseMapConfig, WEAPON_BALANCE_LAB_MAP_ID } from '../../src/config/coopDefenseMaps';

function fixture(host: boolean, outcome = 'victory') {
  let phase = 'LOBBY';
  let complete = () => {};
  let active = false;
  const flow = Object.create(ArenaLifecycleCoordinator.prototype) as any;
  Object.assign(flow, {
    lastPhase: 'ARENA', matchTerminated: false, arenaExitPresentationActive: false, arenaBuilt: true,
    scene: { physics: { world: { pause: vi.fn(), resume: vi.fn() } } }, hostUpdate: { setActive: vi.fn() },
    worldLifecycle: { activity: { descriptor: null, kind: 'pvp' }, endInstance: vi.fn(), syncObservedActivity: vi.fn() },
    worldRuntime: { update: vi.fn(), activity: { runtime: null } },
    persistentBase: { applyRoundConclusion: vi.fn(), rollbackPersistentBaseMissionIfActive: vi.fn() },
    syncRoomOwners: vi.fn(),
    hostSaveRoundResults: vi.fn(), publishRoundConclusion: vi.fn(), clearCoopMissionPresentationState: vi.fn(), clearWorldAdmission: vi.fn(),
  });
  vi.spyOn(bridge, 'isHost').mockReturnValue(host);
  vi.spyOn(bridge, 'getGamePhase').mockImplementation(() => phase as any);
  vi.spyOn(bridge, 'setGamePhase').mockImplementation(value => { phase = value; });
  for (const key of ['publishCoopDefenseRespawnBudgetState', 'hostResetRoundParticipation', 'hostResetAllLobbyReady', 'setLocalReady', 'updateNetwork'] as const) vi.spyOn(bridge, key).mockImplementation(() => {});
  vi.spyOn(bridge, 'getRoundResults').mockReturnValue([]);
  vi.spyOn(bridge, 'getRoundState').mockReturnValue({ status: outcome } as any);
  vi.spyOn(bridge, 'getGameMode').mockReturnValue('coop_defense');
  vi.spyOn(bridge, 'getLocalPlayerId').mockReturnValue('local');
  vi.spyOn(bridge, 'isLocalRoundResultEligible').mockReturnValue(true);
  const scene = Object.create(ArenaScene.prototype) as any;
  const events = new EventEmitter();
  Object.assign(scene, {
    initializationReady: true,
    arenaRuntime: flow, lastObservedGamePhase: 'ARENA', weaponBalanceLabPreviousMapId: null,
    arenaExitFadeComplete: false, arenaExitResultsStarted: false, arenaExitResultsRendered: false,
    arenaExitRenderListener: null, arenaExitOutcomeWaitStartedAt: 0, game: { events }, time: { now: 100 },
    renderers: { gpuVfx: { update: vi.fn() } }, inputBindings: { updateFrame: vi.fn() },
    meta: { beginMatchResults: vi.fn(), tryFinalizeMatchResults: vi.fn() },
    arenaExitFadeOverlay: { isActive: () => active, play: vi.fn((_outcome, callback) => { active = true; complete = callback; }), hide: vi.fn(() => { active = false; }) },
  });
  return { scene, flow, events, completeFade: () => complete(), setPhase: (value: string) => { phase = value; } };
}
afterEach(() => vi.restoreAllMocks());
describe('Rundenende: Arena bis nach Fade und Ergebnis-Render erhalten', () => {
  it('discards a dynamically registered diagnostic round without results, rewards or persistence commits', () => {
    const unregister = registerDiagnosticMap({ ...getCoopDefenseMapConfig(WEAPON_BALANCE_LAB_MAP_ID), mapId: 'performance-exit-test' });
    try {
      const { flow, setPhase } = fixture(true);
      setPhase('ARENA');
      flow.resolveConfiguredCoopDefenseMapId = () => 'performance-exit-test';
      for (const key of ['publishCoopDefenseEncounterPresentationState', 'publishCoopDefenseMapEventPresentationState',
        'publishCoopDefenseSecondaryObjectivePresentationState', 'publishCoopDefenseMissionProgressPresentationState',
        'publishRoundState', 'publishRoundResults'] as const) vi.spyOn(bridge, key).mockImplementation(() => {});
      flow.hostDiscardRound(); flow.hostDiscardRound();
      expect(bridge.getGamePhase()).toBe('LOBBY');
      expect(bridge.publishRoundResults).toHaveBeenCalledWith([]);
      expect(flow.hostSaveRoundResults).not.toHaveBeenCalled();
      expect(flow.persistentBase.applyRoundConclusion).not.toHaveBeenCalled();
      expect(flow.persistentBase.rollbackPersistentBaseMissionIfActive).toHaveBeenCalledOnce();
      expect(flow.worldLifecycle.endInstance).toHaveBeenCalledOnce();
    } finally { unregister(); }
  });
  it.each([[true, 'victory'], [false, 'victory'], [true, 'defeat'], [false, 'defeat']] as const)('haelt Host=%s bei %s bis zum Render', (host, outcome) => {
    const { scene, flow, events, completeFade } = fixture(host, outcome);
    Object.assign(flow, {
      ctx: { leftPanel: { setLobbyFieldsLocked: vi.fn() }, gameAudioSystem: { playMusic: vi.fn() } },
      lobbyOverlay: { setReadyButtonState: vi.fn() },
      resetLocalArenaHudState: vi.fn(), syncLobbyTimeOfDay: vi.fn(), syncLobbySurface: vi.fn(),
    });
    flow.hostUpdate.localPlayerState = {};
    flow.worldLifecycle.descriptor = { definitionId: 'world:match', worldRevision: 1 };
    // Exercise the real lobby transition, with only rendering destruction as a semantic port.
    const teardown = vi.spyOn(flow, 'tearDownArena').mockImplementation(() => flow.clearArenaExitPresentation());
    scene.update(0, 16);
    expect(flow.scene.physics.world.pause).toHaveBeenCalledTimes(1);
    expect(flow.worldRuntime.update).not.toHaveBeenCalled();
    expect(scene.meta.beginMatchResults).not.toHaveBeenCalled();
    events.emit('postrender');
    scene.update(0, 16);
    completeFade();
    expect(scene.meta.beginMatchResults).toHaveBeenCalledTimes(1);
    expect(scene.meta.tryFinalizeMatchResults).toHaveBeenCalledTimes(1);
    scene.update(0, 16);
    expect(teardown).not.toHaveBeenCalled();
    completeFade();
    expect(scene.meta.beginMatchResults).toHaveBeenCalledTimes(1);
    expect(events.listenerCount('postrender')).toBe(1);
    events.emit('postrender');
    expect(teardown).not.toHaveBeenCalled();
    expect(scene.syncArenaExitFade('LOBBY')).toBe(false);
    flow.detectPhaseChange(false);
    flow.detectPhaseChange(false);
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(flow.worldLifecycle.endInstance).toHaveBeenCalledTimes(1);
    expect(flow.syncLobbySurface).toHaveBeenCalledWith(true);
    expect(flow.scene.physics.world.resume).toHaveBeenCalledTimes(1);
  });
  it.each([null, { definitionId: 'world:lobby', worldRevision: 2 }, { definitionId: 'world:match', worldRevision: 1 }])('haelt eintreffende World/Activity-Zustaende %j zurueck', incoming => {
    const { scene, flow } = fixture(false);
    vi.spyOn(bridge, 'getWorldDescriptor').mockReturnValue(incoming as any);
    vi.spyOn(bridge, 'getActivityDescriptor').mockReturnValue(null);
    const teardown = vi.spyOn(flow, 'onTransitionToLobby').mockImplementation(() => {});
    scene.syncArenaExitFade('LOBBY');
    flow.detectWorldChange(true);
    expect(flow.worldLifecycle.syncObservedActivity).not.toHaveBeenCalled();
    expect(flow.worldLifecycle.endInstance).not.toHaveBeenCalled();
    expect(teardown).not.toHaveBeenCalled();
  });
  it('verbucht den Host-Abschluss einmal und sperrt Aktionen ohne World-Abbau', () => {
    const { flow, setPhase } = fixture(true);
    setPhase('ARENA');
    flow.hostCompleteRound(); flow.hostCompleteRound();
    expect(flow.hostSaveRoundResults).toHaveBeenCalledTimes(1);
    expect(flow.persistentBase.applyRoundConclusion).toHaveBeenCalledTimes(1);
    expect(bridge.hostResetAllLobbyReady).toHaveBeenCalledTimes(1);
    expect(bridge.getGamePhase()).toBe('LOBBY');
    expect(flow.worldLifecycle.endInstance).not.toHaveBeenCalled();
    flow.updateWorldRuntime(1000);
    expect(flow.worldRuntime.update).not.toHaveBeenCalled();
    expect(Object.values(flow.getPlayerCapabilities('local')).every(value => value === false)).toBe(true);
  });
  it.each(['victory', 'defeat'] as const)('wendet Coop-%s und Basisabrechnung genau einmal vor dem Abbau an', outcome => {
    const { flow, setPhase } = fixture(true, outcome);
    const activity = { kind: 'coop-mission', definitionId: 'mission:test', worldRevision: 1, activityRevision: 1 };
    flow.worldLifecycle.activity.descriptor = activity;
    const applyBase = vi.fn();
    const publish = vi.fn();
    flow.resultApplication = new ResultApplication({
      getCurrentActivity: () => activity as any,
      resolveVictoryRewardIds: () => [], grantPersistentBaseRewards: vi.fn(),
      applyPersistentBaseOutcome: applyBase,
      clearActivityPresentation: vi.fn(), publishCompletion: publish,
    });
    setPhase('ARENA');
    flow.hostCompleteRound(outcome); flow.hostCompleteRound(outcome);
    expect(applyBase).toHaveBeenCalledTimes(1);
    expect(applyBase).toHaveBeenCalledWith(outcome === 'victory' ? 'commit' : 'rollback', { worldRevision: 1, activityRevision: 1 });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(flow.worldLifecycle.endInstance).not.toHaveBeenCalled();
  });
  it('wartet beim sofortigen Schliessen der gerenderten Auswertung nicht auf die Lobby', () => {
    const { scene, events, completeFade } = fixture(false);
    scene.syncArenaExitFade('LOBBY'); completeFade(); events.emit('postrender');
    scene.matchResultsOverlay = { isVisible: () => false };
    // No lobby readiness port is present: release depends solely on the completed render.
    expect(scene.syncArenaExitFade('LOBBY')).toBe(false);
  });
  it.each([false, true])('raeumt Abbruch auf, auch nach Fade-Ende=%s', afterFade => {
    const { scene, flow, events, completeFade } = fixture(true);
    scene.syncArenaExitFade('LOBBY');
    if (afterFade) completeFade();
    Object.assign(flow, { ctx: { leftPanel: { setLobbyFieldsLocked: vi.fn() } }, lobbyOverlay: { setReadyButtonState: vi.fn(), showArenaFailureMessage: vi.fn() }, syncLobbySurface: vi.fn() });
    vi.spyOn(flow, 'tearDownArena').mockImplementation(() => flow.clearArenaExitPresentation());
    flow.terminateMatch('disconnected'); flow.terminateMatch('disconnected');
    expect(scene.syncArenaExitFade('LOBBY')).toBe(false);
    completeFade(); events.emit('postrender');
    expect(flow.worldLifecycle.endInstance).toHaveBeenCalledTimes(1);
    expect(flow.scene.physics.world.resume).toHaveBeenCalledTimes(1);
    expect(events.listenerCount('postrender')).toBe(0);
    expect(scene.meta.beginMatchResults).toHaveBeenCalledTimes(afterFade ? 1 : 0);
  });
  it('entfernt den ausstehenden Render-Callback beim Scene-Shutdown', () => {
    const { scene, events, completeFade } = fixture(false);
    scene.syncArenaExitFade('LOBBY'); completeFade();
    scene.cancelArenaExitRenderWait(); events.emit('postrender');
    expect(scene.arenaExitResultsRendered).toBe(false);
    expect(events.listenerCount('postrender')).toBe(0);
  });
});


