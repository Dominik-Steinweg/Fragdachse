import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => {
  const phaser = (await import('../fakeArenaRenderScene')).createFakePhaserModule();
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url), root = require.resolve('phaser/package.json').replace(/package\.json$/, '');
  return { ...phaser, Scene: class {}, Filters: { Displacement: class {}, ParallelFilters: class {} },
    Geom: { ...phaser.Geom, Line: require(root + 'src/geom/line/Line.js'),
      Rectangle: require(root + 'src/geom/rectangle/Rectangle.js') } };
});
const bridgeMock = vi.hoisted(() => ({
  isHost: () => true, getSynchronizedNow: () => 1000, isArenaCountdownActive: () => false,
  getActivityDescriptor: () => null, getActiveGameMode: () => 'coop_defense',
  getConnectedPlayers: () => [], getLocalPlayerId: () => 'headless',
  getPlayerHeldItemId: () => null, getPlayerInput: () => null, flushEffects() {},
  publishCoopDefenseSecondaryObjectivePresentationState() {},
  publishCoopDefenseMissionProgressPresentationState() {}, publishCoopDefenseMapEventPresentationState() {},
}));
vi.mock('../../src/network/bridge', () => ({ bridge: bridgeMock }));
vi.mock('../../src/scenes/arena/rendererWorldTeardown', () => ({
  resetRenderersForWorldGameplayTeardown() {}, resetRenderersForWorldPresentationTeardown() {},
}));

import { EffectSystem } from '../../src/effects/EffectSystem';
import { HostUpdateCoordinator } from '../../src/scenes/arena/HostUpdateCoordinator';
import { WorldCombatCore } from '../../src/combat/WorldCombatCore';
import { ArenaLifecycleCoordinator } from '../../src/scenes/arena/ArenaLifecycleCoordinator';

import { healthBarTestScene } from '../healthBarTestScene';

function fixture() {
  const f = healthBarTestScene();
  f.scene.events = new EventEmitter();
  const timers: Array<{ callback(): void; remove: ReturnType<typeof vi.fn> }> = [];
  const tweens: Array<{ targets: unknown; onComplete?: () => void }> = [];
  const particles = f.scene.add.particles;
  f.scene.add.particles = (...args: unknown[]) => Object.assign(particles(...args), { explode() {}, addEmitZone() {} });
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
  const player: any = { id: 'p1', x: 100, y: 200, active: true, color: 0xffffff,
    body: { velocity: { x: 0, y: 0 } } };
  for (const name of ['updateHP', 'updateArmor', 'updateBurnStacks', 'setVisible', 'setTurretMounted',
    'setWalking', 'setRageTint', 'setDecoyStealth', 'setHeldItemId', 'syncBar', 'setMovementDashPhase', 'setBurrowPhase']) player[name] = noop;
  const players = { getPlayer: (id: string) => id === 'p1' ? player : undefined, getAllPlayers: () => [player] };
  const combat = new WorldCombatCore(players as never, { isHost: () => true, getPlayerProfile: players.getPlayer,
    areTeammates: () => false, getLocalPlayerId: () => 'p1', isEnemyPair: () => true } as never);
  combat.bindPlayerVitalsScope({ worldRevision: 71, runtimeGeneration: 1 });
  combat.bindHostExecutionSources({ nowMs: () => 1000, random: () => 0 });
  combat.initPlayer('p1');
  let stealthed = false;
  const host = new HostUpdateCoordinator(f.scene, {
    getWorldCombatCore: () => combat, playerManager: players, effectSystem: effects,
    gameAudioSystem: { playSound: noop },
    fireSystem: { hostUpdate: () => ({ synced: [], ground: { cells: [] }, damageEvents: [], damageTick: false }) },
    stinkCloudSystem: { hostUpdate: () => ({ synced: [], damageEvents: [] }), syncPlagueVisuals: noop, clientUpdate: noop },
    decoySystem: { hostUpdateLifecycle: noop, hostPostPhysics: noop, createHostSnapshots: () => [], isStealthed: () => stealthed },
    hostPhysics: { update: noop, getDashPhase: () => 0, isBurrowDash: () => false },
    smokeSystem: { syncVisuals: noop, syncTargetVisuals: noop },
  } as never, null as never, {} as never, {} as never);
  host.setWorldFramePort({ getWorldRuntime: () => ({ context: { descriptor: { definitionId: 'world:lobby' } } }),
    getWorldMutationRuntime: () => null, getTrainRuntime: () => null } as never);
  const play = () => {
    host.runHostUpdate(0);
    stealthed = !stealthed;
    host.runHostUpdate(0);
  };
  return { ...f, timers, tweens, effects, play, clear: () => coordinator.tearDownArena() };
}

