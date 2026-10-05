import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const TextureWrapper = createRequire(import.meta.url)('../node_modules/phaser/src/renderer/webgl/wrappers/WebGLTextureWrapper.js');

vi.mock('phaser', () => ({
  BlendModes: { ADD: 2 }, Textures: { FilterMode: { NEAREST: 1 } },
  GameObjects: { Image: class {
    destroyed = false;
    constructor(readonly scene: unknown, _x: number, _y: number, readonly key: string) {}
    setOrigin() { return this; } setDisplaySize() { return this; }
    setTint() { return this; } setBlendMode() { return this; } setAlpha() { return this; }
    destroy() { this.destroyed = true; }
  } },
}));
vi.mock('../src/effects/EffectUtils', () => ({ fillRadialGradientTexture: vi.fn() }));

import { ensureBlobSurfaceMottleTexture, stampBlobSurfaceMottle } from '../src/arena/BlobSurfaceMottle';
import { ROCK_BLOB_SURFACE_PROFILE } from '../src/arena/BlobSurfaceProfile';

interface DrawSource { destroyed: boolean; key?: string; scene?: unknown }
interface GpuStorage { writes: string[] }

function fixture() {
  let bound: GpuStorage;
  const materialScenes: unknown[] = [];
  const renderer = {
    gl: { LINEAR: 1, RGBA: 2, CLAMP_TO_EDGE: 3, isContextLost: () => false,
      createTexture: () => ({ writes: [] }), texParameteri() {},
      texImage2D(...args: unknown[]) {
        expect(args.at(-1)).toBeNull(); // Actual DynamicTexture framebuffer storage has no CPU pixels.
        bound.writes = [];
      },
    },
    glTextureUnits: { bind(wrapper: { webGLTexture: GpuStorage }) { bound = wrapper.webGLTexture; } },
    glWrapper: { updateTexturing() {} },
  };
  class DynamicTexture {
    readonly wrapper = new TextureWrapper(renderer, 0, 1, 1, 3, 3, 2, null, 32, 32);
    readonly frame = { source: { glTexture: this.wrapper } };
    private commands: Array<{ source: DrawSource; erase: boolean }> = [];
    renders = 0;
    setFilter() { return this; }
    getWebGLTexture() { return this.wrapper; }
    get writes(): string[] { return this.wrapper.webGLTexture.writes; }
    clear() { this.writes.length = 0; return this; }
    draw(source: DrawSource) {
      if (source.key === 'rock_mottle') materialScenes.push(source.scene);
      this.commands.push({ source, erase: false }); return this;
    }
    erase(source: DrawSource) { this.commands.push({ source, erase: true }); return this; }
    render() {
      this.renders++;
      for (const { source, erase } of this.commands) {
        expect(source.destroyed).toBe(false); // Deferred commands must run before their temporary sources are destroyed.
        this.writes.push(`${erase ? 'erase' : 'draw'}:${source.key ?? 'lift'}`);
      }
      this.commands.length = 0;
      return this;
    }
  }
  const entries = new Map<string, DynamicTexture>();
  const textures = {
    exists: (key: string) => entries.has(key),
    get: (key: string) => entries.get(key),
    addDynamicTexture: vi.fn((key: string) => {
      const texture = new DynamicTexture(); entries.set(key, texture); return texture;
    }),
  };
  const scene = () => ({ textures, make: { graphics: () => ({
    destroyed: false, fillStyle() { return this; }, fillRect() { return this; },
    setBlendMode() { return this; }, destroy() { this.destroyed = true; },
  }) } });
  return { scene, textures, entries, materialScenes };
}

describe('shared rock mottle texture lifetime', () => {
  it('rebakes restored material before a rock-region stamp without replacing its texture or frame', () => {
    const f = fixture(), scene = f.scene();
    const profile = ROCK_BLOB_SURFACE_PROFILE, mottle = profile.additionalMottleLayers![0];
    const samples: string[][] = [];
    const target = { stamp: (key: string) => { samples.push([...f.entries.get(key)!.writes]); } };
    const cells = Array.from({ length: 20 }, (_, gridX) => ({ gridX, gridY: 1 }));
    const stamp = () => stampBlobSurfaceMottle(scene as never, target as never, profile, mottle, cells, 1);
    stamp();
    const [texture] = f.entries.values(), frame = texture.frame, contents = [...texture.writes];
    expect(samples.length).toBeGreaterThan(0); expect(contents.length).toBeGreaterThan(0);
    const renderCount = texture.renders;
    stamp(); expect(texture.renders).toBe(renderCount);

    texture.wrapper.createResource(); // Actual Phaser restore replaces storage while retaining the Texture/Frame.
    expect(texture.writes).toEqual([]);
    samples.length = 0;
    stamp();
    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples) expect(sample).toEqual(contents);
    expect(texture.frame).toBe(frame); expect(f.textures.addDynamicTexture).toHaveBeenCalledOnce();
    const restoredRenderCount = texture.renders;
    stamp(); expect(texture.renders).toBe(restoredRenderCount);
  });

  it('uses the current Scene for a shared material after restart and keeps separate games independent', () => {
    const f = fixture(), other = fixture();
    const profile = ROCK_BLOB_SURFACE_PROFILE, mottle = profile.mottle;
    const firstScene = f.scene();
    const key = ensureBlobSurfaceMottleTexture(firstScene as never, profile, mottle);
    const texture = f.entries.get(key)!, contents = [...texture.writes];
    const renderCount = texture.renders;
    const nextScene = f.scene();
    ensureBlobSurfaceMottleTexture(nextScene as never, profile, mottle);
    expect(texture.renders).toBe(renderCount);
    ensureBlobSurfaceMottleTexture(other.scene() as never, profile, mottle);
    const otherTexture = other.entries.get(key)!, otherRenderCount = otherTexture.renders;

    texture.wrapper.createResource();
    ensureBlobSurfaceMottleTexture(nextScene as never, profile, mottle);
    expect(texture.writes).toEqual(contents);
    expect(f.materialScenes).toEqual([firstScene, nextScene]);
    expect(otherTexture.renders).toBe(otherRenderCount);
    expect(otherTexture.writes).toEqual(contents);
    expect(f.textures.addDynamicTexture).toHaveBeenCalledOnce();
  });
});
