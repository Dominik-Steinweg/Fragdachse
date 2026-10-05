import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, ADD: 1 },
  Geom: { Line: class {} },
  Math: {
    DegToRad: (x: number) => x * Math.PI / 180,
    RadToDeg: (x: number) => x * 180 / Math.PI,
    Clamp: (x: number, min: number, max: number) => Math.max(min, Math.min(max, x)),
    FloatBetween: (min: number, max: number) => (min + max) / 2,
    Linear: (a: number, b: number, t: number) => a + (b - a) * t,
  },
}));
vi.mock('../src/effects/StaticPolygonGraphics', () => ({
  createStaticPolygonGraphics: (scene: { add: { graphics(): unknown } }) => scene.add.graphics(),
}));
vi.mock('../src/effects/EffectUtils', () => ({
  createEmitter: (scene: { add: { particles(): unknown } }) => scene.add.particles(),
  destroyEmitter: (emitter: { destroy(): void }) => emitter.destroy(),
  killAllAndResetParticlePositions: (emitter: { killAll(): void }) => emitter.killAll(),
  mixColors: (color: number) => color,
  makeAdditive: (object: unknown) => object,
  registerGraphicsObject() {}, recordParticleSpawn() {},
}));

import { AsmdPrimaryRenderer } from '../src/effects/AsmdPrimaryRenderer';
import { BiteRenderer } from '../src/effects/BiteRenderer';
import { resetRenderersForWorldGameplayTeardown } from '../src/scenes/arena/rendererWorldTeardown';

function fixture() {
  const objects: Array<ReturnType<typeof makeObject>> = [];
  function makeObject(pooledEmitter = false) {
    const children: Array<ReturnType<typeof makeObject>> = [];
    const object = {
      active: true, pooledEmitter, liveParticles: 0, x: 0, y: 0, rotation: 0,
      setDepth: () => object, setRotation: () => object, setBlendMode: () => object,
      setTint: () => object, setAlpha: () => object, setDisplaySize: () => object,
      setPosition: () => object, lineStyle: () => object, beginPath: () => object,
      moveTo: () => object, lineTo: () => object, strokePath: () => object,
      lineBetween: () => object, setEmitterAngle: () => object,
      add: (added: typeof children | typeof object) => { children.push(...(Array.isArray(added) ? added : [added])); return object; },
      removeAll: (destroy: boolean) => { if (destroy) children.splice(0).forEach(child => child.destroy()); return object; },
      explode: (count: number) => { object.liveParticles += count; },
      killAll: () => { object.liveParticles = 0; },
      destroy: vi.fn(() => { object.active = false; object.liveParticles = 0; object.removeAll(true); }),
    };
    objects.push(object); return object;
  }
  const tweens: Array<{ targets: unknown; onComplete(): void }> = [];
  const timers: Array<{ callback(): void; remove: ReturnType<typeof vi.fn> }> = [];
  let bite = false;
  const scene = {
    add: {
      image: () => makeObject(), circle: () => makeObject(), graphics: () => makeObject(),
      container: () => makeObject(), particles: () => makeObject(bite),
    },
    tweens: { add: (config: typeof tweens[number]) => { tweens.push(config); }, killTweensOf: vi.fn() },
    time: { delayedCall: (_delay: number, callback: () => void) => {
      const timer = { callback, remove: vi.fn() }; timers.push(timer); return timer;
    } },
  };
  const asmd = new AsmdPrimaryRenderer(scene as never), biteRenderer = new BiteRenderer(scene as never);
  const unused = { clear() {}, destroy() {}, destroyAll() {}, clearAll() {}, clearAllUnderground() {},
    clearUpgrades() {}, clearPending() {}, releaseAll() {} };
  const bundle = Object.fromEntries([
    'translocatorTeleport', 'movement', 'turretAnimations', 'interactions', 'burrowGpu', 'timeBubble',
    'blackHole', 'reinforcementMatrix', 'energyInjector', 'plasmaBurner', 'remoteControl', 'teslaDome',
    'teslaNova', 'teslaBolt', 'zeusTaser', 'healingAura', 'miniTeslaDome', 'energyShield', 'guardianSpirit',
    'repairDrone', 'attackDrone', 'objectiveRepairDrones', 'slimeTrail', 'corpseMarker',
    'flamethrowerUpgrades', 'entityBurnGpu', 'explosionGpu', 'gpuVfx',
  ].map(key => [key, unused]));
  Object.assign(bundle, { asmdPrimary: asmd, bite: biteRenderer });
  const clear = () => resetRenderersForWorldGameplayTeardown(bundle as never);
  return { scene, objects, tweens, timers, clear, play(kind: string) {
    bite = kind.startsWith('bite');
    if (bite) biteRenderer.playSwing(500, 500, 0, 45, 40, 0xffffff, kind === 'bite-hit', 520, 510);
    else asmd.playTracer(500, 500, 650, 510, 0xffffff, 3,
      kind === 'asmd-player' ? 'player' : kind === 'asmd-air' ? 'none' : 'environment');
  } };
}

describe('hitscan effects belong to the ending World', () => {
  it.each(['asmd-air', 'asmd-environment', 'asmd-player', 'bite-air', 'bite-hit'])(
    'releases %s transients while retaining reusable particle pools', kind => {
      const f = fixture();
      f.play(kind);
      const retired = f.objects.filter(object => !object.pooledEmitter);
      const retiredTweens = [...f.tweens], retiredTimers = [...f.timers];
      expect(retired.length).toBeGreaterThan(0);
      f.clear();
      expect(retired.every(object => !object.active)).toBe(true);
      expect(f.objects.every(object => object.liveParticles === 0)).toBe(true);
      expect(retiredTimers.every(timer => timer.remove.mock.calls.length === 1)).toBe(true);
      retiredTweens.forEach(tween => {
        for (const target of Array.isArray(tween.targets) ? tween.targets : [tween.targets]) {
          expect(f.scene.tweens.killTweensOf).toHaveBeenCalledWith(target);
        }
      });
      f.clear();
      expect(retired.every(object => object.destroy.mock.calls.length === 1)).toBe(true);
      expect(f.objects.filter(object => object.pooledEmitter).every(object => object.active)).toBe(true);

      const previousCount = f.objects.length;
      f.play(kind);
      retiredTweens.forEach(tween => tween.onComplete());
      retiredTimers.forEach(timer => timer.callback());
      expect(f.objects.slice(previousCount).every(object => object.active)).toBe(true);
      f.tweens.slice(retiredTweens.length).forEach(tween => tween.onComplete());
      f.timers.slice(retiredTimers.length).forEach(timer => timer.callback());
      f.clear();
      expect(f.objects.filter(object => !object.pooledEmitter).every(object => object.destroy.mock.calls.length === 1)).toBe(true);
    },
  );
});
