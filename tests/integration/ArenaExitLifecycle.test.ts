import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/assets/WoodlandAssets',()=>({preloadWoodlandAssets:vi.fn(),assertWoodlandAssetsReady:vi.fn()}));
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
import * as devScenarioMode from '../../src/utils/devScenarioMode';
import { DEFAULT_COOP_DEFENSE_MAP_ID } from '../../src/config/coopDefenseMaps';
import { registerDiagnosticMap, getCoopDefenseMapConfig, WEAPON_BALANCE_LAB_MAP_ID } from '../../src/config/coopDefenseMaps';
import { CoopDefenseBalanceTracker } from '../../src/debug/coopDefenseBalance/tracker';
import { invalidateLocalStorageCache } from '../../src/utils/localPreferences';

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
  it('preserves the real Ready round identity through pre-completion balance capture and finalization', () => {
    const { flow, scene } = fixture(true);
    let roundState: any = null;
    let roundRevision = 0;
    const tracker = new CoopDefenseBalanceTracker();
    vi.spyOn(tracker, 'isRecordingEnabled').mockReturnValue(true);
    for (const method of ['publishLobbySync', 'setMatchHostId', 'resetAllFrags', 'resetCoopDefenseRoundXp',
      'publishRoundResults', 'publishCoopDefenseEncounterPresentationState', 'publishCoopDefenseMapEventPresentationState',
      'publishCoopDefenseSecondaryObjectivePresentationState', 'publishCoopDefenseMissionProgressPresentationState',
      'setArenaStartTime', 'setRoundEndTime', 'requestFullGameState'] as const) {
      vi.spyOn(bridge, method).mockImplementation(() => {});
    }
    vi.spyOn(bridge, 'areAllPlayersReady').mockReturnValue(true);
    vi.spyOn(bridge, 'getLobbyTimeOfDayMinutes').mockReturnValue(720);
    vi.spyOn(bridge, 'getCoopDefenseMapId').mockReturnValue(DEFAULT_COOP_DEFENSE_MAP_ID);
    vi.spyOn(bridge, 'getConnectedPlayerIds').mockReturnValue(['local']);
    vi.spyOn(bridge, 'getConnectedPlayers').mockReturnValue([{ id: 'local', name: 'Local', colorHex: 0xffffff }]);
    vi.spyOn(bridge, 'hostStartRoundParticipants').mockImplementation((_ids, _time, revision) => { roundRevision = revision!; });
    vi.spyOn(bridge, 'publishRoundState').mockImplementation(value => { roundState = value; });
    vi.mocked(bridge.getRoundState).mockImplementation(() => roundState);
    vi.spyOn(bridge, 'getRoundParticipation').mockImplementation(() => ({
      roundRevision, roundStartTime: 0, participantIds: ['local'], spectatorIds: [],
    }));
    vi.spyOn(bridge, 'getRoomCode').mockReturnValue('BALANCE');
    vi.spyOn(bridge, 'getPlayerCommittedLoadout').mockReturnValue(null);
    vi.spyOn(bridge, 'getCoopDefenseRoundXp').mockReturnValue(20);
    vi.spyOn(bridge, 'getPlayerFrags').mockReturnValue(0);
    vi.spyOn(bridge, 'getLocalCoopDefenseRespawnBudgetState').mockReturnValue(null);
    vi.spyOn(bridge, 'getArenaStartTime').mockReturnValue(100);
    vi.spyOn(bridge, 'getRoundResultEligiblePlayerIds').mockReturnValue(['local']);
    Object.assign(flow, {
      lastRoundRevision: 10, roundStartPending: false,
      roomQualityMonitor: { shouldBlockStart: () => false },
      lobbyOverlay: { lockButton: vi.fn() }, onTransitionToArena: vi.fn(),
      getCoopDefenseBaseHpSummary: () => ({ ownBase: null, hostileBase: null }),
      publishRoundConclusion: (ArenaLifecycleCoordinator.prototype as any).publishRoundConclusion,
    });
    Object.assign(scene, {
      resolveConfiguredGameMode: () => 'coop_defense',
      resolveConfiguredCoopDefenseMapId: () => DEFAULT_COOP_DEFENSE_MAP_ID,
      coopDefenseBalanceTracker: tracker,
      ctx: { getWorldCombatCore: () => ({ getHP: () => 100, getMaxHp: () => 100, getArmor: () => 0 }) },
      meta: { getStoredProgress: () => ({ totalXp: 0 }), getProgress: () => ({ level: 1 }) },
    });
    invalidateLocalStorageCache();
    try {
      flow.hostCheckReadyToStart();
      // ArenaScene captures while the real lifecycle-published RoundState is still active.
      scene.prepareCoopDefenseBalanceRound('victory');
      flow.publishRoundConclusion('victory', 1_000);
      const identity = { roomCode: bridge.getRoomCode(), roundRevision: roundState.roundRevision };
      const record = tracker.finalizePendingRound(roundState.endedAt, identity);
      expect(record?.roundIdentity).toEqual(identity);
      expect(tracker.getRound(roundState.endedAt, identity)).toMatchObject({ outcome: 'victory', sharedXp: 20 });
    } finally {
      invalidateLocalStorageCache();
    }
  });
  it.each([[false, true, false], [true, false, false], [true, true, true]])(
    'only an isolated dev host may discard campaign rounds (dev=%s host=%s)', (dev, host, allowed) => {
      vi.spyOn(devScenarioMode, 'isDevScenarioMode').mockReturnValue(dev);
      const { flow, setPhase } = fixture(host);
      setPhase('ARENA'); flow.resolveConfiguredCoopDefenseMapId = () => DEFAULT_COOP_DEFENSE_MAP_ID;
      for (const key of ['publishCoopDefenseEncounterPresentationState', 'publishCoopDefenseMapEventPresentationState',
        'publishCoopDefenseSecondaryObjectivePresentationState', 'publishCoopDefenseMissionProgressPresentationState',
        'publishRoundState', 'publishRoundResults'] as const) vi.spyOn(bridge, key).mockImplementation(() => {});
      flow.hostDiscardRound();
      expect(bridge.getGamePhase()).toBe(allowed ? 'LOBBY' : 'ARENA');
      expect(flow.worldLifecycle.endInstance).toHaveBeenCalledTimes(allowed ? 1 : 0);
      expect(flow.persistentBase.rollbackPersistentBaseMissionIfActive).toHaveBeenCalledTimes(allowed ? 1 : 0);
      expect(flow.persistentBase.applyRoundConclusion).not.toHaveBeenCalled();
    });
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
  it.each([
    { mode: 'coop_defense', outcome: 'victory', tied: false, speaker: 'top' },
    { mode: 'coop_defense', outcome: 'victory', tied: true, speaker: 'top' },
    { mode: 'coop_defense', outcome: 'defeat', tied: false, speaker: null },
    { mode: 'deathmatch', outcome: 'victory', tied: false, speaker: 'top' },
    { mode: 'deathmatch', outcome: 'victory', tied: true, speaker: null },
    { mode: 'team_deathmatch', outcome: 'victory', tied: false, speaker: 'top' },
    { mode: 'team_deathmatch', outcome: 'victory', tied: true, speaker: null },
    { mode: 'capture_the_beer', outcome: 'victory', tied: false, speaker: 'other' },
  ])('gives the final voice to the leaderboard leader: $mode / $outcome / tied=$tied', ({ mode, outcome, tied, speaker }) => {
    fixture(true, outcome);
    const victory = vi.fn();
    vi.spyOn(bridge, 'getRoundState').mockReturnValue({ status: outcome, roundStartTime: 100 } as any);
    vi.spyOn(bridge, 'getRoundResultEligiblePlayerIds').mockReturnValue(['other', 'top']);
    vi.spyOn(bridge, 'getConnectedPlayers').mockReturnValue([
      { id: 'other', name: 'Zoe', colorHex: 0xffffff },
      { id: 'top', name: 'Anna', colorHex: 0xffffff },
    ]);
    vi.spyOn(bridge, 'getPlayerFrags').mockImplementation(id => id === 'top' || tied ? 10 : 2);
    vi.spyOn(bridge, 'getCoopDefenseRoundXp').mockReturnValue(20);
    vi.spyOn(bridge, 'getPlayerTeam').mockImplementation(id => id === 'top' ? 'blue' : 'red');
    vi.spyOn(bridge, 'publishRoundResults').mockImplementation(() => {});
    vi.spyOn(bridge, 'recordCompletedPvpMatch').mockImplementation(() => {});
    vi.spyOn(bridge, 'hostPublishRoomStatistics').mockImplementation(() => {});
    const resultContext = {
      ctx: { voice: { victory } }, resolveConfiguredGameMode: () => mode,
      resolveConfiguredCoopDefenseMapId: () => DEFAULT_COOP_DEFENSE_MAP_ID,
      captureTheBeerActivityRuntime: { system: { getTeamScore: (team: string) => team === 'red' ? 3 : 1 } },
    };
    ArenaLifecycleCoordinator.prototype.hostSaveRoundResults.call(resultContext as any, 1000, true);
    if (speaker) expect(victory).toHaveBeenCalledExactlyOnceWith([speaker]);
    else expect(victory).not.toHaveBeenCalled();
  });
  it('preserves the completed round revision in state and results after live participation is cleared', () => {
    const { flow, setPhase } = fixture(true);
    const activity = { kind: 'coop-mission', definitionId: 'mission:test', worldRevision: 40, activityRevision: 41 };
    let participation: any = { roundRevision: 41 };
    let roundState: any = { status: 'active', roundStartTime: 100, coopDefenseMapId: DEFAULT_COOP_DEFENSE_MAP_ID };
    const publishResults = vi.spyOn(bridge, 'publishRoundResults').mockImplementation(() => {});
    vi.spyOn(bridge, 'publishRoundState').mockImplementation(value => { roundState = value; });
    vi.spyOn(bridge, 'getRoundState').mockImplementation(() => roundState);
    vi.spyOn(bridge, 'getRoundParticipation').mockImplementation(() => participation);
    vi.mocked(bridge.hostResetRoundParticipation).mockImplementation(() => { participation = null; });
    vi.spyOn(bridge, 'getRoundResultEligiblePlayerIds').mockReturnValue(['local']);
    vi.spyOn(bridge, 'getConnectedPlayers').mockReturnValue([{ id: 'local', name: 'Local', colorHex: 0xffffff }] as any);
    vi.spyOn(bridge, 'getPlayerFrags').mockReturnValue(0);
    vi.spyOn(bridge, 'getCoopDefenseRoundXp').mockReturnValue(20);
    vi.spyOn(bridge, 'getArenaStartTime').mockReturnValue(100);
    vi.spyOn(bridge, 'hostPublishRoomStatistics').mockImplementation(() => {});
    Object.assign(flow, {
      ctx: {}, resolveConfiguredGameMode: () => 'coop_defense',
      resolveConfiguredCoopDefenseMapId: () => DEFAULT_COOP_DEFENSE_MAP_ID,
      hostSaveRoundResults: ArenaLifecycleCoordinator.prototype.hostSaveRoundResults,
      publishRoundConclusion: (ArenaLifecycleCoordinator.prototype as any).publishRoundConclusion,
    });
    flow.worldLifecycle.activity.descriptor = activity;
    flow.resultApplication = new ResultApplication({
      getCurrentActivity: () => activity as any,
      resolveVictoryRewardIds: () => [], grantPersistentBaseRewards: vi.fn(),
      applyPersistentBaseOutcome: vi.fn(), clearActivityPresentation: vi.fn(),
      publishCompletion: (completion, endedAt) => flow.publishCoopMissionCompletion(completion, endedAt),
    });
    setPhase('ARENA');
    flow.hostCompleteRound('defeat');
    expect(participation).toBeNull();
    expect(roundState).toMatchObject({ status: 'defeat', roundRevision: 41 });
    expect(publishResults).toHaveBeenCalledWith([expect.objectContaining({
      id: 'local', roundRevision: 41, roundEndedAt: roundState.endedAt, sharedXp: 20,
    })]);
    expect(bridge.getGamePhase()).toBe('LOBBY');
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




describe('Performance lab campaign lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(['1', '7', '15'])('commits before map %s and exits through normal completion before teardown', async mapId => {
    const { createPerformanceLabGamePort } = await import('../../src/debug/performanceLab/gamePort');
    const { buildPerformanceLoadout } = await import('../../src/debug/performanceLab/loadouts');
    vi.stubGlobal('window', { __FD_PERF_REQUEST__: { load: true } });
    vi.spyOn(devScenarioMode, 'isDevScenarioMode').mockReturnValue(false);
    const { flow, setPhase } = fixture(true, 'aborted');
    setPhase('LOBBY');
    let committed: any = null, selectedMap = '1';
    vi.spyOn(bridge, 'getConnectedPlayers').mockReturnValue([{ id: 'local' }] as any);
    vi.spyOn(bridge, 'getCoopDefenseMapId').mockImplementation(() => selectedMap);
    vi.spyOn(bridge, 'setCoopDefenseMapId').mockImplementation(id => { selectedMap = id; });
    vi.spyOn(bridge, 'setGameMode').mockImplementation(() => {});
    vi.spyOn(bridge, 'sendLocalInput').mockImplementation(() => {});
    vi.spyOn(bridge, 'setLocalReadyWithCommittedLoadout').mockImplementation(value => { committed = value; });
    vi.spyOn(bridge, 'getPlayerCommittedLoadout').mockImplementation(() => committed);
    vi.mocked(bridge.setLocalReady).mockImplementation(ready => {
      if (!ready) { expect(bridge.getGamePhase()).toBe('LOBBY'); committed = null; }
    });
    const activity = { kind: 'coop-mission', definitionId: 'activity:coop-mission:' + mapId, worldRevision: 1, activityRevision: 1 };
    flow.worldLifecycle.activity.descriptor = activity;
    flow.worldLifecycle.activity.isActive = () => true;
    vi.spyOn(bridge, 'getActivityDescriptor').mockReturnValue(activity as any);
    const applyBase = vi.fn();
    flow.resultApplication = new ResultApplication({ getCurrentActivity: () => activity as any,
      resolveVictoryRewardIds: () => [], grantPersistentBaseRewards: vi.fn(), applyPersistentBaseOutcome: applyBase,
      clearActivityPresentation: vi.fn(), publishCompletion: vi.fn() });
    vi.mocked(bridge.hostResetAllLobbyReady).mockImplementation(() => { expect(applyBase).toHaveBeenCalledOnce(); committed = null; });
    Object.assign(flow, { committedLoadoutSelections: new WeakMap(), resolveConfiguredGameMode: () => 'coop_defense',
      navigationLabPort: { setNextRoundSeed: vi.fn() }, setIsLocalReady: vi.fn(),
      clearTimeOfDayDebugOverride: vi.fn(), rpcPorts: { heldAction: { clearPlayer: vi.fn() } } });
    const discarded = vi.spyOn(flow, 'hostDiscardRound');
    const aborted = vi.spyOn(flow, 'hostAbortRound');
    const labScene = { cameras: { main: { zoomX: 1, zoomY: 1, setZoom: vi.fn() } } };
    const port = createPerformanceLabGamePort(labScene as any, flow, { getPlayer: () => undefined } as any,
      { getSemanticEventSink: () => vi.fn() } as any, vi.fn(), () => true);
    const commit = buildPerformanceLoadout('GLOCK').commit;
    port.start(mapId, 12345, commit);
    expect(committed).toBe(commit);
    expect(flow.setIsLocalReady).toHaveBeenCalledWith(true);
    setPhase('ARENA');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 100; i++) flow.resolveCommittedLoadoutSelection('local');
    expect(warn).not.toHaveBeenCalled();
    // A rejected exit must not erase the still-running activity's commit or clear active ownership.
    aborted.mockImplementationOnce(() => {});
    expect(() => port.discard()).toThrow('did not enter LOBBY');
    expect(committed).toBe(commit);
    expect(bridge.setLocalReady).not.toHaveBeenCalled();
    port.discard(); port.discard();
    expect(discarded).not.toHaveBeenCalled();
    expect(bridge.getGamePhase()).toBe('LOBBY');
    expect(applyBase).toHaveBeenCalledWith('rollback', { worldRevision: 1, activityRevision: 1 });
    expect(flow.worldLifecycle.endInstance).not.toHaveBeenCalled();
    // The production phase transition, rather than the lab command, owns world teardown.
    Object.assign(flow, { ctx: { leftPanel: { setLobbyFieldsLocked: vi.fn() }, gameAudioSystem: { playMusic: vi.fn() } },
      lobbyOverlay: { setReadyButtonState: vi.fn() }, resetLocalArenaHudState: vi.fn(), syncLobbyTimeOfDay: vi.fn(), syncLobbySurface: vi.fn() });
    flow.hostUpdate.localPlayerState = {};
    flow.worldLifecycle.descriptor = { definitionId: 'world:coop-defense:' + mapId, worldRevision: 1 };
    const teardown = vi.spyOn(flow, 'tearDownArena').mockImplementation(() => flow.clearArenaExitPresentation());
    flow.detectPhaseChange(false);
    expect(teardown).toHaveBeenCalledOnce();
    expect(flow.worldLifecycle.endInstance).toHaveBeenCalledOnce();
  });
  it('warns once per player and activity, keeping the live-slot fallback available', () => {
    const { flow } = fixture(true);
    let activity: any = { activityRevision: 1, worldRevision: 1 };
    flow.worldLifecycle.activity.descriptor = activity;
    flow.worldLifecycle.activity.isActive = () => activity !== null;
    vi.spyOn(bridge, 'getActivityDescriptor').mockImplementation(() => activity);
    vi.spyOn(bridge, 'getPlayerCommittedLoadout').mockReturnValue(null);
    vi.spyOn(bridge, 'getPlayerCurrentLoadoutSnapshot').mockReturnValue(null);
    const fallback = {};
    flow.resolveLoadoutSelection = vi.fn(() => fallback);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 100; i++) expect(flow.resolveCommittedLoadoutSelection('local')).toBe(fallback);
    expect(warn).toHaveBeenCalledOnce();
    flow.resolveCommittedLoadoutSelection('remote');
    expect(warn).toHaveBeenCalledTimes(2);
    activity = { ...activity, activityRevision: 2 }; flow.worldLifecycle.activity.descriptor = activity;
    flow.resolveCommittedLoadoutSelection('local');
    expect(warn).toHaveBeenCalledTimes(3);
    activity = null;
    flow.resolveCommittedLoadoutSelection('lobby-player');
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
