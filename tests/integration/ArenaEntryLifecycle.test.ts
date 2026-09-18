import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Scene: class {},
  Core: { Events: { POST_RENDER: 'postrender' } },
  Scenes: { Events: { SHUTDOWN: 'shutdown' } },
  GameObjects: { Image: class {}, Sprite: class {}, Container: class {},
    Particles: { ParticleProcessor: class {} } },
  Math: { Vector2: class {}, Clamp: (v: number, min: number, max: number) => Math.min(max, Math.max(min, v)),
    Linear: (a: number, b: number, t: number) => a + (b - a) * t,
    Distance: { Between: (x: number, y: number, a: number, b: number) => Math.hypot(x - a, y - b) } },
  BlendModes: { ADD: 1, NORMAL: 0 },
  Geom: { Circle: class {}, Rectangle: class {}, Line: class {} },
  Filters: { ParallelFilters: class {}, Displacement: class {} },
}));
const assets = vi.hoisted(() => ({ start: vi.fn(), getState: vi.fn(() => ({ ready: true, status: 'ready' })) }));
vi.mock('../../src/assets/DeferredAssets', () => ({ getDeferredAssets: () => assets }));

import { ArenaLifecycleCoordinator } from '../../src/scenes/arena/ArenaLifecycleCoordinator';
import { ArenaScene } from '../../src/scenes/ArenaScene';
import { ArenaGenerator } from '../../src/arena/ArenaGenerator';
import { ChunkedRenderSurface } from '../../src/arena/chunks/ChunkedRenderSurface';
import { ArenaCountdownOverlay } from '../../src/ui/ArenaCountdownOverlay';
import { bridge } from '../../src/network/bridge';
import * as config from '../../src/config';

