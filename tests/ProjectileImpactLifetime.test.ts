import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ BlendModes: { ADD: 1 }, Math: { RadToDeg: (r: number) => r * 180 / Math.PI } }));
vi.mock('../src/effects/EffectUtils', () => ({
  configureAdditiveImage: (image: unknown) => image,
  createEmitter: (scene: { add: { particles(): unknown } }) => scene.add.particles(),
  destroyEmitter: (emitter: { destroy(): void }) => emitter.destroy(),
  mixColors: (color: number) => color,
  setCircleEmitZone() {},
}));

import { HydraRenderer } from '../src/effects/HydraRenderer';
import { SporeRenderer } from '../src/effects/SporeRenderer';
import { ProjectilePresentationRuntime } from '../src/projectile/ProjectilePresentationRuntime';

function fixture() {
  const objects: Array<ReturnType<typeof makeObject>> = [];
  function makeObject() {
    const object = {
      active: true, scaleX: 1, scaleY: 1, rotation: 0,
      setScale: () => object, setDepth: () => object, setBlendMode: () => object,
      setAlpha: () => object, setTint: () => object, setRotation: () => object,
      explode: vi.fn(), destroy: vi.fn(() => { object.active = false; }),
    };
    objects.push(object); return object;
  }
  const tweens: Array<{ targets: unknown; onComplete(): void }> = [];
  const timers: Array<{ callback(): void; remove: ReturnType<typeof vi.fn> }> = [];
  const scene = {
    add: { image: makeObject, particles: makeObject },
    tweens: { add: (config: typeof tweens[number]) => { tweens.push(config); }, killTweensOf: vi.fn() },
    time: { delayedCall: (_delay: number, callback: () => void) => {
      const timer = { callback, remove: vi.fn() }; timers.push(timer); return timer;
    } },
  };
  const hydra = new HydraRenderer(scene as never), spore = new SporeRenderer(scene as never);
  const owner = new ProjectilePresentationRuntime(scene as never);
  owner.bindRenderers({ hydra, spore } as never, null);
  return { scene, objects, timers, tweens, hydra, spore, owner };
}

describe('projectile one-shot effects belong to their World presentation', () => {
  it.each(['hydra', 'hydra-split', 'spore', 'spore_void'] as const)(
    'clears %s impacts and ignores callbacks retired by a World transition', kind => {
      const f = fixture();
      const impact = () => kind === 'hydra' ? f.hydra.playImpact(300, 300, 0xffffff)
        : kind === 'hydra-split' ? f.hydra.playSplitImpact(300, 300, 0xffffff, [0, 1])
        : f.spore.playImpact(300, 300, 0xffffff, 1, kind);
      impact();
      expect(f.objects.length).toBeGreaterThan(0);
      const retired = [...f.objects], retiredTweens = [...f.tweens], retiredTimers = [...f.timers];
      f.owner.releaseWorldPresentation();
      expect(retired.every(object => !object.active)).toBe(true);
      expect(retiredTimers.every(timer => timer.remove.mock.calls.length === 1)).toBe(true);
      retiredTweens.forEach(tween => expect(f.scene.tweens.killTweensOf).toHaveBeenCalledWith(tween.targets));
      f.owner.releaseWorldPresentation();
      expect(retired.every(object => object.destroy.mock.calls.length === 1)).toBe(true);

      impact();
      retiredTweens.forEach(tween => tween.onComplete());
      retiredTimers.forEach(timer => timer.callback());
      expect(f.objects.slice(retired.length).every(object => object.active)).toBe(true);
      f.tweens.slice(retiredTweens.length).forEach(tween => tween.onComplete());
      f.timers.slice(retiredTimers.length).forEach(timer => timer.callback());
      f.owner.releaseWorldPresentation();
      expect(f.objects.every(object => object.destroy.mock.calls.length === 1)).toBe(true);
    },
  );
});
