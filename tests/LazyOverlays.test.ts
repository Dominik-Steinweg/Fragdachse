import EventEmitter from 'eventemitter3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LazyOverlayGate } from '../src/ui/LazyOverlayGate';
import { CoopDefenseUpgradesOverlay } from '../src/ui/CoopDefenseUpgradesOverlay';
import { CoopDefenseItemsOverlay } from '../src/ui/CoopDefenseItemsOverlay';
import { CoopDefenseItemRewardOverlay } from '../src/ui/CoopDefenseItemRewardOverlay';
import { createMatchItemRewardPresentation } from '../src/ui/MatchResultsModel';
import {
  claimStoredPendingCoopDefenseItemReward,
  exportStoredGameProgressJson,
  getStoredCoopDefenseProgress,
  importStoredGameProgressJson,
} from '../src/utils/localPreferences';
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
  it('reports a denied destination so an after-round handoff cannot stay blocked', async () => {
    const h = setup(); let allowed = true;
    const gate = new LazyOverlayGate(h.scene, 'items', () => allowed), unavailable = vi.fn(), show = vi.fn();
    gate.open(show, vi.fn(), unavailable);
    allowed = false; h.events.emit('update'); h.resolve(); await h.done;
    expect(unavailable).toHaveBeenCalledOnce(); expect(show).not.toHaveBeenCalled();
    expect(gate.isPending()).toBe(false);
  });

  it.each(['upgrades', 'rewards'] as const)('retains %s after close and ignores repeated actions until retirement', kind => {
    const h = setup(), closed = vi.fn(() => true), apply = vi.fn(), claim = vi.fn(() => true);
    const overlay: any = kind === 'upgrades' ? upgrades(h.scene)
      : new CoopDefenseItemRewardOverlay(h.scene, claim, vi.fn(), closed);
    if (kind === 'upgrades') { overlay.onClosed = closed; overlay.onApply = apply; }
    const root = { depth: 10, setVisible: vi.fn(), setAlpha: vi.fn(() => root), setDepth: vi.fn(() => root) };
    overlay.container = root; overlay.visible = true;
    overlay.presentation = { roundEndedAt: 42 }; overlay.closeAfterClaim = true;
    const close = () => kind === 'upgrades' ? overlay.closeWithApply() : overlay.applyClaim('offer');
    close(); close();
    expect(closed).toHaveBeenCalledOnce();
    expect(kind === 'upgrades' ? apply : claim).toHaveBeenCalledOnce();
    expect(root.setVisible).not.toHaveBeenCalledWith(false);
    overlay.getTransitionView().retire();
    expect(root.setVisible).toHaveBeenCalledWith(false);
  });

  it('reports readiness only after loading and building the destination', async () => {
    const h = setup(), overlay: any = upgrades(h.scene), ready = vi.fn();
    overlay.build = vi.fn(() => { overlay.container = { depth: 10, setVisible() {}, setAlpha() {}, setDepth() {} }; });
    overlay.refresh = vi.fn();
    overlay.show({ ready, unavailable: vi.fn(), onCancel: vi.fn() });
    expect(ready).not.toHaveBeenCalled();
    h.resolve(); await h.done;
    expect(overlay.build).toHaveBeenCalledOnce(); expect(ready).toHaveBeenCalledOnce();
    expect(h.scene.tweens.add).not.toHaveBeenCalled();
  });
  it.each(['upgrades', 'items', 'rewards'] as const)('%s builds once; pending visibility supports Escape routing', async kind => {
    const h = setup(), closed = vi.fn();
    const overlay: any = kind === 'upgrades' ? upgrades(h.scene) : kind === 'items'
      ? new CoopDefenseItemsOverlay(h.scene, vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), closed)
      : new CoopDefenseItemRewardOverlay(h.scene, vi.fn(), () => ({}) as never, closed);
    overlay.build = vi.fn(() => { overlay.container = { setVisible() {}, setAlpha() {} }; });
    overlay.refresh = vi.fn(); overlay.showOffers = vi.fn();
    const open = () => kind === 'rewards' ? overlay.show({}) : overlay.show(), visible = () => kind === 'rewards' ? overlay.isVisible() : overlay.isOpen();
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
  it.each([undefined, { roomCode: 'AAAAAA', roundRevision: 2 }])('retains the requested round when an automatic reward waits behind downloads (%j)', async roundIdentity => {
    const h = setup(), current = { roundEndedAt: 42, roundIdentity, options: ['updated'] };
    const get = vi.fn(() => current as never);
    const overlay: any = new CoopDefenseItemRewardOverlay(h.scene, vi.fn(), get, vi.fn());
    overlay.showLoaded = vi.fn(); overlay.show({ roundEndedAt: 42, roundIdentity, options: ['old'] }, true);
    h.resolve(); await h.done;
    expect(get).toHaveBeenCalledWith(42, roundIdentity);
    expect(overlay.showLoaded).toHaveBeenCalledWith(current, true);
  });
  it.each([undefined, { roomCode: 'AAAAAA', roundRevision: 2 }])('claims the exact presented reward even when item IDs repeat (%j)', roundIdentity => {
    const h = setup(), claim = vi.fn(() => false);
    const overlay: any = new CoopDefenseItemRewardOverlay(h.scene, claim, vi.fn(), vi.fn());
    overlay.presentation = { roundEndedAt: 42, roundIdentity };
    overlay.applyClaim('shared-offer');
    expect(claim).toHaveBeenCalledWith(42, 'shared-offer', undefined, 'take', roundIdentity ?? null, undefined);
  });
  it.each([
    { action: 'take', target: 'stash' }, { action: 'equip', target: 'stash' },
    { action: 'take', target: 'offer' }, { action: 'equip', target: 'offer' },
  ] as const)('salvages the selected imported $target when its UID matches the reward ($action)', ({ action, target }) => {
    const h = setup();
    const values = new Map<string, string>();
    Object.assign(window, { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    } });
    const imported = JSON.parse(exportStoredGameProgressJson());
    const armor = { uid: 'equipped', slot: 'armor', rarity: 'white', itemLevel: 1, baseValue: 25, affixes: [] };
    imported.progress.coopDefense.items = [armor, ...Array.from({ length: 10 }, (_, index) => ({
      ...armor, uid: index === 0 ? 'shared' : `stash-${index}`,
    }))];
    imported.progress.coopDefense.equippedItemIds = { armor: 'equipped' };
    const reward = { ...armor, uid: 'shared', itemLevel: 2, baseValue: 37 };
    imported.progress.coopDefense.pendingItemRewards = [{ roundEndedAt: 42, offers: [reward] }];
    expect(importStoredGameProgressJson(JSON.stringify(imported)).ok).toBe(true);
    const progress = getStoredCoopDefenseProgress();
    const presentation = createMatchItemRewardPresentation(progress.pendingItemRewards[0], progress.items, progress.equippedItemIds)!;
    const option = presentation.options[0];
    expect(option.freeStashSlots).toBe(0);
    const selectedRow = target === 'offer' ? 0 : option.stash.findIndex(entry => entry.uid === 'shared') + 1;
    if (target === 'stash') expect(selectedRow).toBeGreaterThan(0);
    const claim = vi.fn((...args: Parameters<ConstructorParameters<typeof CoopDefenseItemRewardOverlay>[1]>) => (
      Boolean(claimStoredPendingCoopDefenseItemReward(...args))
    ));
    const overlay: any = new CoopDefenseItemRewardOverlay(h.scene, claim, () => null, vi.fn());
    overlay.presentation = presentation; overlay.view = 'salvage'; overlay.salvageOption = option;
    overlay.salvageAction = action; overlay.closeAfterClaim = true; overlay.hide = vi.fn();
    overlay.handleSalvageChoice(selectedRow);
    const after = getStoredCoopDefenseProgress();
    expect(claim).toHaveBeenCalledWith(42, 'shared', 'shared', target === 'offer' ? 'take' : action, null, target);
    expect(after.items.find(entry => entry.uid === 'shared')).toEqual(target === 'offer' ? { ...armor, uid: 'shared' } : reward);
    expect(after.items).toHaveLength(progress.items.length);
    expect(after.pendingItemRewards).toEqual([]);
    expect(after.equippedItemIds).toEqual({ armor: target === 'stash' && action === 'equip' ? 'shared' : 'equipped' });
  });
});
