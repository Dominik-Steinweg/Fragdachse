import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => ({ ...(await import('./fakeArenaRenderScene')).createFakePhaserModule(),
  Scenes: { Events: { POST_UPDATE: 'postupdate', SHUTDOWN: 'shutdown' } }, Textures: { FilterMode: { LINEAR: 1 } } }));
vi.mock('../src/effects/EffectUtils', () => ({
  circleZone: () => ({}), edgeZone: () => ({}), ensureCanvasTexture() {},
  createSeededRandom: () => () => 0.5, mixColors: (color: number) => color,
  registerGraphicsObject() {}, registerParticleEmitter() {},
}));
import { SmokeSystem } from '../src/effects/SmokeSystem';
import { healthBarTestScene, HealthTestObject } from './healthBarTestScene';
import type { SyncedSmokeCloud } from '../src/types';

describe('shared smoke presentation', () => {
  it('caps the composite, bounds resolution by viewport, flushes captures and clears without replaying old growth', () => {
    const scene = healthBarTestScene().scene;
    const frameCallbacks = new Map<Function, () => void>();
    scene.events = { on: (_event: string, fn: Function, owner: unknown) => frameCallbacks.set(fn, () => fn.call(owner)),
      once() {}, off: (_event: string, fn: Function) => frameCallbacks.delete(fn) };
    const camera = { width: 800, height: 600, zoom: 1, scrollX: 100, scrollY: 50, originX: 0, originY: 0 };
    scene.cameras.main = camera;
    const objects: HealthTestObject[] = [], surfaces: any[] = [], rings: unknown[] = [];
    function object(x = 0, y = 0) {
      const children: HealthTestObject[] = [];
      const value = Object.assign(new HealthTestObject(scene, x, y), {
        add(child: HealthTestObject) { children.push(child); return this; },
        destroy(recursive = false) { if (recursive) children.forEach(child => child.destroy()); HealthTestObject.prototype.destroy.call(this); },
        addEmitZone() { return this; }, clearEmitZones() { return this; }, setParticleScale() { return this; },
        strokeCircle(...args: number[]) { rings.push(args); return this; },
      }); objects.push(value); return value;
    }
    scene.add.container = object; scene.add.particles = object; scene.add.graphics = object;
    scene.add.image = (x: number, y: number, key: string) => {
      const image = object(x, y); image.texture.key = key;
      if (key === '__smoke_growth_ring') rings.push(image);
      return image;
    };
    scene.add.renderTexture = (x: number, y: number, width: number, height: number) => {
      const pending: unknown[] = [], rendered: unknown[] = [];
      const result = Object.assign(object(x, y), { texture: { setFilter() {} }, width, height,
        clear() { pending.length = 0; rendered.length = 0; return this; },
        capture(source: HealthTestObject, overrides: object) { pending.push({ source, overrides }); return this; },
        render() { rendered.push(...pending); pending.length = 0; return this; }, rendered, pending });
      surfaces.push(result); return result;
    };
    const renderer = new SmokeSystem(scene);
    const cloud: SyncedSmokeCloud = { id: 1, x: 300, y: 250, radius: 100, alpha: 0.68, density: 1, storm: false, growthSequence: 3 };
    const frame = () => frameCallbacks.forEach(fn => fn());
    renderer.syncVisuals([cloud], 1000); frame();
    const surface = surfaces[0];
    expect(surface.rendered.length).toBeGreaterThan(0);
    expect(surface.pending).toEqual([]);
    expect(rings).toEqual([]); // Late join must not replay growthSequence 1..3.
    const alpha = surface.alpha;
    renderer.syncVisuals([cloud, { ...cloud, id: 2 }, { ...cloud, id: 3 }], 1000); frame();
    expect(surfaces).toHaveLength(1); expect(surface.alpha).toBe(alpha); expect(alpha).toBeLessThan(1);
    expect(surface.rendered.every((c: any) => !c.source.visible && c.overrides.visible)).toBe(true);
    camera.zoom = 0.25; camera.scrollX = -300; frame();
    expect(surfaces).toHaveLength(1); expect(surface.width).toBeLessThanOrEqual(camera.width);
    expect(surface.displayWidth).toBe(camera.width / camera.zoom);
    const capture = surface.rendered[0].overrides;
    expect(capture.x / capture.scaleX).toBe(cloud.x - camera.scrollX);
    renderer.syncVisuals([{ ...cloud, growthSequence: 5 }], 1100); frame();
    expect(rings.length).toBeGreaterThan(0); // Several missed procs become one current impulse.
    renderer.syncVisuals([], 1200); frame();
    expect(surface.rendered).toEqual([]);
    renderer.destroyAll();
    expect(objects.every(o => !o.active)).toBe(true);
    expect(surface.active).toBe(false);
  });
});
