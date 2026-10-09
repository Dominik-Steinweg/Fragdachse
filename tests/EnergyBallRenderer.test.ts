import { describe, expect, it, vi } from 'vitest';
import type { EnergyBallGpuStore } from '../src/effects/energyBall/EnergyBallGpuStore';

const layers = vi.hoisted(() => [] as Array<{ store: EnergyBallGpuStore; image: { destroy: ReturnType<typeof vi.fn> } }>);
vi.mock('phaser', () => ({ BlendModes: { ADD: 1 } }));
vi.mock('../src/effects/EffectUtils', () => ({ registerGraphicsObject: vi.fn() }));
vi.mock('../src/effects/energyBall/EnergyBallGpuLayer', () => ({
  createEnergyBallGpuLayer: (_scene: unknown, store: EnergyBallGpuStore) => {
    const layer = { store, image: { destroy: vi.fn() } };
    layers.push(layer);
    return layer;
  },
}));
import { EnergyBallRenderer } from '../src/effects/EnergyBallRenderer';
import { ProjectilePresentationRuntime } from '../src/projectile/ProjectilePresentationRuntime';

function fixture() {
  layers.length = 0;
  const scene = { time: { now: 1000 } };
  const renderer = new EnergyBallRenderer(scene as never);
  renderer.generateTextures();
  return { scene, renderer, store: () => layers[layers.length - 1].store };
}

describe('energy ball GPU presentation', () => {
  it.each(['default', 'plasma'] as const)('releases %s balls and impacts through the actual World presentation owner', variant => {
    const { scene, renderer, store } = fixture();
    const owner = new ProjectilePresentationRuntime(scene as never);
    owner.bindRenderers({ energyBall: renderer } as never, null);
    renderer.createVisual(7, 300, 300, 12, 0xff2233, variant);
    renderer.playImpact(300, 300, 0xff2233, variant);
    expect(store().count).toBe(2);

    const retired = layers[0];
    owner.releaseWorldPresentation();
    expect(retired.store.count).toBe(0);
    expect(retired.image.destroy).toHaveBeenCalledOnce();
    expect(renderer.getActiveIds()).toEqual([]);
    owner.releaseWorldPresentation();
    expect(retired.image.destroy).toHaveBeenCalledOnce();

    // A later World rebuilds the layer lazily; its impacts are unaffected by the retired one.
    renderer.playImpact(300, 300, 0xff2233, variant);
    expect(layers).toHaveLength(2);
    expect(store().count).toBe(1);
    scene.time.now += 1000;
    renderer.playImpact(310, 300, 0xff2233, variant);
    expect(store().count).toBe(1);
  });

  it('follows movement, size, color and variant changes on the same instance', () => {
    const { scene, renderer, store } = fixture();
    renderer.createVisual(1, 10, 20, 12, 0xff2233);
    const snapshot = () => Array.from(store().data.subarray(0, store().count * 23 * 6));
    const initial = snapshot();
    scene.time.now = 1100;
    renderer.updateVisual(1, 30, 40, 12, 400, 0, 0xff2233);
    expect(snapshot()).not.toEqual(initial);
    const moved = snapshot();
    renderer.updateVisual(1, 30, 40, 24, 400, 0, 0x3355ff, 'plasma');
    expect(snapshot()).not.toEqual(moved);
    expect(store().count).toBe(1);
    expect(renderer.getActiveIds()).toEqual([1]);
    renderer.destroyVisual(1);
    expect(store().count).toBe(0);
    expect(renderer.has(1)).toBe(false);
  });
});