function fixture(host = false, visibleLobby = true) {
  const lobby = { definitionId: 'world:lobby', worldRevision: 10, seed: 1, generatorVersion: 1, layoutFingerprint: 'lobby' };
  const target = { ...lobby, definitionId: 'world:arena', worldRevision: 20, layoutFingerprint: 'arena' };
  const net = { phase: 'ARENA', revision: 20, world: lobby, activity: null as any };
  const timers: Array<{ callback: () => void; remove: ReturnType<typeof vi.fn> }> = [];
  const completions: Record<string, () => void> = {};
  const events = new EventEmitter();
  let covered = false;
  const scene = {
    game: { events }, events: new EventEmitter(),
    sys: { isActive: vi.fn(() => true), isVisible: vi.fn(() => true) },
    physics: { world: { isPaused: false, pause: vi.fn(), resume: vi.fn() } },
    time: { delayedCall: vi.fn((_delay: number, callback: () => void) => {
      const timer = { callback, remove: vi.fn() }; timers.push(timer); return timer;
    }) },
  };
  const countdown = {
    showLoading: vi.fn((options?: { fadeBackdrop: boolean; onCovered: () => void }) => {
      if (!options) return;
      completions.backdrop = () => { covered = true; options.onCovered(); };
      if (!options.fadeBackdrop) completions.backdrop();
    }),
    isLoadingBackdropCovered: vi.fn(() => covered), clear: vi.fn(),
    updateLoadingScreen: vi.fn(),
  };
  const flow = Object.create(ArenaLifecycleCoordinator.prototype) as any;
  Object.assign(flow, {
    scene, arenaTransitionGeneration: 0, arenaEntry: null, arenaTransitionInProgress: false,
    matchTerminated: false, lastPhase: 'LOBBY', arenaBuilt: true, builtWorldRevision: 10,
    layoutRetryCount: 0, lobbySurfaceShown: visibleLobby, roundStartPending: false, lastRoundRevision: 10,
    pendingLobbyWorldReinstance: false, pendingLobbyWorldPresentationRebuild: false,
    worldLifecycle: { descriptor: lobby, activity: { kind: null, descriptor: null },
      endInstance: vi.fn(), syncObservedActivity: vi.fn(), isActive: () => true },
    worldRuntime: { update: vi.fn(), context: {} },
    ctx: { arenaCountdown: countdown,
      leftPanel: { transitionToGame: vi.fn((done?: () => void) => { if (done) completions.panel = done; }),
        transitionToLobby: vi.fn(), setLobbyFieldsLocked: vi.fn() },
      rightPanel: { transitionToGame: vi.fn(), transitionToLobby: vi.fn() },
      centerHUD: { transitionToGame: vi.fn(), transitionToLobby: vi.fn() },
      gameAudioSystem: { stopMusic: vi.fn(), playMusic: vi.fn() } },
    lobbyOverlay: { isPresented: () => visibleLobby, lockButton: vi.fn(), show: vi.fn(),
      hide: vi.fn((done?: () => void) => { if (done) completions.card = done; }),
      setReadyButtonState: vi.fn(), showHostDisconnectedMessage: vi.fn() },
    hostUpdate: { setActive: vi.fn(), localPlayerState: {} },
    hostSyncWorldParticipation: vi.fn(), syncHostLoadoutsFromCommittedSelections: vi.fn(),
    detachAllWorldPlayers: vi.fn(), clearWorldAdmission: vi.fn(),
    buildWorld: vi.fn(), getLocalWorldPresentation: () => ({ required: false }),
    resetLocalArenaHudState: vi.fn(),
    persistentBase: { rollbackPersistentBaseMissionIfActive: vi.fn() }, tearDownArena: vi.fn(),
    roomQualityMonitor: { shouldBlockStart: () => false },
  });
  vi.spyOn(bridge, 'isHost').mockReturnValue(host);
  vi.spyOn(bridge, 'getGamePhase').mockImplementation(() => net.phase as any);
  vi.spyOn(bridge, 'setGamePhase').mockImplementation(phase => { net.phase = phase; });
  vi.spyOn(bridge, 'getWorldDescriptor').mockImplementation(() => net.world);
  vi.spyOn(bridge, 'getActivityDescriptor').mockImplementation(() => net.activity);
  vi.spyOn(bridge, 'getRoundParticipation').mockImplementation(() => ({ roundRevision: net.revision,
    roundStartTime: 0, participantIds: ['local'], spectatorIds: [] }));
  vi.spyOn(bridge, 'getRoundState').mockReturnValue({ status: 'active', roundStartTime: 0 });
  vi.spyOn(bridge, 'getArenaStartTime').mockReturnValue(0);
  vi.spyOn(bridge, 'getLocalPlayerId').mockReturnValue('local');
  vi.spyOn(bridge, 'getLocalWorldParticipation').mockReturnValue('none');
  vi.spyOn(bridge, 'getWorldParticipationState').mockImplementation(() => ({ worldRevision: net.revision,
    participants: { local: 'joining' } }));
  vi.spyOn(bridge, 'getConnectedPlayers').mockReturnValue([]);
  vi.spyOn(bridge, 'getConnectedPlayerIds').mockReturnValue(['local']);
  vi.spyOn(bridge, 'getActiveGameMode').mockReturnValue('deathmatch');
  vi.spyOn(bridge, 'getGameMode').mockReturnValue('deathmatch');
  vi.spyOn(bridge, 'setLocalWorldLoadReady').mockImplementation(() => {});
  vi.spyOn(bridge, 'setLocalWorldLoadProgress').mockImplementation(() => {});
  vi.spyOn(bridge, 'setLocalReady').mockImplementation(() => {});
  const receiveTarget = () => {
    net.world = { ...target, worldRevision: net.revision };
    net.activity = { worldRevision: net.revision, activityRevision: net.revision, kind: 'pvp', definitionId: 'activity:pvp' };
  };
  const finishAnimations = () => { completions.panel?.(); completions.card?.(); completions.backdrop(); };
  return { flow, scene, events, net, timers, completions, countdown, receiveTarget, finishAnimations };
}

