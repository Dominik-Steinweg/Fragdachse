import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => ({
  ...(await import('../fakeArenaRenderScene')).createFakePhaserModule(), Scene: class {},
  Filters: { Displacement: class {}, ParallelFilters: class {} },
}));
const bridgeMock = vi.hoisted(() => ({
  isHost: () => false, registerTrainBurrowSparksHandler: vi.fn(),
  publishCoopDefenseSecondaryObjectivePresentationState() {},
  publishCoopDefenseMissionProgressPresentationState() {}, publishCoopDefenseMapEventPresentationState() {},
}));
vi.mock('../../src/network/bridge', () => ({ bridge: bridgeMock }));
vi.mock('../../src/scenes/arena/rendererWorldTeardown', () => ({
  resetRenderersForWorldGameplayTeardown() {}, resetRenderersForWorldPresentationTeardown() {},
}));

import { EffectSystem } from '../../src/effects/EffectSystem';
import { EnemyDashVisualTracker } from '../../src/effects/EnemyDashVisuals';
import { ArenaLifecycleCoordinator } from '../../src/scenes/arena/ArenaLifecycleCoordinator';
import { RpcCoordinator } from '../../src/scenes/arena/RpcCoordinator';
import { healthBarTestScene } from '../healthBarTestScene';

function fixture() {
  const f = healthBarTestScene();
  f.scene.events = new EventEmitter();
  const timers: Array<{ callback(): void; remove: ReturnType<typeof vi.fn> }> = [];
  const tweens: Array<{ targets: unknown; onComplete?: () => void }> = [];
  const particles = f.scene.add.particles;
  f.scene.add.particles = (...args: unknown[]) => Object.assign(particles(...args), { explode() {} });
  f.scene.time.delayedCall = (_delay: number, callback: () => void) => {
    const timer = { callback, remove: vi.fn() }; timers.push(timer); return timer;
  };
  f.scene.tweens.add = (config: typeof tweens[number]) => { tweens.push(config); return { stop() {} }; };
  f.scene.tweens.killTweensOf = vi.fn();
  const effects = new EffectSystem(f.scene, {} as never);
  Object.assign(effects, { texturesGenerated: true });
  const noop = () => {}, system = { destroyAll: noop };
  const coordinator = Object.assign(Object.create(ArenaLifecycleCoordinator.prototype), {
    clearArenaExitPresentation: noop, detachAllWorldPlayers: noop, detachLocalActivityForTeardown: noop,
    cancelPendingHostArenaGeneration: noop, releaseWorldRuntime: noop,
    persistentBasePreviewRenderer: { clear: noop }, placementPreview: { clearForTeardown: noop },
    rockVisualHelper: { destroyAllTurretVisuals: noop },
    renderers: { combatGoreGpu: { fragmentTemplateCache: { clear: noop } } },
    ctx: { effectSystem: effects, smokeSystem: system, fireSystem: system, stinkCloudSystem: system,
      visualFeedback: { reset: noop }, centerHUD: { hideTrainWidget: noop } },
  }) as ArenaLifecycleCoordinator;
  const play = (kind: string) => {
    if (kind === 'train-rpc') {
      const rpc = Object.assign(Object.create(RpcCoordinator.prototype), { effectSystem: effects });
      rpc.registerTrainBurrowSparksHandler();
      bridgeMock.registerTrainBurrowSparksHandler.mock.calls.at(-1)![0](100, 200);
      return;
    }
    const tracker = new EnemyDashVisualTracker(f.scene, effects, { playSound: noop } as never, kind === 'client-dash');
    tracker.sync({ id: 'enemy', sprite: { x: 100, y: 200, rotation: 1 }, getDashPhase: () => 1,
      getTintColor: () => 0xffffff, getImageKey: () => 'badger', getVisualSize: () => 40, setDashScale: noop } as never);
  };
  return { ...f, timers, tweens, effects, play, clear: () => coordinator.tearDownArena() };
}

describe('mobility effects at the actual World teardown', () => {
  it.each(['host-dash', 'client-dash', 'train-rpc'])('releases %s directly on Scene shutdown', kind => {
    const f = fixture(); f.play(kind);
    const destroys = f.cosmetic.map(object => vi.spyOn(object, 'destroy'));
    f.scene.events.emit('shutdown');
    expect(f.cosmetic.every(object => !object.active)).toBe(true);
    expect(f.timers.every(timer => timer.remove.mock.calls.length === 1)).toBe(true);
    f.timers.forEach(timer => timer.callback()); f.tweens.forEach(tween => tween.onComplete?.());
    f.effects.destroy();
    expect(destroys.every(spy => spy.mock.calls.length === 1)).toBe(true);
  });

  it.each(['host-dash', 'client-dash', 'train-rpc'])('releases %s work and ignores retired callbacks', kind => {
    const f = fixture(); f.play(kind);
    const retired = [...f.cosmetic], oldTimers = [...f.timers], oldTweens = [...f.tweens];
    expect(retired.length).toBeGreaterThan(0);
    const destroys = retired.map(object => vi.spyOn(object, 'destroy'));
    f.clear();
    expect(retired.every(object => !object.active)).toBe(true);
    expect(oldTimers.every(timer => timer.remove.mock.calls.length === 1)).toBe(true);
    oldTweens.forEach(tween => expect(f.scene.tweens.killTweensOf).toHaveBeenCalledWith(tween.targets));
    f.clear();
    f.play(kind);
    const current = f.cosmetic.slice(retired.length);
    const currentDestroys = current.map(object => vi.spyOn(object, 'destroy'));
    oldTimers.forEach(timer => timer.callback()); oldTweens.forEach(tween => tween.onComplete?.());
    expect(current.every(object => object.active)).toBe(true);
    f.timers.slice(oldTimers.length).forEach(timer => timer.callback());
    f.tweens.slice(oldTweens.length).forEach(tween => tween.onComplete?.());
    f.clear(); f.effects.destroy();
    expect([...destroys, ...currentDestroys].every(spy => spy.mock.calls.length === 1)).toBe(true);
    expect(f.cosmetic.every(object => !object.active)).toBe(true);
  });
});
