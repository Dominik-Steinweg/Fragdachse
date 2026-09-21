import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { ADD: 1, NORMAL: 0 }, Math: {
  Between: () => 0,
  Distance: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) },
} }));
import { GrenadeRenderer } from '../src/effects/GrenadeRenderer';
import { TEX_EXPLOSION_CHUNK } from '../src/effects/gpu/GpuVfxSourceTextures';
import { getCombatExplosionProfile } from '../src/effects/ExplosionVisualProfiles';
import { makeFakeGpuVfxScene, makeFakeDisplayObject } from './fakeGpuVfxScene';

describe('exploding shard presentation', () => {
  it.each(['he_cluster_shard', 'he_demolition_shard'] as const)('uses a visible rotating fragment for %s, independently of physics size', preset => {
    const scene = makeFakeGpuVfxScene();
    const images: Array<{ key: string; object: ReturnType<typeof makeFakeDisplayObject> }> = [];
    scene.add.image = (_x, _y, key) => {
      const object = makeFakeDisplayObject();
      object.setScale = vi.fn(() => object);
      object.setRotation = vi.fn(() => object);
      images.push({ key, object });
      return object;
    };
    const renderer = new GrenadeRenderer(scene as never);
    renderer.createVisual(1, 0, 0, 5, preset);
    expect(images.map(image => image.key)).toEqual(['__grenade_glow', TEX_EXPLOSION_CHUNK]);
    const body = images[1].object;
    const scale = body.setScale.mock.calls.at(-1)[0];
    scene.time.now = 80;
    renderer.updateVisual(1, 50, 20, 50, 100, 10);
    expect(body.setScale.mock.calls.at(-1)[0]).toBe(scale);
    expect(body.setRotation.mock.calls[0][0]).not.toBe(body.setRotation.mock.calls.at(-1)[0]);
    expect(renderer.getActiveIds()).toEqual([1]);
    const profile = getCombatExplosionProfile(preset)!;
    expect(profile.lifeScale).toBeLessThan(getCombatExplosionProfile('default')!.lifeScale);
    expect(profile.smokeScale).toBeLessThan(getCombatExplosionProfile('default')!.smokeScale);
    renderer.destroyAll();
    expect(images.every(image => image.object.destroyed)).toBe(true);
    expect(scene.emitters.every(emitter => emitter.destroyed)).toBe(true);
    expect(renderer.getActiveIds()).toEqual([]);
    renderer.destroyAll();
  });
});

describe('molotov flight presentation', () => {
  it.each(['molotov', 'molotov_void'] as const)('renders %s with its own body, moving trail and complete teardown', preset => {
    const scene = makeFakeGpuVfxScene();
    const images: Array<{ key: string; object: ReturnType<typeof makeFakeDisplayObject> }> = [];
    scene.add.image = (_x, _y, key) => {
      const object = makeFakeDisplayObject();
      object.setPosition = vi.fn(() => object);
      images.push({ key, object });
      return object;
    };
    const killTweensOf = vi.fn();
    Object.assign(scene.tweens, { killTweensOf });
    const renderer = new GrenadeRenderer(scene as never);
    renderer.generateTextures();
    renderer.createVisual(1, 0, 0, 10, preset);
    const body = images.find(image => image.key === `__grenade_body_${preset}`)!;
    const detail = images.find(image => image.key === `__grenade_detail_${preset}`)!;
    expect(body).toBeDefined();
    expect(detail).toBeDefined();
    expect(scene.textures.exists(body.key)).toBe(true);
    expect(scene.textures.exists(detail.key)).toBe(true);
    const trail = scene.emitters[0];
    trail.setPosition = vi.fn(() => trail);
    scene.time.now = 100;
    renderer.updateVisual(1, 100, 50, 10, 100, 0);
    expect(body.object.setPosition).toHaveBeenLastCalledWith(100, 50);
    expect(detail.object.setPosition).toHaveBeenLastCalledWith(100, 50);
    expect(trail.setPosition).toHaveBeenCalled();
    // An additional short-lived flame puff marks the travelled path.
    expect(images.length).toBeGreaterThan(3);
    renderer.destroyAll();
    expect(images.every(image => image.object.destroyed)).toBe(true);
    expect(scene.emitters.every(emitter => emitter.destroyed)).toBe(true);
    expect(killTweensOf).toHaveBeenCalled();
    expect(renderer.getActiveIds()).toEqual([]);
    renderer.destroyAll();
  });
});
