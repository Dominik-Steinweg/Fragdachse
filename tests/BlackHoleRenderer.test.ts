import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 } }));
vi.mock('../src/utils/phaserFx', () => ({ addInternalGlow() {}, setInternalFxPadding() {} }));
vi.mock('../src/effects/EffectUtils', () => ({
  circleZone: () => ({}),
  createEmitter: (scene: { add: { particles(): unknown } }) => scene.add.particles(),
  destroyEmitter: (emitter: { stop(): void; destroy(): void }) => { emitter.stop(); emitter.destroy(); },
  ensureCanvasTexture() {},
  fillRadialGradientTexture() {},
}));

import { BlackHoleRenderer } from '../src/effects/BlackHoleRenderer';

function fixture() {
  const objects: Array<ReturnType<typeof makeObject>> = [];
  function makeObject() {
    const object = {
      active: true,
      setDepth: () => object,
      setBlendMode: () => object,
      setDisplaySize: () => object,
      setAlpha: () => object,
      createGravityWell: vi.fn(),
      emitParticle: vi.fn(),
      stop: vi.fn(),
      destroy: vi.fn(() => { object.active = false; }),
    };
    objects.push(object);
    return object;
  }
  const timers: Array<{ callback(): void; remove: ReturnType<typeof vi.fn> }> = [];
  const tweens: Array<{ targets: unknown; onComplete?: () => void }> = [];
  const scene = {
    add: { image: makeObject, particles: makeObject },
    time: { delayedCall: (_delay: number, callback: () => void) => {
      const timer = { callback, remove: vi.fn() }; timers.push(timer); return timer;
    } },
    tweens: { add: (config: typeof tweens[number]) => { tweens.push(config); }, killTweensOf: vi.fn() },
  };
  const renderer = new BlackHoleRenderer(scene as never);
  const submit = vi.fn(); renderer.setDistortionComposer({ submit } as never);
  return { renderer, objects, timers, tweens, scene, submit };
}

describe('black-hole presentation lifetime', () => {
  it('releases images, emitters, timers and tweens at World teardown and can serve the next World', () => {
    const f = fixture();
    f.renderer.play(40, 60, 120, 2000);
    const retired = [...f.objects], oldTimers = [...f.timers];
    const oldCompletion = f.tweens.find(tween => tween.onComplete)!.onComplete!;
    f.renderer.destroyAll();
    expect(retired.every(object => !object.active)).toBe(true);
    expect(oldTimers.every(timer => timer.remove.mock.calls.length === 1)).toBe(true);
    expect(f.scene.tweens.killTweensOf).toHaveBeenCalledWith(expect.arrayContaining(retired));
    f.renderer.update(50);
    expect(f.submit).not.toHaveBeenCalled();
    f.renderer.destroyAll();
    expect(retired.every(object => object.destroy.mock.calls.length === 1)).toBe(true);
    f.renderer.play(90, 30, 80, 1000);
    oldCompletion();
    expect(f.objects.slice(retired.length).every(object => object.active)).toBe(true);
    f.renderer.destroyAll();
    expect(f.objects.every(object => object.destroy.mock.calls.length === 1)).toBe(true);
  });

  it('does not retain or release a naturally completed visual twice', () => {
    const f = fixture();
    f.renderer.play(0, 0, 100, 1000);
    f.tweens.find(tween => tween.onComplete)!.onComplete!();
    expect(f.objects.every(object => !object.active)).toBe(true);
    f.renderer.destroyAll();
    expect(f.objects.every(object => object.destroy.mock.calls.length === 1)).toBe(true);
    expect(f.timers.every(timer => timer.remove.mock.calls.length === 1)).toBe(true);
  });
});