describe('stealth effects at the actual Host and World teardown', () => {
  it('releases both real stealth edges naturally before World cleanup', () => {
    const f = fixture();
    for (let edge = 0; edge < 2; edge++) {
      const before = new Set([...f.cosmetic, ...f.rectangles]);
      const timerCount = f.timers.length, tweenCount = f.tweens.length;
      f.play();
      const objects = [...f.cosmetic, ...f.rectangles].filter(object => !before.has(object));
      expect(objects.length).toBeGreaterThan(0);
      const destroys = objects.map(object => vi.spyOn(object, 'destroy'));
      f.timers.slice(timerCount).forEach(timer => timer.callback());
      f.tweens.slice(tweenCount).forEach(tween => tween.onComplete?.());
      expect(objects.every(object => !object.active)).toBe(true);
      f.clear();
      expect(destroys.every(spy => spy.mock.calls.length === 1)).toBe(true);
    }
  });
  it('releases stealth transitions directly on Scene shutdown', () => {
    const f = fixture(); f.play();
    const destroys = [...f.cosmetic, ...f.rectangles].map(object => vi.spyOn(object, 'destroy'));
    f.scene.events.emit('shutdown');
    expect([...f.cosmetic, ...f.rectangles].every(object => !object.active)).toBe(true);
    expect(f.timers.every(timer => timer.remove.mock.calls.length === 1)).toBe(true);
    f.timers.forEach(timer => timer.callback()); f.tweens.forEach(tween => tween.onComplete?.());
    f.effects.destroy();
    expect(destroys.every(spy => spy.mock.calls.length === 1)).toBe(true);
  });

  it('releases stealth transitions and ignores retired callbacks', () => {
    const f = fixture(); f.play();
    const retired = [...f.cosmetic, ...f.rectangles], oldTimers = [...f.timers], oldTweens = [...f.tweens];
    expect(retired.length).toBeGreaterThan(0);
    const destroys = retired.map(object => vi.spyOn(object, 'destroy'));
    f.clear();
    expect(retired.every(object => !object.active)).toBe(true);
    expect(oldTimers.every(timer => timer.remove.mock.calls.length === 1)).toBe(true);
    oldTweens.forEach(tween => expect(f.scene.tweens.killTweensOf).toHaveBeenCalledWith(tween.targets));
    f.clear();
    f.play();
    const current = [...f.cosmetic, ...f.rectangles].filter(object => !retired.includes(object));
    const currentDestroys = current.map(object => vi.spyOn(object, 'destroy'));
    oldTimers.forEach(timer => timer.callback()); oldTweens.forEach(tween => tween.onComplete?.());
    expect(current.every(object => object.active)).toBe(true);
    f.timers.slice(oldTimers.length).forEach(timer => timer.callback());
    f.tweens.slice(oldTweens.length).forEach(tween => tween.onComplete?.());
    f.clear(); f.effects.destroy();
    expect([...destroys, ...currentDestroys].every(spy => spy.mock.calls.length === 1)).toBe(true);
    expect([...f.cosmetic, ...f.rectangles].every(object => !object.active)).toBe(true);
  });
});




