import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());

import { EffectSystem } from '../src/effects/EffectSystem';
import { EnemyManager } from '../src/entities/EnemyManager';
import { healthBarTestScene } from './healthBarTestScene';

function fixture() {
  const f = healthBarTestScene();
  f.scene.events = new EventEmitter();
  const timers: Array<{ callback(): void; remove: ReturnType<typeof vi.fn> }> = [];
  const tweens: Array<{ targets: unknown; onComplete?: () => void }> = [];
  const particles = f.scene.add.particles;
  f.scene.add.particles = (...args: unknown[]) => Object.assign(particles(...args), {
    addEmitZone() {}, explode() {},
  });
  f.scene.time.delayedCall = (_delay: number, callback: () => void) => {
    const timer = { callback, remove: vi.fn() }; timers.push(timer); return timer;
  };
  f.scene.tweens.add = (config: typeof tweens[number]) => { tweens.push(config); return { stop() {} }; };
  f.scene.tweens.killTweensOf = vi.fn();
  const effects = new EffectSystem(f.scene, {} as never);
  // Texture creation is unrelated to ownership; the normal Scene prepares these once.
  Object.assign(effects, { texturesGenerated: true });
  let burrowed = false;
  const enemy = { sprite: { x: 100, y: 200 }, setBurrowed(value: boolean) {
    if (value === burrowed) return false;
    burrowed = value; return true;
  } };
  const manager = Object.assign(Object.create(EnemyManager.prototype), {
    enemies: new Map([['enemy', enemy]]), visualSink: effects,
  }) as EnemyManager;
  return { ...f, timers, tweens, effects, manager };
}

describe('enemy Burrow presentation ownership', () => {
  it.each([false, true])('releases Scene-owned Burrow work after earlier display destruction=%s', displayDestroyed => {
    const f = fixture();
    f.manager.setEnemyBurrowed('enemy', true);
    f.manager.setEnemyBurrowed('enemy', false);
    const destroys = f.cosmetic.map(object => vi.spyOn(object, 'destroy'));
    if (displayDestroyed) f.cosmetic.forEach(object => object.destroy());
    f.scene.events.emit('shutdown');
    expect(f.cosmetic.every(object => !object.active)).toBe(true);
    expect(f.timers.every(timer => timer.remove.mock.calls.length === 1)).toBe(true);
    f.timers.forEach(timer => timer.callback());
    f.tweens.forEach(tween => tween.onComplete?.());
    f.effects.destroy();
    expect(destroys.every(spy => spy.mock.calls.length === 1)).toBe(true);
  });

  it.each(['underground', 'surfaced'] as const)('releases %s effects through the World cleanup endpoint', phase => {
    const f = fixture();
    f.manager.setEnemyBurrowed('enemy', true);
    if (phase === 'surfaced') f.manager.setEnemyBurrowed('enemy', false);
    const retired = [...f.cosmetic], oldTimers = [...f.timers], oldTweens = [...f.tweens];
    expect(retired.length).toBeGreaterThan(0);
    const destroys = retired.map(object => vi.spyOn(object, 'destroy'));
    f.effects.clearAllBurrowStates();
    expect(retired.every(object => !object.active)).toBe(true);
    expect(oldTimers.every(timer => timer.remove.mock.calls.length === 1)).toBe(true);
    oldTweens.forEach(tween => expect(f.scene.tweens.killTweensOf).toHaveBeenCalledWith(tween.targets));
    f.effects.clearAllBurrowStates();

    f.effects.syncBurrowState('enemy', 'underground', { x: 300, y: 400 } as never);
    oldTimers.forEach(timer => timer.callback());
    oldTweens.forEach(tween => tween.onComplete?.());
    expect(f.cosmetic.slice(retired.length).every(object => object.active)).toBe(true);
    expect(destroys.every(spy => spy.mock.calls.length === 1)).toBe(true);
    f.effects.destroy();
    expect(f.cosmetic.every(object => !object.active)).toBe(true);
  });

  it('allows normal surface effects to finish before subsequent World and Scene cleanup', () => {
    const f = fixture();
    f.manager.setEnemyBurrowed('enemy', true);
    f.manager.setEnemyBurrowed('enemy', false);
    const destroys = f.cosmetic.map(object => vi.spyOn(object, 'destroy'));
    expect(f.cosmetic.every(object => object.active)).toBe(true);
    f.timers.forEach(timer => timer.callback());
    f.tweens.forEach(tween => tween.onComplete?.());
    expect(f.cosmetic.every(object => !object.active)).toBe(true);
    f.effects.clearAllBurrowStates();
    f.effects.destroy();
    expect(destroys.every(spy => spy.mock.calls.length === 1)).toBe(true);
  });
});
