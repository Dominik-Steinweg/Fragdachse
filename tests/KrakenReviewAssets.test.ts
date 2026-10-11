import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
import EventEmitter from 'eventemitter3';

const pending = vi.hoisted(() => ({ hold: false }));
vi.mock('phaser', async () => {
  const { default: Emitter } = await import('eventemitter3');
  return { Loader: { LoaderPlugin: class extends Emitter {
    queued: { key: string; config?: unknown; atlas?: unknown }[] = [];
    constructor(readonly scene: ReturnType<typeof sceneFixture>) {
      super(); scene.ownedLoaders.push(this); scene.sys.events.once('boot', this.boot, this);
    }
    boot() {}
    spritesheet(key: string, _url: string, config: unknown) { this.queued.push({ key, config }); }
    atlas(key: string, _url: string, atlas: unknown) { this.queued.push({ key, atlas }); }
    start() {
      if (pending.hold) return;
      for (const entry of this.queued) this.scene.textures.live.add(entry.key);
      queueMicrotask(() => this.emit('complete'));
    }
    destroy() { this.removeAllListeners(); }
  } } };
});
import { KrakenReviewAssets } from '../src/dev/scenario/KrakenReviewAssets';

function sceneFixture(atlas = false) {
  return { sys: { events: new EventEmitter() }, ownedLoaders: [] as { queued: { key: string; config?: unknown; atlas?: unknown }[] }[],
    load: { reset: vi.fn() },
    textures: { live: new Set<string>(), exists(key: string) { return this.live.has(key); },
      remove(key: string) { this.live.delete(key); },
      get: () => ({ has: (id: string) => ['1', '2'].includes(id), get: () => ({ realWidth: atlas ? 640 : 320 }) }) } };
}
const source = { run: 'review', asset: 'body', size: 320 };
const metadata = { manifest: { targetSize: 320, pivot: [.5, .5], clips: [
  { name: 'idle', frames: [1, 2], frameRate: 12, loop: true, markers: { impact: 1 } },
] }, sheets: { 320: { frameWidth: 320, frameHeight: 320, margin: 2, spacing: 4, frameCount: 3 } } };
function responses(atlas = false) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('export.json')
    ? Response.json(metadata) : atlas ? Response.json({ meta: { image: 'packed.png' }, frames: {} })
      : new Response('', { status: 404 })));
}
afterEach(() => { vi.unstubAllGlobals(); pending.hold = false; });

describe('Kraken review asset ownership and export contract', () => {
  it('uses authored sheet gutters and clip frame IDs, then releases its textures and boot hook', async () => {
    responses(); const scene = sceneFixture(), loader = new KrakenReviewAssets(scene as unknown as Phaser.Scene);
    const asset = await loader.load(source);
    expect(scene.ownedLoaders[0].queued[0].config).toMatchObject({ margin: 2, spacing: 4, endFrame: 2 });
    expect(asset.frame(asset.clips[0].frames[0])).toBe(1);
    expect(asset.clips[0].markers).toEqual({ impact: 1 });
    expect(scene.sys.events.listenerCount('boot')).toBe(0);
    expect(scene.load.reset).not.toHaveBeenCalled();
    loader.destroy(); expect(scene.textures.live.size).toBe(0);
  });

  it('loads trimmed color and elevation atlases and scales by untrimmed source size', async () => {
    responses(true); const scene = sceneFixture(true), loader = new KrakenReviewAssets(scene as unknown as Phaser.Scene);
    const asset = await loader.load({ ...source, elevationAtlas: 'elevation.json' });
    expect(asset.format).toBe('atlas'); expect(asset.frame(1)).toBe('1');
    expect(asset.scale).toBe(.5); expect(asset.elevationKey).toBeTruthy();
    expect(scene.ownedLoaders[0].queued.filter(file => file.atlas)).toHaveLength(2);
    loader.destroy(); expect(scene.textures.live.size).toBe(0);
  });

  it('cancels a pending owned loader without leaving scene hooks or resetting gameplay loading', async () => {
    responses(); pending.hold = true;
    const scene = sceneFixture(), loader = new KrakenReviewAssets(scene as unknown as Phaser.Scene);
    const loading = loader.load(source);
    const result = expect(loading).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(scene.ownedLoaders.length).toBe(1));
    loader.destroy(); await result;
    expect(scene.sys.events.listenerCount('boot')).toBe(0);
    expect(scene.load.reset).not.toHaveBeenCalled(); expect(scene.textures.live.size).toBe(0);
  });
});
