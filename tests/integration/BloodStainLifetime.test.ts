import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => {
  const phaser = (await import('../fakeArenaRenderScene')).createFakePhaserModule();
  return { ...phaser, Math: { ...phaser.Math, DegToRad: (value: number) => value * Math.PI / 180 }, Scene: class {}, GameObjects: { ...phaser.GameObjects, Events: { DESTROY: 'destroy' } },
    Filters: { Displacement: class {}, ParallelFilters: class {} } };
});
const bridgeMock = vi.hoisted(() => ({
  isHost: () => false,
  publishCoopDefenseSecondaryObjectivePresentationState() {},
  publishCoopDefenseMissionProgressPresentationState() {}, publishCoopDefenseMapEventPresentationState() {},
}));
vi.mock('../../src/network/bridge', () => ({ bridge: bridgeMock }));
vi.mock('../../src/scenes/arena/rendererWorldTeardown', () => ({
  resetRenderersForWorldGameplayTeardown() {}, resetRenderersForWorldPresentationTeardown() {},
}));

import { EffectSystem } from '../../src/effects/EffectSystem';
import { CombatGoreGpuRenderer } from '../../src/effects/CombatGoreGpuRenderer';
import { HoneyBadgerRageRenderer } from '../../src/effects/HoneyBadgerRageRenderer';
import { PlayerEntity } from '../../src/entities/PlayerEntity';
import { ULTIMATE_CONFIGS } from '../../src/loadout/LoadoutConfig';
import { ArenaLifecycleCoordinator } from '../../src/scenes/arena/ArenaLifecycleCoordinator';

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
  const gore = new CombatGoreGpuRenderer(f.scene);
  gore.registerGpuVfx({ createSpec: () => ({}), now: () => 1000, spawn: noop,
    quality: { scaleBurst: (_id: number, count: number) => count } } as never);
  effects.setCombatGoreGpuRenderer(gore);
  const play = () => effects.playLocalHitEffect({ type: 'hit', x: 100, y: 120,
    targetId: 'enemy-1', totalDamage: 52, hpLost: 52, armorLost: 0,
    isKill: true, isCritical: false, dirX: 1, dirY: 0, seed: 42 });
  return { ...f, timers, tweens, effects, play, coordinator, clear: () => coordinator.tearDownArena() };
}

function spawnRage(f: ReturnType<typeof fixture>) {
  f.scene.textures.exists = () => true;
  const particles = f.scene.add.particles;
  f.scene.add.particles = (...args: unknown[]) => Object.assign(particles(...args), {
    clearEmitZones() {}, addEmitZone() {}, setParticleScale() {},
  });
  const sprite = f.scene.add.image(100, 200, 'badger');
  const rage = new HoneyBadgerRageRenderer(f.scene, sprite, null);
  const owner = Object.assign(Object.create(PlayerEntity.prototype), { sprite, rageRenderer: rage,
    stopBurrowTween() {}, stopSpawnShine() {}, runtime: { destroy() {} } });
  Object.assign(f.coordinator, { detachAllWorldPlayers: () => owner.destroy() });
  rage.sync(100, 200, 40, true);
  f.scene.time.now += (ULTIMATE_CONFIGS.HONEY_BADGER_RAGE as any).aura.tickIntervalMs;
  rage.sync(100, 200, 40, true);
  return rage;
}

describe('blood stain lifetime across Worlds', () => {
  it('keeps natural rage arrivals and shared blood fading intact', () => {
    const f = fixture(); spawnRage(f);
    const count = f.cosmetic.length, arrivals = [...f.tweens];
    expect(arrivals.length).toBeGreaterThan(0);
    arrivals.forEach(tween => tween.onComplete?.());
    const stains = f.cosmetic.slice(count);
    expect(stains.length).toBeGreaterThan(0);
    expect(stains.every(object => object.active)).toBe(true);
    f.tweens.slice(arrivals.length).forEach(tween => tween.onComplete?.());
    expect(stains.every(object => !object.active)).toBe(true);
    f.clear();
  });
  it('keeps another Scene intact and lets the next World create fresh stains', () => {
    const f = fixture(), other = fixture();
    other.play(); other.timers.forEach(timer => timer.callback());
    expect(other.cosmetic.length).toBeGreaterThan(0);
    f.play();
    const retired = [...f.timers];
    f.clear(); f.clear();
    f.play();
    retired.forEach(timer => timer.callback());
    expect(f.cosmetic).toHaveLength(0);
    expect(other.cosmetic.every(object => object.active)).toBe(true);
    f.timers.slice(retired.length).forEach(timer => timer.callback());
    expect(f.cosmetic.length).toBeGreaterThan(0);
    f.clear();
    expect(f.cosmetic.every(object => !object.active)).toBe(true);
    expect(other.cosmetic.every(object => object.active)).toBe(true);
    other.tweens.forEach(tween => tween.onComplete?.());
    expect(other.cosmetic.every(object => !object.active)).toBe(true);
  });
  it('cancels Scene-shutdown arrivals before stale callbacks run', () => {
    const f = fixture(); f.play();
    expect(f.timers.length).toBeGreaterThan(0);
    f.scene.events.emit('shutdown');
    f.timers.forEach(timer => timer.callback());
    expect(f.cosmetic).toHaveLength(0);
    f.effects.destroy();
  });
  it('prevents a retired rage-player tween from materializing new stains after World teardown', () => {
    const f = fixture();
    const rage = spawnRage(f);
    expect(f.tweens.length).toBeGreaterThan(0);
    const retired = [...f.tweens], count = f.cosmetic.length;
    f.clear();
    retired.forEach(tween => tween.onComplete?.());
    expect(f.cosmetic).toHaveLength(count);
    rage.destroy();
    const next = spawnRage(f), current = f.cosmetic.slice(count);
    retired.forEach(tween => tween.onComplete?.());
    expect(current.every(object => object.active)).toBe(true);
    f.clear(); next.destroy();
  });
  it('cancels a pending real gore arrival before it can spawn in the next World', () => {
    const f = fixture(); f.play();
    expect(f.timers.length).toBeGreaterThan(0);
    expect(f.cosmetic).toHaveLength(0);
    const retired = [...f.timers];
    f.clear();
    retired.forEach(timer => timer.callback());
    try { expect(f.cosmetic).toHaveLength(0); }
    finally { f.cosmetic.forEach(object => object.destroy()); }
  });
  it('releases already materialized blood stains during World teardown', () => {
    const f = fixture(); f.play();
    f.timers.forEach(timer => timer.callback());
    expect(f.cosmetic.length).toBeGreaterThan(0);
    f.clear();
    try { expect(f.cosmetic.every(object => !object.active)).toBe(true); }
    finally { f.cosmetic.forEach(object => object.destroy()); }
  });
  it('keeps the normal arrival and fade path', () => {
    const f = fixture(); f.play();
    f.timers.forEach(timer => timer.callback());
    expect(f.cosmetic.length).toBeGreaterThan(0);
    f.tweens.forEach(tween => tween.onComplete?.());
    expect(f.cosmetic.every(object => !object.active)).toBe(true);
    f.clear();
  });
});
