import EventEmitter from 'eventemitter3';
import type * as Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFERRED_ASSETS, getDeferredAssets } from '../src/assets/DeferredAssets';
import { getOverlayAssets, ITEM_VIEW_ASSETS } from '../src/ui/OverlayAssets';
vi.mock('phaser', () => ({ Math: { Clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)) } }));
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function setup(initial = DEFERRED_ASSETS.map(asset => asset.key)) {
  const cache = new Set(initial);
  class Loader extends EventEmitter {
    queued: Array<{ key: string; url: string }> = [];
    history: string[] = [];
    loading = false;
    maxRetries = 2;
    image(config: { key: string; url: string }) { this.queued.push(config); this.history.push(config.key); return this; }
    audio(config: { key: string; url: string }) { return this.image(config); }
    isLoading() { return this.loading; }
    start() { expect(this.loading).toBe(false); this.loading = true; }
    async finish(fail: string[] = []) {
      for (const file of this.queued.splice(0)) if (!fail.includes(file.key)) cache.add(file.key);
      this.loading = false; this.emit('complete'); await tick();
    }
  }
  const loader = new Loader(), events = new EventEmitter();
  const scene = { events, load: loader, textures: { exists: (key: string) => cache.has(key) },
    cache: { audio: { exists: (key: string) => cache.has(key) } },
  } as unknown as Phaser.Scene;
  const assets = getOverlayAssets(scene), deferred = getDeferredAssets(scene);
  async function drain() { await tick(); while (loader.isLoading()) await loader.finish(); }
  return { scene, events, assets, deferred, loader, cache, drain };
}
afterEach(() => vi.useRealTimers());
describe('UI assets outside World Ready', () => {
  it('waits for phase two, deduplicates requests, and never changes its Ready state', async () => {
    const h = setup([]), first = h.assets.ensure('items');
    expect(h.assets.ensure('items')).toBe(first); await tick();
    expect(h.loader.history).toEqual(DEFERRED_ASSETS.map(asset => asset.key));
    expect(h.deferred.getState().ready).toBe(false); await h.loader.finish();
    const ready = h.deferred.getState();
    expect(ready.ready).toBe(true); expect(h.assets.ready('items')).toBe(false);
    await h.drain(); await first;
    expect(h.assets.ready('items')).toBe(true); expect(h.deferred.getState()).toBe(ready);
    expect(h.loader.history.filter(key => ITEM_VIEW_ASSETS.some(asset => asset.key === key)))
      .toEqual(ITEM_VIEW_ASSETS.map(asset => asset.key));
    const count = h.loader.history.length; await h.assets.ensure('items');
    expect(h.loader.history).toHaveLength(count);
  });
  it('retries only failed images, fails closed, and permits a later retry', async () => {
    const h = setup(), failed = ITEM_VIEW_ASSETS[0].key;
    const result = h.assets.ensure('items').catch(error => error); await tick();
    while (h.loader.isLoading()) await h.loader.finish([failed]);
    expect(await result).toBeInstanceOf(Error); expect(h.assets.ready('items')).toBe(false);
    expect(h.loader.history.filter(key => key === failed).length).toBeGreaterThan(1);
    for (const asset of ITEM_VIEW_ASSETS.slice(1)) expect(h.loader.history.filter(key => key === asset.key)).toHaveLength(1);
    const retry = h.assets.ensure('items'); await h.drain(); await retry;
    expect(h.assets.ready('items')).toBe(true);
  });
  it('shares idle prefetch with foreground opening without constructing UI', async () => {
    vi.useFakeTimers(); const h = setup(); h.assets.prefetch(); h.assets.prefetch();
    expect(h.loader.history).toHaveLength(0); await vi.runOnlyPendingTimersAsync(); vi.useRealTimers();
    const opening = h.assets.ensure('items'); await h.drain(); await opening;
    expect(h.loader.history).toEqual(ITEM_VIEW_ASSETS.map(asset => asset.key));
  });
  it.each(['before phase two', 'during phase two', 'during UI batch'] as const)('settles waits on shutdown: %s', async phase => {
    const h = setup(phase === 'during phase two' ? [] : undefined);
    const result = h.assets.ensure('items').catch(error => error);
    if (phase !== 'before phase two') await tick();
    h.events.emit('shutdown'); expect(await result).toBeInstanceOf(Error);
    expect(h.loader.listenerCount('complete')).toBe(0);
    await expect(h.assets.ensure('items')).rejects.toThrow();
    if (phase === 'before phase two') expect(h.loader.history).toHaveLength(0);
  });
  it('cancels an idle prefetch on shutdown', async () => {
    vi.useFakeTimers(); const h = setup(); h.assets.prefetch(); h.events.emit('shutdown');
    await vi.runOnlyPendingTimersAsync(); expect(h.loader.history).toHaveLength(0);
  });
});
