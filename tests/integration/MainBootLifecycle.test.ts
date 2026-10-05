import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockedModules = ['phaser', '../../src/scenes/ArenaScene', '../../src/network/NetworkBridge',
  '../../src/network/bridge', '../../src/graphics/PhaserAlphaZero', '../../src/graphics/PhaserFramebufferBindings',
  '../../src/graphics/RenderResolution', '../../src/ui/fullscreen', '../../src/ui/uiFonts',
  '../../src/loadout/content/GameContentValidation', '../../src/ui/BootScreen', '../../src/utils/webglContext'];

afterEach(() => {
  for (const module of mockedModules) vi.doUnmock(module);
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('boot owns the admitted network session', () => {
  it.each(['constructor failure', 'scene preparation failure', 'normal pagehide'] as const)('leaves the host roster after %s', async stage => {
    vi.resetModules(); vi.useFakeTimers();
    vi.stubGlobal('__PERFORMANCE_LAB__', false);
    vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { hash: '#r=012345' } }));
    vi.stubGlobal('document', { getElementById: () => null });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { FakeNetwork, createHostRoom, addClientRoom } = await import('../fakePeerNetwork');
    const session = await import('../../src/network/peer/session');
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const client = await addClientRoom(network, [], 'failed-boot-token');
    const id = client.room.getLocalPlayerId();
    const connect = vi.fn(async () => session.setActiveSession({ ...client, roomCode: '012345' }));
    const game = { events: new EventEmitter(), destroy: vi.fn() };
    const failure = new Error('required startup resource unavailable');
    vi.doMock('phaser', () => ({
      Renderer: { WebGL: { ProgramManager: class {}, Wrappers: { WebGLFramebufferWrapper: class {} } } },
      Core: { Events: { READY: 'ready' } }, Scale: { FIT: 1, CENTER_BOTH: 1 }, WEBGL: 2,
      Game: class { constructor() { if (stage === 'constructor failure') throw failure; return game; } },
    }));
    vi.doMock('../../src/scenes/ArenaScene', () => ({ ArenaScene: class {} }));
    vi.doMock('../../src/network/NetworkBridge', () => ({ NetworkBridge: { connect } }));
    vi.doMock('../../src/network/bridge', () => ({ bridge: { activate() {}, leaveRoom: session.leaveActiveSession } }));
    vi.doMock('../../src/graphics/PhaserAlphaZero', () => ({ installPhaserAlphaZero() {} }));
    vi.doMock('../../src/graphics/PhaserFramebufferBindings', () => ({ installPhaserFramebufferBindings() {} }));
    vi.doMock('../../src/graphics/RenderResolution', () => ({ initialRenderSize: () => ({ width: 800, height: 600 }), installRenderResolution() {} }));
    vi.doMock('../../src/ui/fullscreen', () => ({ FULLSCREEN_TARGET_ID: 'game-container', installFullscreenSupport() {} }));
    vi.doMock('../../src/ui/uiFonts', () => ({ loadUiFonts: async () => {} }));
    vi.doMock('../../src/loadout/content/GameContentValidation', () => ({ validateGameContentReferences() {} }));
    vi.doMock('../../src/ui/BootScreen', () => ({ BOOT_ERROR_EVENT: 'arena-boot-error',
      BootScreen: { setStatus() {}, setIndeterminate() {}, dismissImmediate() {} } }));
    vi.doMock('../../src/utils/webglContext', () => ({ createWebGLStartupContext: () => ({ canvas: {}, context: {}, rendererType: 'webgl2' }) }));
    try {
      await import('../../src/main');
      await Promise.resolve();
      if (stage === 'scene preparation failure') {
        expect(session.getActiveSession()?.room).toBe(client.room);
        game.events.emit('arena-boot-error', failure);
        expect(game.destroy).toHaveBeenCalledExactlyOnceWith(true);
      }
      if (stage === 'normal pagehide') {
        game.events.emit('ready');
        expect(session.getActiveSession()?.room).toBe(client.room);
        expect(host.room.getPlayerIds()).toContain(id);
        expect(console.error).not.toHaveBeenCalled();
        window.dispatchEvent(new Event('pagehide'));
      } else expect(console.error).toHaveBeenCalledExactlyOnceWith(failure);
      expect(connect).toHaveBeenCalledOnce();
      expect(session.getActiveSession()).toBeNull();
      expect(host.room.getPlayerIds()).not.toContain(id);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(client.transport.links.every(link => link.closed)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { session.clearActiveSession(); client.room.destroy(); host.room.destroy(); }
  });
});
