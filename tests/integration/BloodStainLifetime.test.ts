import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import * as Phaser from 'phaser';

vi.mock('phaser', async () => {
  const phaser = (await import('../fakeArenaRenderScene')).createFakePhaserModule();
  return { ...phaser, CANVAS: 1, WEBGL: 2, Math: { ...phaser.Math, DegToRad: (value: number) => value * Math.PI / 180 }, Scene: class {}, GameObjects: { ...phaser.GameObjects, Events: { DESTROY: 'destroy' } },
    Filters: { Displacement: class {}, ParallelFilters: class {} },
    Scenes: { Events: { POST_UPDATE: 'postupdate', SHUTDOWN: 'shutdown', PRE_RENDER: 'prerender' } } };
});
const bridgeMock = vi.hoisted(() => ({
  isHost: () => false,
  publishCoopDefenseSecondaryObjectivePresentationState() {},
  publishCoopDefenseMissionProgressPresentationState() {}, publishCoopDefensePortalLinkState() {}, publishCoopDefenseMapEventPresentationState() {},
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
import { BloodFieldSystem } from '../../src/effects/blood/BloodFieldSystem';
import { BLOOD_HIT_VFX } from '../../src/config';
// This headless lifecycle fixture does not create GPU programs.
vi.mock('../../src/effects/kraken/KrakenShaderWarmup', () => ({
  warmupKrakenShaders: () => Object.assign(() => {}, { isReady: () => true }),
}));
import { ArenaLifecycleCoordinator } from '../../src/scenes/arena/ArenaLifecycleCoordinator';

import { healthBarTestScene } from '../healthBarTestScene';

/** `field`: the scene's WebGL blood field; without it rage bursts take the Canvas fallback stains. */
function fixture(field = true) {
  const f = healthBarTestScene();
  f.scene.sys = { renderer: { type: Phaser.CANVAS } };
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
  const blood = field ? new BloodFieldSystem(f.scene) : null;
  effects.setBloodField(blood);
  const play = () => effects.playLocalHitEffect({ type: 'hit', x: 100, y: 120,
    targetId: 'enemy-1', totalDamage: 52, hpLost: 52, armorLost: 0,
    isKill: true, isCritical: false, dirX: 1, dirY: 0, seed: 42 });
  /** Advances the scene clock and runs one presentation update of the blood field. */
  const advance = (ms: number) => { f.scene.time.now += ms; f.scene.events.emit('postupdate'); };
  return { ...f, timers, tweens, effects, play, advance, blood, coordinator, clear: () => coordinator.tearDownArena() };
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

describe('blood lifetime across Worlds', () => {
  it('keeps natural rage arrivals and shared blood fading intact', () => {
    const f = fixture(false); spawnRage(f);
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
  it('keeps another Scene intact and lets the next World start a fresh field', () => {
    const f = fixture(), other = fixture();
    other.play();
    const otherMarks = other.blood!.model.count;
    expect(otherMarks).toBeGreaterThan(0);
    f.play();
    expect(f.blood!.model.count).toBeGreaterThan(0);
    f.clear(); f.clear();
    expect(f.blood!.model.count).toBe(0);
    expect(other.blood!.model.count).toBe(otherMarks);
    f.play();
    expect(f.blood!.model.count).toBeGreaterThan(0);
    f.clear();
    expect(other.blood!.model.count).toBe(otherMarks);
  });
  it('releases the field on Scene shutdown', () => {
    const f = fixture(); f.play();
    expect(f.blood!.model.count).toBeGreaterThan(0);
    f.scene.events.emit('shutdown');
    expect(f.blood!.model.count).toBe(0);
    expect(BloodFieldSystem.for(f.scene)).toBeNull();
    f.effects.destroy();
  });
  it('lets a rage burst pour into the field instead of Canvas stains', () => {
    const f = fixture();
    spawnRage(f);
    const count = f.cosmetic.length;
    f.tweens.forEach(tween => tween.onComplete?.());
    expect(f.cosmetic.length).toBeLessThanOrEqual(count);
    expect(f.blood!.model.count).toBeGreaterThan(0);
    f.clear();
    expect(f.blood!.model.count).toBe(0);
  });
  it('prevents a retired rage-player tween from materializing new stains after World teardown', () => {
    const f = fixture(false);
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
  it('drops blood still in flight with the World it was shed in', () => {
    const f = fixture(); f.play();
    expect(f.blood!.model.count).toBeGreaterThan(0);
    f.clear();
    f.advance(500);
    expect(f.blood!.model.count).toBe(0);
  });
  it('lets every mark run out after its lifetime', () => {
    const f = fixture(); f.play();
    f.advance(100);
    expect(f.blood!.model.count).toBeGreaterThan(0);
    f.advance(BLOOD_HIT_VFX.field.maxLifeMs + 1_000);
    expect(f.blood!.model.count).toBe(0);
    f.clear();
  });
});