beforeEach(() => { assets.getState.mockReturnValue({ ready: true, status: 'ready' }); assets.start.mockClear(); });
afterEach(() => vi.restoreAllMocks());

describe('loading backdrop transition', () => {
  class Surface {
    visible = false; alpha = 1;
    setVisible(value: boolean) { this.visible = value; return this; }
    setAlpha(value: number) { this.alpha = value; return this; }
    setText() { return this; } setScale() { return this; } setPosition() { return this; }
  }
  function overlay() {
    const value = Object.create(ArenaCountdownOverlay.prototype) as any;
    Object.assign(value, { mode: 'hidden', loadingCoveredCallbacks: [],
      loadingBackdrop: new Surface(), loadingRoot: new Surface(), text: new Surface(), focusFallback: new Surface(),
      scene: { tweens: { add: vi.fn(), killTweensOf: vi.fn() } } });
    return value;
  }
  it('fades the existing backdrop independently of content and does not restart on repeated updates', () => {
    const value = overlay(); const complete = vi.fn();
    value.showLoading({ fadeBackdrop: true, onCovered: complete });
    expect(value.loadingBackdrop).toMatchObject({ visible: true, alpha: 0 });
    expect(value.loadingRoot.visible).toBe(true);
    value.loadingBackdrop.alpha = 0.5;
    value.showLoading(); value.showLoading();
    expect(value.loadingBackdrop.alpha).toBe(0.5);
    expect(value.scene.tweens.add).toHaveBeenCalledTimes(2);
    expect(value.isLoadingBackdropCovered()).toBe(false);
    expect(complete).not.toHaveBeenCalled();
    value.loadingBackdrop.alpha = 1;
    const fade = value.scene.tweens.add.mock.calls.find(([config]) => config.targets === value.loadingBackdrop)[0];
    fade.onComplete();
    expect(complete).toHaveBeenCalledOnce();
    expect(value.isLoadingBackdropCovered()).toBe(true);
    // No content onComplete has been awaited.
    expect(value.loadingRoot.alpha).toBe(0);
  });
  it('clears pending completion observers when loading is cancelled', () => {
    const value = overlay(); const complete = vi.fn();
    value.showLoading({ fadeBackdrop: true, onCovered: complete });
    const fade = value.scene.tweens.add.mock.calls[0][0];
    value.clear(); fade.onComplete();
    expect(complete).not.toHaveBeenCalled();
    expect(value.isLoadingBackdropCovered()).toBe(false);
  });
});

