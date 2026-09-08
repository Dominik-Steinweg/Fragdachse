import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => ({ ...(await import('./fakeArenaRenderScene')).createFakePhaserModule(),
  Scenes: { Events: { POST_UPDATE: 'postupdate', SHUTDOWN: 'shutdown' } }, Textures: { FilterMode: { LINEAR: 1 } } }));
vi.mock('../src/effects/EffectUtils', () => ({
  circleZone: () => ({}), edgeZone: () => ({}), ensureCanvasTexture() {},
  createSeededRandom: () => () => 0.5, mixColors: (color: number) => color,
  registerGraphicsObject() {}, registerParticleEmitter() {},
  fillRadialGradientTexture() {}, makeAdditive: (object: unknown) => object,
}));
import { SmokeSystem } from '../src/effects/SmokeSystem';
import { healthBarTestScene, HealthTestObject } from './healthBarTestScene';
import type { SyncedSmokeCloud } from '../src/types';
import { GraphicsQualityController } from '../src/graphics/GraphicsQuality';
import { sampleSmokeWeather } from '../src/effects/smokeCloudShader';
import { SmokeBodyEffect, VulnerableBodyEffect } from '../src/effects/SmokeBodyEffect';
import { DEPTH } from '../src/config';

describe('shared smoke presentation', () => {
  it('layers body statuses independently below smoke, with only diffuse charge above it', () => {
    const { scene, cosmetic } = healthBarTestScene();
    const sprite = new HealthTestObject(scene, 150, 190).setDepth(DEPTH.PLAYERS).setTexture('enemy', 'walk-2');
    const target = { sprite: sprite as any, bodySize: 40, visible: true };
    const vulnerability = new VulnerableBodyEffect(scene);
    vulnerability.setActive(true); vulnerability.sync(target);
    const overlay = cosmetic[0];
    const effect = new SmokeBodyEffect(scene, target, 'wisp', 3);
    const statuses = cosmetic.slice(1);
    const epoch = Date.UTC(2026, 8, 8);
    let litTime = 0;
    for (; litTime < 1000; litTime += 10) {
      scene.time.now = litTime;
      effect.update(target, epoch + 5000, epoch + 5000, epoch + litTime, .96);
      if (statuses.some(o => o.depth > DEPTH.SMOKE && o.visible && o.alpha > 0)) break;
    }
    expect(litTime).toBeLessThan(1000);
    const above = statuses.filter(o => o.depth > DEPTH.SMOKE);
    expect(above).toHaveLength(1);
    expect(statuses.filter(o => o.depth < DEPTH.SMOKE && o.visible && o.alpha > 0).length).toBeGreaterThan(1);
    const before = statuses.filter(o => o.depth < DEPTH.SMOKE).map(o => o.alpha);
    effect.update(target, epoch + 5000, epoch + 5000, epoch + litTime, 0);
    expect(above[0].visible).toBe(false);
    expect(statuses.filter(o => o.depth < DEPTH.SMOKE).map(o => o.alpha)).toEqual(before);
    effect.update(target, epoch + 5000, epoch + 5000, epoch + 4850, 0);
    const fading = statuses.filter(o => o.depth < DEPTH.SMOKE).map(o => o.alpha);
    expect(fading.every((alpha, i) => alpha <= before[i])).toBe(true);
    expect(fading.some((alpha, i) => alpha < before[i])).toBe(true);
    sprite.setPosition(240, 270).setTexture('enemy', 'walk-3').setFlip(true, false).setRotation(.7).setDisplaySize(80, 55);
    vulnerability.sync(target);
    expect(overlay.texture.key).toBe('enemy'); expect(overlay.frame.name).toBe('walk-3');
    expect([overlay.x, overlay.y, overlay.rotation, overlay.flipX, overlay.displayWidth]).toEqual([240, 270, .7, true, 80]);
    expect(overlay.depth).toBeLessThan(DEPTH.SMOKE);
    expect(sprite.alpha).toBe(1);
    const fullAlpha = overlay.alpha;
    vulnerability.setActive(false); scene.time.now += 110;
    vulnerability.setActive(false); vulnerability.sync(target);
    expect(overlay.alpha).toBeLessThan(fullAlpha);
    scene.time.now += 300; vulnerability.sync(target); expect(overlay.active).toBe(false);
    effect.update({ ...target, visible: false }, epoch + 5000, epoch + 5000, epoch + litTime, 1);
    expect(statuses.every(o => !o.visible)).toBe(true);
    effect.destroy(); vulnerability.destroy(); expect(cosmetic.every(o => !o.active)).toBe(true);
  });

  it('invalidates body effects on hidden or missing targets, reused sprite IDs, expiry and teardown', () => {
    const { scene, cosmetic } = healthBarTestScene();
    let frame = () => {};
    scene.events.on = (_event: string, callback: Function, owner: unknown) => { frame = () => callback.call(owner); };
    scene.cameras.main = { width: 800, height: 600, zoom: 1, scrollX: 0, scrollY: 0, originX: 0, originY: 0 };
    const renderer = new SmokeSystem(scene);
    const epoch = Date.UTC(2026, 8, 8);
    let target: any = { sprite: new HealthTestObject(scene, 200, 200), bodySize: 40, visible: true };
    renderer.syncTargetVisuals([{ enemyId: 'enemy', confusedUntil: epoch + 1000, chargedUntil: epoch + 1000 }], epoch, () => target);
    frame(); const initial = [...cosmetic]; expect(initial.length).toBeGreaterThan(0);
    target = { ...target, sprite: new HealthTestObject(scene, 210, 220) }; frame();
    expect(initial.every(o => !o.active)).toBe(true);
    target.visible = false; frame(); expect(cosmetic.every(o => !o.active)).toBe(true);
    target.visible = true; frame(); target = null; frame(); expect(cosmetic.every(o => !o.active)).toBe(true);
    target = { sprite: new HealthTestObject(scene, 200, 200), bodySize: 80, visible: true }; frame();
    scene.time.now = 1001; frame(); expect(cosmetic.every(o => !o.active)).toBe(true);
    renderer.destroyAll(); expect(cosmetic.every(o => !o.active)).toBe(true);
  });

  it.each([0, Date.UTC(2026, 8, 8)])('keeps composition, animation precision and cleanup at clock epoch %s', epoch => {
    const scene = healthBarTestScene().scene;
    const frameCallbacks = new Map<Function, () => void>();
    scene.events = { on: (_event: string, fn: Function, owner: unknown) => frameCallbacks.set(fn, () => fn.call(owner)),
      once() {}, off: (_event: string, fn: Function) => frameCallbacks.delete(fn) };
    const camera = { width: 800, height: 600, zoom: 1, scrollX: 100, scrollY: 50, originX: 0, originY: 0 };
    scene.cameras.main = camera;
    const objects: HealthTestObject[] = [], surfaces: any[] = [], rings: unknown[] = [], shaders: any[] = [];
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
    scene.add.shader = (config: any, x: number, y: number, width: number, height: number) => {
      const uniforms: Record<string, any> = {};
      const shader = Object.assign(object(x, y).setSize(width, height), { uniforms, displayOriginX: 0, displayOriginY: 0,
        setOrigin(value: number) { this.displayOriginX = this.width * value; this.displayOriginY = this.height * value; return this; },
        submit() { config.setupUniforms((name: string, value: unknown) => uniforms[name] = value); } });
      shaders.push(shader); return shader;
    };
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
        render() { rendered.push(...pending); pending.length = 0; rendered.forEach((c: any) => c.source.submit()); return this; }, rendered, pending });
      surfaces.push(result); return result;
    };
    const quality = new GraphicsQualityController('high'); quality.attach(scene);
    const renderer = new SmokeSystem(scene);
    const lighting = { setLight: vi.fn(), releaseLight: vi.fn() };
    renderer.setLightingSystem(lighting as any);
    const cloud: SyncedSmokeCloud = { id: 1, x: 300, y: 250, radius: 100, alpha: 0.68, density: 1, storm: false, growthSequence: 3 };
    const frame = () => frameCallbacks.forEach(fn => fn());
    const sync = (clouds: SyncedSmokeCloud[], now: number) => renderer.syncVisuals(clouds, epoch + now);
    sync([cloud], 1000); frame();
    const surface = surfaces[0];
    expect(surface.rendered).toHaveLength(1);
    expect(shaders).toHaveLength(1);
    const initialTime = shaders[0].uniforms.uTime;
    scene.time.now += 16; frame();
    expect(Math.fround(shaders[0].uniforms.uTime) - Math.fround(initialTime)).toBeCloseTo(0.016, 5);
    expect(shaders[0].uniforms.uTime).toBeLessThan(60);
    expect(Math.abs(shaders[0].uniforms.uArcSeed)).toBeLessThan(1e5);
    expect(surface.pending).toEqual([]);
    expect(rings).toEqual([]); // Late join must not replay growthSequence 1..3.
    const alpha = surface.alpha;
    sync([cloud, { ...cloud, id: 2 }, { ...cloud, id: 3 }], 1000); frame();
    expect(surfaces).toHaveLength(1); expect(surface.alpha).toBe(alpha); expect(alpha).toBeLessThan(1);
    expect(surface.rendered.every((c: any) => !c.source.visible && c.overrides.visible)).toBe(true);
    camera.zoom = 0.25; camera.scrollX = -300; frame();
    expect(surfaces).toHaveLength(1); expect(surface.width).toBeLessThanOrEqual(camera.width);
    expect(surface.displayWidth).toBe(camera.width / camera.zoom);
    const capture = surface.rendered[0].overrides;
    expect(capture.x / capture.scaleX).toBe(cloud.x - camera.scrollX);
    const highPixels = shaders[0].uniforms.uPixels, highDetail = shaders[0].uniforms.uDetail;
    quality.setLevel('medium'); frame();
    const medium = surfaces.at(-1);
    expect(surface.active).toBe(false);
    expect(medium.width).toBeLessThan(surface.width);
    expect(medium.alpha).toBe(alpha);
    expect(shaders[0].uniforms.uPixels).toBeLessThan(highPixels);
    expect(shaders[0].uniforms.uDetail).toBeLessThan(highDetail);
    quality.setLevel('low'); frame();
    const low = surfaces.at(-1);
    expect(low.width).toBeLessThan(medium.width);
    expect(low.alpha).toBe(alpha);
    expect(low.rendered[0].source.width).toBe(cloud.radius * 2);
    sync([{ ...cloud, radius: cloud.radius * 1.3 }], 1050); frame();
    const resized = low.rendered[0].source;
    expect(resized.displayOriginX).toBe(resized.width / 2);
    expect(resized.displayOriginY).toBe(resized.height / 2);
    sync([{ ...cloud, growthSequence: 5 }], 1100); frame();
    expect(rings.length).toBeGreaterThan(0); // Several missed procs become one current impulse.
    sync([], 1200); frame();
    expect(low.rendered).toEqual([]);
    expect(low.active).toBe(false);
    sync([{ ...cloud, x: 1e6 }], 1300); frame();
    expect(shaders.filter(s => s.active)).toHaveLength(0);
    expect(surfaces.filter(s => s.active)).toHaveLength(0);
    sync([{ ...cloud, storm: true }], 1400);
    frame();
    expect(shaders.at(-1).uniforms.uTime).toBeCloseTo(0.1, 5); // Culling retains the cloud's clock origin.
    // Find a lit cosmetic instant without coupling the test to its artistic timing.
    scene.time.now = 0;
    for (let t = 0; t < 5000 && !lighting.setLight.mock.calls.length; t += 20) { scene.time.now = t; frame(); }
    expect(lighting.setLight).toHaveBeenCalled();
    expect(Math.abs(shaders.at(-1).uniforms.uArcSeed)).toBeLessThan(1e5);
    const lightKey = lighting.setLight.mock.lastCall![0];
    sync([{ ...cloud, storm: true, phase: 'dissipating' }], 6500); frame();
    expect(shaders.at(-1).uniforms.uFlash).toBe(0);
    expect(lighting.releaseLight).toHaveBeenCalledWith(lightKey, { immediate: true });
    renderer.destroyAll();
    expect(objects.every(o => !o.active)).toBe(true);
    expect(surface.active).toBe(false);
    sync([cloud], 10000); frame();
    expect(shaders.at(-1).uniforms.uTime).toBe(0); // Reused IDs start a new visual lifetime.
    renderer.destroyAll();
  });
  it('samples weather reproducibly without replay, using distinct local positions and bounded light energy', () => {
    const samples = Array.from({ length: 400 }, (_, i) => sampleSmokeWeather(i / 20, 7));
    expect(sampleSmokeWeather(3.2, 7)).toEqual(sampleSmokeWeather(3.2, 7));
    expect(sampleSmokeWeather(3.2, 8)).not.toEqual(sampleSmokeWeather(3.2, 7));
    expect(new Set(samples.map(s => s.a.slice(0, 2).join(','))).size).toBeGreaterThan(1);
    expect(samples.some(s => s.flash > 0)).toBe(true);
    expect(samples.some(s => s.flash === 0)).toBe(true);
    for (const sample of samples) for (const lane of [sample.a, sample.b]) {
      expect(Math.hypot(lane[0], lane[1])).toBeLessThan(1);
      expect(lane[2]).toBeGreaterThanOrEqual(0); expect(lane[2]).toBeLessThanOrEqual(1);
    }
  });
});
