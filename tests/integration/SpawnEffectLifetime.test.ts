import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => (await import('../fakeArenaRenderScene')).createFakePhaserModule());

import { PlayerEntity } from '../../src/entities/PlayerEntity';
import { EffectSystem } from '../../src/effects/EffectSystem';
import { SpawnEffectRenderer } from '../../src/effects/SpawnEffectRenderer';
import { healthBarTestScene } from '../healthBarTestScene';

function fixture() {
  const f = healthBarTestScene();
  const timers: Array<{ callback(): void; remove: ReturnType<typeof vi.fn> }> = [];
  const tweens: Array<{ targets: unknown; onComplete?: () => void }> = [];
  const particles = f.scene.add.particles;
  f.scene.add.particles = (...args: unknown[]) => Object.assign(particles(...args), { explode() {} });
  f.scene.time.delayedCall = (_delay: number, callback: () => void) => {
    const timer = { callback, remove: vi.fn() }; timers.push(timer); return timer;
  };
  f.scene.tweens.add = (config: typeof tweens[number]) => { tweens.push(config); return { stop() {} }; };
  f.scene.tweens.killTweensOf = vi.fn();
  return { ...f, timers, tweens, objects: () => [...f.cosmetic, ...f.rectangles] };
}

describe('spawn presentation ownership', () => {
  it('releases player spawn visuals and their delayed work when the player is destroyed', () => {
    const f = fixture();
    const player = new PlayerEntity(f.scene, { id: 'p1', name: 'P1', colorHex: 0x88bbff },
      100, 100, false, null, { spawnEffect: false });
    const existing = new Set(f.objects());
    player.playSpawnEffect();
    const spawnObjects = f.objects().filter(object => !existing.has(object));
    expect(spawnObjects.length).toBeGreaterThan(0);
    expect(spawnObjects.every(object => object.active)).toBe(true);
    player.destroy();
    expect(spawnObjects.every(object => !object.active)).toBe(true);
    expect(f.timers.every(timer => timer.remove.mock.calls.length === 1)).toBe(true);
  });

  it('releases enemy spawn visuals with the effects owner', () => {
    const f = fixture();
    const system = new EffectSystem(f.scene, {} as never);
    system.playEnemySpawnEffect(100, 100, 0x88bbff);
    expect(f.objects().length).toBeGreaterThan(0);
    system.destroy();
    expect(f.objects().every(object => !object.active)).toBe(true);
    expect(f.timers.every(timer => timer.remove.mock.calls.length === 1)).toBe(true);
  });

  it('clears a World without destroying the scene owner and ignores its retired callbacks', () => {
    const f = fixture();
    const system = new EffectSystem(f.scene, {} as never);
    system.playEnemySpawnEffect(100, 100, 0x88bbff);
    const retired = f.objects();
    const oldTimers = [...f.timers], oldTweens = [...f.tweens];
    system.clearSpawnEffects();
    expect(retired.every(object => !object.active)).toBe(true);
    system.playEnemySpawnEffect(200, 200, 0xffffff);
    const tweenCount = f.tweens.length;
    oldTimers.forEach(timer => timer.callback());
    oldTweens.forEach(tween => tween.onComplete?.());
    expect(f.tweens).toHaveLength(tweenCount);
    expect(f.objects().filter(object => !retired.includes(object)).every(object => object.active)).toBe(true);
    system.clearSpawnEffects();
    expect(f.objects().every(object => !object.active)).toBe(true);
  });

  it.each(['play', 'playEnemy'] as const)('forgets naturally completed %s resources', (method) => {
    const f = fixture();
    const renderer = new SpawnEffectRenderer(f.scene);
    renderer[method](100, 100, 0x88bbff);
    const destroyCalls = f.objects().map(object => vi.spyOn(object, 'destroy'));
    for (let i = 0; i < f.tweens.length; i += 1) f.tweens[i].onComplete?.();
    f.timers.forEach(timer => timer.callback());
    expect(f.objects().every(object => !object.active)).toBe(true);
    renderer.clear();
    renderer.clear();
    expect(destroyCalls.every(spy => spy.mock.calls.length === 1)).toBe(true);
  });
});
