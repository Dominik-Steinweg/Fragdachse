import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { getEventListeners } from 'node:events';
import EventEmitter from 'eventemitter3';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({
  Core: { Events: { DESTROY: 'destroy' } },
  Scale: { Events: { RESIZE: 'resize' } },
  Math: { Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)) },
}));
import { installFullscreenSupport, onFullscreenChange, toggleFullscreen } from '../src/ui/fullscreen';
import { installRenderResolution, getRenderResolutionController } from '../src/graphics/RenderResolution';

const teardown: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of teardown.splice(0)) cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Node's EventTarget does not remove capture listeners with boolean true; browsers do.
class BrowserEventTarget extends EventTarget {
  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(type, callback, typeof options === 'boolean' ? { capture: options } : options);
  }
}

function createDisplayFixture(browser?: { media: any; win: any; doc: any }) {
  const media = browser?.media ?? Object.assign(new BrowserEventTarget(), { matches: false });
  const win = browser?.win ?? Object.assign(new BrowserEventTarget(), {
    devicePixelRatio: 1,
    matchMedia: () => media,
  });
  const doc = browser?.doc ?? Object.assign(new BrowserEventTarget(), {
    fullscreenElement: null,
    createElement: () => ({ style: {} }),
  });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);

  const source = new URL('../node_modules/phaser/src/scale/ScaleManager.js', import.meta.url);
  const require = createRequire(source);
  const module = { exports: {} };
  runInNewContext(readFileSync(source, 'utf8'), {
    module,
    exports: module.exports,
    document: doc,
    require: (id: string) => {
      if (id === '../utils/Class') return function (definition: object) { return definition; };
      if (id === './events' || id === '../core/events') return require(id);
      return function () {};
    },
  });
  const methods = module.exports as Record<string, Function>;
  const events = new EventEmitter();
  const requestFullscreen = vi.fn();
  const setGameSize = vi.fn();
  const scale: any = Object.assign(new EventEmitter(), {
    width: 1920,
    displaySize: { width: 1920, destroy() {} },
    fullscreen: { available: true, active: false, request: 'requestFullscreen' },
    isFullscreen: false,
    fullscreenTarget: { requestFullscreen },
    canvas: { parentNode: {} },
    stopListeners() {},
    parentSize: { destroy() {} },
    gameSize: { destroy() {} },
    baseSize: { destroy() {} },
    setGameSize,
    startFullscreen: methods.startFullscreen,
    getFullscreenTarget: methods.getFullscreenTarget,
  });
  // Phaser registers ScaleManager teardown before application READY handlers.
  events.once('destroy', () => methods.destroy.call(scale));
  teardown.push(() => events.emit('destroy'));
  return { game: { events, scale } as any, media, win, doc, requestFullscreen, setGameSize };
}

describe('browser display ownership follows the Phaser Game lifetime', () => {
  it('stops fullscreen callbacks and F11 after the real ScaleManager is destroyed', () => {
    const fixture = createDisplayFixture();
    const changed = vi.fn();
    teardown.push(onFullscreenChange(changed));
    installFullscreenSupport(fixture.game);
    expect(toggleFullscreen()).toBe('entered');
    expect(fixture.requestFullscreen).toHaveBeenCalledOnce();
    const pressF11 = () => Object.assign(new Event('keydown', { cancelable: true }), { key: 'F11', repeat: false });
    const beforeDestroy = pressF11();
    fixture.win.dispatchEvent(beforeDestroy);
    expect(beforeDestroy.defaultPrevented).toBe(true);
    expect(fixture.requestFullscreen).toHaveBeenCalledTimes(2);
    fixture.doc.dispatchEvent(new Event('fullscreenchange'));
    expect(changed).toHaveBeenCalledOnce();

    fixture.game.events.emit('destroy');
    expect(toggleFullscreen()).toBe('unsupported');
    expect(getEventListeners(fixture.win, 'keydown')).toHaveLength(0);
    const afterDestroy = pressF11();
    fixture.win.dispatchEvent(afterDestroy);
    expect(afterDestroy.defaultPrevented).toBe(false);
    expect(fixture.requestFullscreen).toHaveBeenCalledTimes(2);
    fixture.doc.dispatchEvent(new Event('fullscreenchange'));
    fixture.media.dispatchEvent(new Event('change'));
    expect(changed).toHaveBeenCalledOnce();
  });

  it('replaces fullscreen ownership without an old Game teardown removing the new listeners', () => {
    const first = createDisplayFixture();
    installFullscreenSupport(first.game);
    const second = createDisplayFixture(first);
    installFullscreenSupport(second.game);
    expect(getEventListeners(first.win, 'keydown')).toHaveLength(1);
    first.game.events.emit('destroy');
    expect(toggleFullscreen()).toBe('entered');
    expect(second.requestFullscreen).toHaveBeenCalledOnce();
    second.game.events.emit('destroy');
    expect(toggleFullscreen()).toBe('unsupported');
  });

  it('releases the resolution controller and ignores retained references after Game teardown', () => {
    const fixture = createDisplayFixture();
    const controller = installRenderResolution(fixture.game);
    expect(getRenderResolutionController()).toBe(controller);
    fixture.game.scale.displaySize.width = fixture.game.scale.width / 2;
    fixture.game.scale.emit('resize');
    expect(fixture.setGameSize).toHaveBeenCalledOnce();
    fixture.setGameSize.mockClear();

    fixture.game.events.emit('destroy');
    expect(getRenderResolutionController()).toBeNull();
    fixture.game.scale.displaySize.width = 960;
    controller.setMaxRenderScale(.5);
    controller.sync();
    expect(fixture.setGameSize).not.toHaveBeenCalled();
  });
});
