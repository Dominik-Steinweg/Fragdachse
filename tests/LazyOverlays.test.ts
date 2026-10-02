import EventEmitter from 'eventemitter3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LazyOverlayGate } from '../src/ui/LazyOverlayGate';
import { CoopDefenseUpgradesOverlay } from '../src/ui/CoopDefenseUpgradesOverlay';
import { CoopDefenseItemsOverlay } from '../src/ui/CoopDefenseItemsOverlay';
import { CoopDefenseItemRewardOverlay } from '../src/ui/CoopDefenseItemRewardOverlay';
const assets = vi.hoisted(() => ({ ready: vi.fn(), ensure: vi.fn() }));
vi.mock('../src/ui/OverlayAssets', () => ({ getOverlayAssets: () => assets }));
vi.mock('phaser', () => ({ BlendModes: { ADD: 1 }, Math: { Clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)) } }));
vi.mock('../src/utils/phaserFx', () => ({ addExternalGlow: () => null, removeExternalFx() {} }));
function setup() {
  let resolve!: () => void, reject!: () => void;
  const done = new Promise<void>((yes, no) => { resolve = yes; reject = () => no(new Error('offline')); });
  assets.ready.mockReturnValue(false); assets.ensure.mockReturnValue(done);
  const objects: any[] = [];
  const dom: any = { activeElement: null };
  class Element extends EventEmitter {
    style = { cssText: '', visibility: '' }; textContent = ''; isConnected = true; children: Element[] = [];
    setAttribute() {} append(...children: Element[]) { this.children.push(...children); }
    appendChild(child: Element) { this.append(child); return child; }
    addEventListener(name: string, listener: (...args: any[]) => void) { this.on(name, listener); }
    focus() { dom.activeElement = this; } contains(child: Element): boolean { return child === this || this.children.some(c => c.contains(child)); }
    remove() { this.isConnected = false; } animate() { return { cancel: vi.fn() }; }
  }
  const root = new Element(); dom.activeElement = root;
  Object.assign(dom, { createElement: () => new Element(), getElementById: () => root, body: root });
  const keyboard = new EventEmitter();
  vi.stubGlobal('HTMLElement', Element); vi.stubGlobal('document', dom);
  vi.stubGlobal('window', { addEventListener: (name: string, fn: any) => keyboard.on(name, fn),
    removeEventListener: (name: string, fn: any) => keyboard.off(name, fn) });
  function object() {
    const result: any = new EventEmitter();
    for (const key of ['setScrollFactor', 'setInteractive', 'setOrigin', 'setDepth', 'setText', 'setVisible', 'setAlpha']) result[key] = vi.fn(() => result);
    result.destroy = vi.fn(); objects.push(result); return result;
  }
  const events = new EventEmitter();
  const scene: any = { events, input: { dragDistanceThreshold: 0 }, add: { rectangle: object, text: object, container: object },
    tweens: { add: vi.fn(() => ({ remove() {} })) } };
  return { scene, events, objects, resolve, reject, done, root, dom, keyboard };
}
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe('lazy opening lifecycle', () => {
  it('discards cancelled openings and opens only the latest request', async () => {
    const h = setup(), gate = new LazyOverlayGate(h.scene, 'items', () => true), stale = vi.fn(), latest = vi.fn();
    gate.open(stale, () => gate.cancel()); expect(gate.isPending()).toBe(true);
    gate.cancel(); gate.open(latest, () => gate.cancel()); h.resolve(); await h.done;
    expect(stale).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledOnce();
    expect(gate.isPending()).toBe(false); expect(h.events.listenerCount('update')).toBe(0);
  });
  it.each(['context', 'shutdown', 'failure'] as const)('never shows incomplete or stale UI after %s', async reason => {
    const h = setup(); let allowed = true;
    const gate = new LazyOverlayGate(h.scene, 'items', () => allowed), show = vi.fn(); gate.open(show, () => gate.cancel());
    if (reason === 'context') { allowed = false; h.events.emit('update'); }
    if (reason === 'shutdown') h.events.emit('shutdown');
    if (reason === 'failure') h.reject(); else h.resolve(); await h.done.catch(() => {});
    expect(show).not.toHaveBeenCalled(); expect(gate.isPending()).toBe(reason === 'failure');
    gate.cancel(); expect(h.events.listenerCount('update')).toBe(0);
  });
  it('cancels via the loading button and reuses cached images synchronously', () => {
    const h = setup(), gate = new LazyOverlayGate(h.scene, 'items', () => true), show = vi.fn(), close = vi.fn(() => gate.cancel());
    gate.open(show, close); h.root.children.at(-1)!.children[2].emit('click');
    expect(close).toHaveBeenCalledOnce(); expect(gate.isPending()).toBe(false);
    assets.ready.mockReturnValue(true); gate.open(show, close); expect(show).toHaveBeenCalledOnce(); gate.cancel();
  });
  it('traps Tab, cancels with Escape, and restores focus without leaking keyboard listeners', () => {
    const h = setup(), gate = new LazyOverlayGate(h.scene, 'items', () => true), close = vi.fn(() => gate.cancel());
    gate.open(vi.fn(), close);
    const event = (key: string) => ({ key, repeat: false, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() });
    h.keyboard.emit('keydown', event('Tab')); expect(h.dom.activeElement).toBe(h.root.children.at(-1)!.children[2]);
    h.keyboard.emit('keydown', event('Escape')); expect(close).toHaveBeenCalledOnce();
    expect(h.dom.activeElement).toBe(h.root); expect(h.keyboard.listenerCount('keydown')).toBe(0);
  });
  it('ignores the held opening gamepad button and cancels on the next press', () => {
    const h = setup(); let pressed = true;
    vi.stubGlobal('navigator', { getGamepads: () => [{ mapping: 'standard', buttons: [{ pressed }, { pressed: false }] }] });
    const gate = new LazyOverlayGate(h.scene, 'items', () => true), close = vi.fn(() => gate.cancel());
    gate.open(vi.fn(), close); h.events.emit('update'); expect(close).not.toHaveBeenCalled();
    pressed = false; h.events.emit('update'); pressed = true; h.events.emit('update');
    expect(close).toHaveBeenCalledOnce(); expect(gate.isPending()).toBe(false);
  });
  function upgrades(scene: any) {
    return new CoopDefenseUpgradesOverlay(scene, vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(),
      vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn());
  }
  it.each(['upgrades', 'items', 'rewards'] as const)('%s builds once; pending visibility supports Escape routing', async kind => {
    const h = setup(), closed = vi.fn();
    const overlay: any = kind === 'upgrades' ? upgrades(h.scene) : kind === 'items'
      ? new CoopDefenseItemsOverlay(h.scene, vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), closed)
      : new CoopDefenseItemRewardOverlay(h.scene, vi.fn(), () => ({}) as never, closed);
    overlay.build = vi.fn(() => { overlay.container = { setVisible() {}, setAlpha() {} }; });
    overlay.refresh = vi.fn(); overlay.showOffers = vi.fn();
    const open = () => overlay.show({}), visible = () => kind === 'rewards' ? overlay.isVisible() : overlay.isOpen();
    const close = () => kind === 'upgrades' ? overlay.closeWithCancel() : kind === 'rewards' ? overlay.dismiss() : overlay.hide();
    expect(overlay.build).not.toHaveBeenCalled(); open(); expect(visible()).toBe(true); expect(overlay.build).not.toHaveBeenCalled();
    close(); expect(visible()).toBe(false); open(); h.resolve(); await h.done;
    expect(overlay.build).toHaveBeenCalledOnce(); expect(visible()).toBe(true);
    close(); assets.ready.mockReturnValue(true); open(); expect(overlay.build).toHaveBeenCalledOnce(); close();
  });
  it('re-reads rewards after waiting and never resurrects a claimed offer', async () => {
    const h = setup(), closed = vi.fn(); let current: any = { offers: ['new'] };
    const overlay: any = new CoopDefenseItemRewardOverlay(h.scene, vi.fn(), () => current, closed);
    overlay.showLoaded = vi.fn(); overlay.show({ offers: ['old'] }); current = null; h.resolve(); await h.done;
    expect(overlay.showLoaded).not.toHaveBeenCalled(); expect(closed).toHaveBeenCalledOnce(); expect(overlay.isVisible()).toBe(false);
  });
  it('retains the requested round when an automatic reward waits behind downloads', async () => {
    const h = setup(), current = { roundEndedAt: 42, options: ['updated'] };
    const get = vi.fn(() => current as never);
    const overlay: any = new CoopDefenseItemRewardOverlay(h.scene, vi.fn(), get, vi.fn());
    overlay.showLoaded = vi.fn(); overlay.show({ roundEndedAt: 42, options: ['old'] }, true);
    h.resolve(); await h.done;
    expect(get).toHaveBeenCalledWith(42);
    expect(overlay.showLoaded).toHaveBeenCalledWith(current, true);
  });
});