describe('Lobby exit gates local Arena work', () => {
  it('keeps host Ready preparation light and delays teardown/generation until after the covered render', () => {
    const f = fixture(true); f.net.phase = 'LOBBY';
    for (const method of ['publishLobbySync', 'setMatchHostId', 'resetAllFrags', 'resetCoopDefenseRoundXp',
      'publishRoundResults', 'publishCoopDefenseEncounterPresentationState', 'publishCoopDefenseMapEventPresentationState',
      'publishCoopDefenseSecondaryObjectivePresentationState', 'publishCoopDefenseMissionProgressPresentationState',
      'setArenaStartTime', 'setRoundEndTime', 'requestFullGameState', 'publishRoundState'] as const) {
      vi.spyOn(bridge, method).mockImplementation(() => {});
    }
    vi.spyOn(bridge, 'areAllPlayersReady').mockReturnValue(true);
    vi.spyOn(bridge, 'getLobbyTimeOfDayMinutes').mockReturnValue(720);
    vi.spyOn(bridge, 'hostStartRoundParticipants').mockImplementation((_ids, _time, revision) => { f.net.revision = revision!; });
    const metrics = vi.spyOn(config, 'applyArenaMetricsForMode');
    const generate = vi.spyOn(ArenaGenerator, 'generate').mockImplementation(() => {
      expect(f.flow.worldLifecycle.endInstance).toHaveBeenCalledOnce();
      return {} as never;
    });
    vi.spyOn(ArenaGenerator, 'fingerprint').mockReturnValue('test');
    f.flow.worldLifecycle.beginCreate = vi.fn((world, activity) => {
      f.net.world = world; f.net.activity = activity; f.flow.worldLifecycle.descriptor = world;
    });
    f.flow.hostCheckReadyToStart();
    expect(bridge.setGamePhase).toHaveBeenCalledWith('ARENA');
    expect(f.flow.isArenaEntryProtected()).toBe(true);
    expect(metrics).not.toHaveBeenCalled();
    expect(f.flow.detachAllWorldPlayers).not.toHaveBeenCalled();
    expect(f.flow.worldLifecycle.endInstance).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    f.finishAnimations(); f.events.emit('postrender');
    expect(generate).not.toHaveBeenCalled();
    f.flow.syncArenaEntryTransition();
    expect(f.timers).toHaveLength(1);
    f.timers[0].callback();
    expect(generate).toHaveBeenCalledOnce();
    expect(f.flow.buildWorld).toHaveBeenCalledOnce();
    f.flow.onTransitionToArena();
    expect(generate).toHaveBeenCalledOnce();
  });

  it.each([false, true])('keeps the World through every completion and render, then builds once (host=%s)', host => {
    const f = fixture(host);
    f.flow.onTransitionToArena();
    expect(f.scene.physics.world.pause).toHaveBeenCalledOnce();
    expect(assets.start).toHaveBeenCalledOnce();
    f.receiveTarget();
    for (const finish of [() => {}, f.completions.panel, f.completions.backdrop, f.completions.card]) {
      finish();
      f.flow.detectWorldChange();
      f.flow.onTransitionToArena();
      f.flow.syncArenaEntryTransition();
      f.flow.syncArenaLoadReady(null);
      expect(f.flow.buildWorld).not.toHaveBeenCalled();
      expect(f.flow.worldLifecycle.endInstance).not.toHaveBeenCalled();
    }
    expect(f.flow.ctx.leftPanel.transitionToGame).toHaveBeenCalledOnce();
    expect(f.flow.lobbyOverlay.hide).toHaveBeenCalledOnce();
    expect(f.timers).toHaveLength(0);
    expect(bridge.setLocalWorldLoadReady).not.toHaveBeenCalled();
    f.events.emit('postrender');
    expect(f.flow.buildWorld).not.toHaveBeenCalled();
    f.flow.syncArenaEntryTransition();
    expect(f.flow.buildWorld).toHaveBeenCalledOnce();
    expect(f.flow.detachAllWorldPlayers).toHaveBeenCalledOnce();
    expect(f.flow.worldLifecycle.endInstance).toHaveBeenCalledOnce();
    f.flow.onTransitionToArena();
    expect(f.flow.buildWorld).toHaveBeenCalledOnce();
  });

  it('does not accept an early render or an invisible Scene as a covered frame', () => {
    const f = fixture(); f.receiveTarget(); f.flow.onTransitionToArena();
    f.events.emit('postrender');
    f.finishAnimations();
    f.flow.syncArenaEntryTransition();
    expect(f.flow.buildWorld).not.toHaveBeenCalled();
    f.scene.sys.isVisible.mockReturnValue(false);
    f.events.emit('postrender'); f.flow.syncArenaEntryTransition();
    expect(f.flow.buildWorld).not.toHaveBeenCalled();
    f.scene.sys.isVisible.mockReturnValue(true);
    f.events.emit('postrender'); f.flow.syncArenaEntryTransition();
    expect(f.flow.buildWorld).toHaveBeenCalledOnce();
  });

  it('waits only for a covered render on direct entry', () => {
    const f = fixture(false, false); f.receiveTarget(); f.flow.onTransitionToArena();
    expect(f.countdown.showLoading).toHaveBeenCalledWith(expect.objectContaining({ fadeBackdrop: false }));
    expect(f.flow.ctx.leftPanel.transitionToGame).not.toHaveBeenCalled();
    expect(f.flow.buildWorld).not.toHaveBeenCalled();
    f.events.emit('postrender'); f.flow.syncArenaEntryTransition();
    expect(f.flow.buildWorld).toHaveBeenCalledOnce();
  });

  it('retargets a newer revision without restarting or bypassing the unfinished exit', () => {
    const f = fixture(); f.flow.onTransitionToArena(); f.completions.backdrop();
    f.net.revision++; f.receiveTarget(); f.flow.syncArenaEntryTransition();
    f.events.emit('postrender'); f.flow.syncArenaEntryTransition();
    expect(f.flow.buildWorld).not.toHaveBeenCalled();
    f.completions.card(); f.completions.panel();
    f.events.emit('postrender'); f.flow.syncArenaEntryTransition();
    expect(f.flow.buildWorld).toHaveBeenCalledWith(f.net.world, f.net.activity, false);
    expect(f.flow.ctx.leftPanel.transitionToGame).toHaveBeenCalledOnce();
  });

  it.each(['animation', 'render', 'descriptor', 'assets'])('invalidates late continuations on abort during %s', stage => {
    const f = fixture();
    if (stage === 'assets') { f.receiveTarget(); assets.getState.mockReturnValue({ ready: false, status: 'loading' }); }
    f.flow.onTransitionToArena();
    if (stage !== 'animation') f.finishAnimations();
    if (stage === 'descriptor' || stage === 'assets') { f.events.emit('postrender'); f.flow.syncArenaEntryTransition(); }
    const oldTimers = [...f.timers];
    f.flow.terminateMatch();
    // Even an already-dispatched callback must be harmless after a fresh start.
    f.flow.matchTerminated = false;
    for (const finish of Object.values(f.completions)) finish();
    for (const timer of oldTimers) timer.callback();
    f.events.emit('postrender');
    expect(f.flow.buildWorld).not.toHaveBeenCalled();
    expect(f.events.listenerCount('postrender')).toBe(0);
    expect(f.scene.physics.world.resume).toHaveBeenCalledOnce();
    for (const timer of oldTimers) expect(timer.remove).toHaveBeenCalled();
  });

  it('keeps a single descriptor retry chain despite World detections', () => {
    const f = fixture(); f.flow.onTransitionToArena(); f.finishAnimations();
    f.events.emit('postrender'); f.flow.syncArenaEntryTransition();
    expect(f.timers).toHaveLength(1);
    f.flow.onTransitionToArena(); f.flow.detectWorldChange();
    expect(f.timers).toHaveLength(1);
    f.receiveTarget(); f.timers[0].callback();
    f.flow.onTransitionToArena();
    expect(f.flow.buildWorld).toHaveBeenCalledOnce();
  });

  it('does not publish readiness for a descriptor that has not been built', () => {
    const f = fixture(); f.receiveTarget();
    f.flow.syncArenaLoadReady(null);
    expect(bridge.setLocalWorldLoadReady).not.toHaveBeenCalled();
    expect(bridge.setLocalWorldLoadProgress).not.toHaveBeenCalled();
  });

  it('does not resume a rendered entry after a Lobby return, even with an old Arena descriptor', () => {
    const f = fixture(); f.receiveTarget(); f.flow.onTransitionToArena(); f.finishAnimations();
    f.events.emit('postrender');
    f.flow.lastPhase = 'ARENA'; f.net.phase = 'LOBBY';
    f.flow.syncArenaEntryTransition();
    expect(f.flow.buildWorld).not.toHaveBeenCalled();
    expect(f.flow.isArenaEntryProtected()).toBe(false);
  });

  it('does not let an obsolete host-generation callback clear a newer pending timer', () => {
    const f = fixture(true, false);
    const request = { roundRevision: 20, gameMode: 'deathmatch', mapConfig: null, seed: 1 };
    f.flow.pendingHostArenaGeneration = request;
    f.flow.scheduleHostArenaGeneration(request);
    const old = f.timers[0];
    f.flow.cancelArenaEntry();
    f.net.revision = 21;
    const next = { ...request, roundRevision: 21 };
    f.flow.pendingHostArenaGeneration = next;
    f.flow.scheduleHostArenaGeneration(next);
    old.callback();
    f.flow.scheduleHostArenaGeneration(next);
    expect(f.timers).toHaveLength(2);
    expect(f.flow.buildWorld).not.toHaveBeenCalled();
  });

  it('does not spend watchdog time while assets or the exit are unfinished', () => {
    const f = fixture(false, false); f.receiveTarget();
    f.flow.arenaBuilt = false; f.flow.lastPhase = 'ARENA'; f.flow.arenaEnteredAt = 1;
    assets.getState.mockReturnValue({ ready: false, status: 'loading' });
    f.flow.onTransitionToArena(); f.flow.detectPhaseChange();
    expect(f.flow.matchTerminated).toBe(false);
    f.events.emit('postrender'); f.flow.syncArenaEntryTransition();
    f.flow.arenaEnteredAt = 1; f.flow.detectPhaseChange();
    expect(f.flow.matchTerminated).toBe(false);
    expect(f.flow.layoutRetryCount).toBe(0);
  });

  it('keeps an already-running network countdown behind loading until the local World is ready', () => {
    const f = fixture(false, false); f.receiveTarget(); f.flow.onTransitionToArena();
    f.events.emit('postrender'); f.flow.syncArenaEntryTransition();
    const scene = Object.create(ArenaScene.prototype) as any;
    Object.assign(f.countdown, { update: vi.fn(), syncTo: vi.fn(), isLoading: () => true });
    Object.assign(scene, { initializationReady: true, ctx: f.flow.ctx, arenaRuntime: f.flow,
      localPlayerState: { alive: true }, getArenaLoadingScreenState: () => ({}) });
    vi.spyOn(bridge, 'isArenaLoading').mockReturnValue(false);
    vi.spyOn(bridge, 'isArenaStarted').mockReturnValue(true);
    scene.syncArenaFogOverlay(1000, true, false);
    expect(f.countdown.syncTo).not.toHaveBeenCalled();
    f.flow.localArenaLoadReady = true;
    scene.syncArenaFogOverlay(1000, true, false);
    expect(f.countdown.syncTo).toHaveBeenCalledOnce();
  });

  it('does not replay the entry reveal when streaming becomes pending after initial readiness', () => {
    const f = fixture(false, false); f.receiveTarget(); f.flow.onTransitionToArena();
    f.events.emit('postrender'); f.flow.syncArenaEntryTransition();
    let renderReady = false;
    Object.assign(f.flow, {
      getLocalWorldPresentation: () => ({ required: true }),
      syncAuthoritativeRoundStartAnchors: vi.fn(),
      terrainSnapshotReady: true, combatPresentationPrepared: true,
      renderers: { gpuVfx: { isShaderWarmupComplete: () => true } },
      worldRuntime: {
        materialization: { arena: {} }, presentation: { layout: {} },
        presentationFrame: { getWorldRenderWork: () => ({ pending: renderReady ? 0 : 1, resident: 1, renderReady }) },
      },
    });
    let loading = true;
    Object.assign(f.countdown, {
      update: vi.fn(), isLoading: () => loading,
      syncTo: vi.fn(() => { loading = false; }),
      showLoading: vi.fn(() => { loading = true; }),
    });
    const scene = Object.create(ArenaScene.prototype) as any;
    Object.assign(scene, { initializationReady: true, ctx: f.flow.ctx, arenaRuntime: f.flow,
      localPlayerState: { alive: true }, getArenaLoadingScreenState: () => ({}) });
    vi.spyOn(bridge, 'isArenaLoading').mockReturnValue(false);
    vi.spyOn(bridge, 'isArenaStarted').mockReturnValue(true);
    vi.spyOn(bridge, 'isLocalSpectator').mockReturnValue(false);
    const view = { x: 0, y: 0, width: 100, height: 100 };
    const frame = () => {
      f.flow.syncArenaLoadReady(view);
      scene.syncArenaFogOverlay(1000, true, false);
    };
    frame();
    expect(f.countdown.syncTo).not.toHaveBeenCalled();
    renderReady = true;
    frame();
    expect(f.countdown.syncTo).toHaveBeenCalledOnce();
    f.countdown.showLoading.mockClear();
    renderReady = false;
    frame();
    expect(bridge.setLocalWorldLoadProgress).toHaveBeenLastCalledWith(20, expect.any(Number), expect.any(String), false);
    expect(f.countdown.showLoading).not.toHaveBeenCalled();
    renderReady = true;
    frame();
    expect(f.countdown.syncTo).toHaveBeenCalledOnce();
  });

  it('removes the pending render continuation on Scene shutdown', () => {
    const f = fixture(); f.flow.initialize(); f.flow.onTransitionToArena(); f.finishAnimations();
    f.scene.events.emit('shutdown');
    f.events.emit('postrender');
    expect(f.events.listenerCount('postrender')).toBe(0);
    expect(f.flow.buildWorld).not.toHaveBeenCalled();
    expect(f.scene.physics.world.resume).toHaveBeenCalledOnce();
  });

  it('blocks simulation and host capabilities without detaching the World', () => {
    const f = fixture(true); f.flow.onTransitionToArena();
    f.flow.updateWorldRuntime(16);
    expect(f.flow.worldRuntime.update).not.toHaveBeenCalled();
    expect(f.flow.getPlayerCapabilities('local')).toMatchObject({ canMove: false, canUseCombat: false, canInteract: false });
    expect(f.flow.worldLifecycle.endInstance).not.toHaveBeenCalled();
  });

  it('preserves Lobby/test-area and Lobby reinstance entry without a match gate', () => {
    const f = fixture(); f.net.phase = 'LOBBY';
    expect(f.flow.ensureArenaEntry()).toBe(true);
    f.net.world = { ...f.net.world, worldRevision: 11 };
    expect(f.flow.ensureArenaEntry()).toBe(true);
    expect(f.scene.physics.world.pause).not.toHaveBeenCalled();
    expect(f.countdown.showLoading).not.toHaveBeenCalled();
  });

  it('runs only the small render budget and networking in the protected Scene frame', () => {
    const f = fixture(); f.flow.onTransitionToArena();
    const scene = Object.create(ArenaScene.prototype) as any;
    Object.assign(scene, { initializationReady: true, ctx: f.flow.ctx, arenaRuntime: f.flow,
      weaponBalanceLabPreviousMapId: null, syncArenaExitFade: () => false,
      inputBindings: { updateFrame: vi.fn() }, renderers: { gpuVfx: { update: vi.fn() } },
      getArenaLoadingScreenState: () => ({}), resolveArenaFrameSignals: vi.fn() });
    vi.spyOn(bridge, 'updateNetwork').mockImplementation(() => {});
    vi.spyOn(bridge, 'flushNetwork').mockImplementation(() => {});
    const bake = vi.spyOn(ChunkedRenderSurface, 'flushBakeBudget').mockImplementation(() => {});
    scene.update(0, 16);
    expect(bake).toHaveBeenCalledWith(scene);
    expect(bridge.flushNetwork).toHaveBeenCalledOnce();
    expect(scene.inputBindings.updateFrame).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, uiBlocking: true }));
    expect(scene.resolveArenaFrameSignals).not.toHaveBeenCalled();
    expect(f.flow.worldRuntime.update).not.toHaveBeenCalled();
  });
});
