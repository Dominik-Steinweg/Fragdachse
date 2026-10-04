import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ BlendModes: { ADD: 1 } }));
vi.mock('../src/effects/EffectUtils', () => ({
  configureAdditiveImage: (image: unknown) => image,
  createEmitter: (scene: { add: { particles(): unknown } }) => scene.add.particles(),
  destroyEmitter: (emitter: { destroy(): void }) => emitter.destroy(),
  ensureCanvasTexture() {},
  fillRadialGradientTexture() {},
  mixColors: (color: number) => color,
}));

import { GuardianSpiritRenderer } from '../src/effects/GuardianSpiritRenderer';
import type { SyncedGuardianSpirit } from '../src/types';

function fixture() {
  const objects: Array<ReturnType<typeof makeObject>> = [];
  function makeObject() {
    const object = {
      active: true,
      setScale: () => object,
      explode: vi.fn(),
      destroy: vi.fn(() => { object.active = false; }),
    };
    objects.push(object);
    return object;
  }
  const timers: Array<{ callback(): void; remove: ReturnType<typeof vi.fn> }> = [];
  const tweens: Array<{ targets: unknown; onComplete(): void }> = [];
  const scene = {
    add: { image: makeObject, particles: makeObject },
    time: { delayedCall: (_delay: number, callback: () => void) => {
      const timer = { callback, remove: vi.fn() }; timers.push(timer); return timer;
    } },
    tweens: { add: (config: typeof tweens[number]) => { tweens.push(config); }, killTweensOf: vi.fn() },
  };
  return { renderer: new GuardianSpiritRenderer(scene as never), scene, objects, timers, tweens };
}

const spirit: SyncedGuardianSpirit = { id: 1, ownerId: 'p1', x: 30, y: 60, ownerColor: 0xaaccff, phase: 'orbiting' };

describe('guardian spirit presentation lifetime', () => {
  it('releases spawn and impact effects with their World and ignores retired callbacks in the next World', () => {
    const f = fixture();
    f.renderer.syncVisuals([spirit]);
    f.renderer.syncVisuals([{ ...spirit, phase: 'impact' }]);
    const retired = [...f.objects];
    const retiredTimers = [...f.timers];
    const retiredTween = f.tweens[0];
    f.renderer.destroyAll();
    expect(retired.every(object => !object.active)).toBe(true);
    expect(retiredTimers.every(timer => timer.remove.mock.calls.length === 1)).toBe(true);
    expect(f.scene.tweens.killTweensOf).toHaveBeenCalledWith(retiredTween.targets);
    f.renderer.destroyAll();
    expect(retired.every(object => object.destroy.mock.calls.length === 1)).toBe(true);

    f.renderer.syncVisuals([{ ...spirit, id: 2 }]);
    retiredTimers.forEach(timer => timer.callback());
    retiredTween.onComplete();
    expect(f.objects.slice(retired.length).every(object => object.active)).toBe(true);
    expect(retired.every(object => object.destroy.mock.calls.length === 1)).toBe(true);
    f.renderer.destroyAll();
    expect(f.objects.every(object => object.destroy.mock.calls.length === 1)).toBe(true);
  });

  it('forgets naturally completed one-shot effects before World teardown', () => {
    const f = fixture();
    f.renderer.syncVisuals([spirit]);
    f.renderer.syncVisuals([{ ...spirit, phase: 'impact' }]);
    f.timers.forEach(timer => timer.callback());
    f.tweens.forEach(tween => tween.onComplete());
    f.renderer.destroyAll();
    expect(f.objects.every(object => object.destroy.mock.calls.length === 1)).toBe(true);
  });
});
