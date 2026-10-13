import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { ADD: 1 }, TintModes: { FILL: 1 } }));
vi.mock('../src/effects/gpu/GpuVfxSourceTextures', () => ({
  ensureExplosionSparkTexture: vi.fn(), TEX_EXPLOSION_SPARK: 'spark',
}));
import * as Phaser from 'phaser';
import { DawnSitePropRenderer, type DawnSiteLightingPort } from '../src/arena/DawnSitePropRenderer';
import { composeDawnRoundPlans } from '../src/dawn/composition/DawnRoundComposition';
import { resolveDawnWorldDefinition, toDawnSiteObjectiveId } from '../src/dawn/resolution/DawnScenarioResolution';
import type { CoopDefenseSecondaryObjectivePresentationState } from '../src/types';

function fixture() {
  const objects: { destroy: ReturnType<typeof vi.fn>; setAlpha: ReturnType<typeof vi.fn> }[] = [];
  const create = () => {
    const object = { destroy: vi.fn(), setAlpha: vi.fn().mockReturnThis() };
    for (const key of ['setOrigin', 'setDepth', 'setBlendMode', 'setDisplaySize', 'setTint',
      'setTintMode', 'clearTint', 'play', 'stop', 'setTexture']) {
      Object.assign(object, { [key]: vi.fn().mockReturnThis() });
    }
    objects.push(object);
    return object;
  };
  const scene = { add: { sprite: vi.fn(create), image: vi.fn(create), particles: vi.fn(create) },
    textures: { exists: vi.fn(() => true) }, anims: { exists: () => true }, time: { now: 0 } };
  const plan = composeDawnRoundPlans({ seed: 12345, threat: 3, dayNumber: 1 }).world;
  // Exercise both archetypes regardless of composition tuning.
  const sites = plan.sites.slice(0, 2).map((site, i) => ({ ...site, archetypeId: i ? 'extractor' : 'wreck', tier: 3 as const }));
  const worldPlan = { ...plan, sites };
  const keys = new Set<string>();
  const lighting: DawnSiteLightingPort = {
    setLight: vi.fn(key => { keys.add(key); }), releaseLight: vi.fn(key => { keys.delete(key); }),
    getArtificialLightFactor: vi.fn(() => 1),
  };
  let destroyed = false;
  const renderer = new DawnSitePropRenderer(scene as unknown as Phaser.Scene, worldPlan,
    resolveDawnWorldDefinition(worldPlan), () => destroyed, () => 100, lighting);
  const completed = sites.map(site => ({ objectiveId: toDawnSiteObjectiveId(site.slotId), state: 'completed' })) as CoopDefenseSecondaryObjectivePresentationState;
  return { scene, renderer, keys, objects, lighting, completed, destroyStructures: () => { destroyed = true; } };
}

describe('Dawn site presentation light lifetime', () => {
  it('reuses sources and removes wreck emission and sparks on replicated salvage', () => {
    const f = fixture();
    f.renderer.sync(null);
    expect(f.keys.size).toBeGreaterThan(0);
    const count = f.objects.length;
    const wreckEmitter = f.scene.add.particles.mock.results[0].value;
    f.renderer.sync(null);
    expect(f.objects).toHaveLength(count);
    f.renderer.sync(f.completed);
    expect([...f.keys].every(key => !key.endsWith(':tech'))).toBe(true);
    expect(f.keys.size).toBeGreaterThan(0); // completed extractor remains lit
    expect(wreckEmitter.destroy).toHaveBeenCalledOnce();
    f.destroyStructures();
    f.renderer.sync(f.completed);
    expect(f.keys.size).toBe(0);
    expect(vi.mocked(f.lighting.releaseLight).mock.calls.every(([, options]) => options?.immediate)).toBe(true);
    expect(f.objects.every(object => object.destroy.mock.calls.length === 1)).toBe(true);
  });

  it('releases all owned resources on teardown and cannot resurrect a closed activity', () => {
    const f = fixture();
    f.renderer.sync(null);
    f.renderer.destroy();
    f.renderer.destroy();
    f.renderer.sync(null);
    expect(f.keys.size).toBe(0);
    expect(f.objects.every(object => object.destroy.mock.calls.length === 1)).toBe(true);
  });

  it('removes lights when required prop art disappears and gates emission by daylight', () => {
    const f = fixture();
    vi.mocked(f.lighting.getArtificialLightFactor).mockReturnValue(0);
    f.renderer.sync(null);
    for (const call of [...f.scene.add.image.mock.results, ...f.scene.add.particles.mock.results]) {
      expect(call.value.setAlpha).toHaveBeenLastCalledWith(0);
    }
    f.scene.textures.exists.mockReturnValue(false);
    f.renderer.sync(null);
    expect(f.keys.size).toBe(0);
    expect(f.objects.every(object => object.destroy.mock.calls.length === 1)).toBe(true);
  });
});
