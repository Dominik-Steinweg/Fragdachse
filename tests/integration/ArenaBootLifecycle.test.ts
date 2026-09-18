import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({
  Scene: class {}, Core: { Events: { POST_RENDER: 'postrender' } },
  Scenes: { Events: { CREATE: 'create', SHUTDOWN: 'shutdown', DESTROY: 'destroy' } },
  GameObjects: { Image: class {}, Sprite: class {}, Container: class {}, Particles: { ParticleProcessor: class {} } },
  Math: { Vector2: class {}, Clamp: (v: number, min: number, max: number) => Math.min(max, Math.max(min, v)),
    Linear: (a: number, b: number, t: number) => a + (b - a) * t,
    Distance: { Between: (x: number, y: number, a: number, b: number) => Math.hypot(x - a, y - b) } },
  BlendModes: { ADD: 1, NORMAL: 0 },
  Geom: { Circle: class {}, Rectangle: class {}, Line: class {} },
  Filters: { ParallelFilters: class {}, Displacement: class {} },
}));
import { ArenaScene } from '../../src/scenes/ArenaScene';
import { bridge } from '../../src/network/bridge';
import { BootScreen, BOOT_ERROR_EVENT } from '../../src/ui/BootScreen';

describe('Arena startup readiness and cancellation', () => {
  let now: number;
  beforeEach(() => {
    vi.useFakeTimers(); now = 0;
    vi.stubGlobal('__PERFORMANCE_LAB__', false);
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 1));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  function fixture(phase: 'LOBBY' | 'ARENA' = 'LOBBY') {
    const scene = Object.create(ArenaScene.prototype) as any;
    const events = new EventEmitter(), gameEvents = new EventEmitter();
    const failureRemoved = vi.fn(), kickedRemoved = vi.fn();
    let failure!: (message: string) => void, kicked!: () => void;
    vi.spyOn(bridge, 'clearPlayerCallbacks').mockImplementation(() => {});
    vi.spyOn(bridge, 'onNetworkFailure').mockImplementation(callback => { failure = callback; return failureRemoved; });
    vi.spyOn(bridge, 'onKicked').mockImplementation(callback => { kicked = callback; return kickedRemoved; });
    vi.spyOn(bridge, 'getGamePhase').mockReturnValue(phase);
    const networkUpdate = vi.spyOn(bridge, 'updateNetwork').mockImplementation(() => {});
    const fade = vi.spyOn(BootScreen, 'fadeOut').mockResolvedValue();
    const runtime = { terminateMatch: vi.fn(), getWorldRevealState: vi.fn(() => ({ ready: false, progress: 70 })) };
    const lobby = { hasTerminalFailure: vi.fn(() => false), showHostDisconnectedMessage: vi.fn(), completeBootReveal: vi.fn() };
    const work = vi.fn();
    Object.assign(scene, {
      events, game: { events: gameEvents }, input: { enabled: true, keyboard: { enabled: true } },
      cameras: { main: { width: 1920, height: 1080, zoom: 1, originX: .5, originY: .5, scrollX: 0, scrollY: 0 } },
      sys: { setVisible: vi.fn(), pause: vi.fn(), resume: vi.fn(), isActive: () => true,
        shutdown: () => events.emit('shutdown') },
      prepareLobby: function* () {
        work(); now += 9; yield 'first';
        scene.arenaRuntime = runtime; scene.lobbyOverlay = lobby;
        gameEvents.on('postrender', () => scene.syncBootReveal());
      },
    });
    return { scene, events, gameEvents, runtime, lobby, fade, work, networkUpdate, failureRemoved, kickedRemoved,
      failure: (message: string) => failure(message), kicked: () => kicked() };
  }

  it('blocks updates and input during preparation and retains the rendered-world reveal barrier', async () => {
    const f = fixture(); f.scene.create(); f.events.emit('create');
    expect(f.scene.sys.pause).toHaveBeenCalledOnce();
    f.scene.update(0, 16); f.scene.syncBootReveal();
    expect(f.networkUpdate).not.toHaveBeenCalled();
    expect(f.scene.input.enabled).toBe(false);
    expect(f.scene.input.keyboard.enabled).toBe(false);
    vi.advanceTimersByTime(2); // first slice only
    expect(f.work).toHaveBeenCalledOnce();
    expect(f.scene.initializationReady).toBe(false);
    vi.runAllTimers();
    expect(f.scene.initializationReady).toBe(true);
    expect(f.scene.sys.resume).toHaveBeenCalledOnce();
    f.gameEvents.emit('postrender');
    expect(f.fade).not.toHaveBeenCalled();
    expect(f.scene.input.enabled).toBe(false);
    f.runtime.getWorldRevealState.mockReturnValue({ ready: true, progress: 100 });
    f.gameEvents.emit('postrender'); await Promise.resolve();
    expect(f.fade).toHaveBeenCalledOnce();
    expect(f.lobby.completeBootReveal).toHaveBeenCalledOnce();
    expect(f.scene.input.enabled).toBe(true);
  });

  it('hands a direct arena join to the existing arena loading veil after initialization', () => {
    const f = fixture('ARENA'); f.scene.create(); f.events.emit('create');
    vi.runAllTimers(); f.gameEvents.emit('postrender');
    expect(f.fade).toHaveBeenCalledOnce();
    expect(f.runtime.getWorldRevealState).not.toHaveBeenCalled();
  });

  it.each(['shutdown', 'destroy'])('cannot resume a partial scene after %s', (event) => {
    const f = fixture(); f.scene.create(); f.events.emit('create');
    vi.advanceTimersByTime(2); f.events.emit(event); vi.runAllTimers();
    expect(f.scene.initializationReady).toBe(false);
    expect(f.scene.sys.resume).not.toHaveBeenCalled();
    expect(f.failureRemoved).toHaveBeenCalledOnce();
    expect(f.kickedRemoved).toHaveBeenCalledOnce();
    expect(f.fade).not.toHaveBeenCalled();
  });

  it('holds terminal network events until their consumers exist', () => {
    const f = fixture(); f.scene.create(); f.events.emit('create');
    f.failure('host lost'); f.kicked();
    expect(f.runtime.terminateMatch).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(f.runtime.terminateMatch).toHaveBeenCalledWith('host lost');
    expect(f.lobby.showHostDisconnectedMessage).toHaveBeenCalledOnce();
  });

  it('shuts down partial construction and reports an error without resuming or revealing', () => {
    const f = fixture(), error = new Error('construction failed'), report = vi.fn();
    f.scene.prepareLobby = function* () { throw error; };
    f.gameEvents.on(BOOT_ERROR_EVENT, report);
    f.scene.create(); f.events.emit('create'); vi.runAllTimers();
    expect(report).toHaveBeenCalledExactlyOnceWith(error);
    expect(f.scene.initializationReady).toBe(false);
    expect(f.scene.sys.resume).not.toHaveBeenCalled();
    expect(f.failureRemoved).toHaveBeenCalledOnce();
    expect(f.fade).not.toHaveBeenCalled();
  });
});
