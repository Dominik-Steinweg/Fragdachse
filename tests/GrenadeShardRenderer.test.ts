import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { ADD: 1, NORMAL: 0 }, Math: { Between: () => 0 } }));
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
