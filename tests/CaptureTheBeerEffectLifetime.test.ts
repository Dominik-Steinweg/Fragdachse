import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, ADD: 1 },
  Scenes: { Events: { SHUTDOWN: 'shutdown' } },
  Geom: { Circle: class {} },
  Math: {
    Clamp: (x: number, min: number, max: number) => Math.max(min, Math.min(max, x)),
    FloatBetween: (min: number, max: number) => (min + max) / 2,
    Between: (min: number, max: number) => Math.round((min + max) / 2),
    Linear: (a: number, b: number, t: number) => a + (b - a) * t,
  },
}));
vi.mock('../src/effects/EffectUtils', () => ({
  createEmitter: (scene: { add: { particles(): unknown } }) => scene.add.particles(),
  destroyEmitter: (emitter: { destroy(): void }) => emitter.destroy(),
  configureAdditiveImage: (object: unknown) => object,
  mixColors: (color: number) => color,
  makeAdditive: (object: unknown) => object,
  registerGraphicsObject() {}, setCircleEmitZone() {},
}));

import { CaptureTheBeerRenderer } from '../src/effects/CaptureTheBeerRenderer';
import { resetRenderersForWorldPresentationTeardown } from '../src/scenes/arena/rendererWorldTeardown';

function fixture() {
  const objects: Array<ReturnType<typeof makeObject>> = [];
  function makeObject() {
    const children: Array<ReturnType<typeof makeObject>> = [];
    const object = {
      active: true, liveParticles: 0, x: 0, y: 0, scale: 1,
      setDepth: () => object, setRotation: () => object, setBlendMode: () => object,
      setTint: () => object, setAlpha: () => object, setScale: () => object,
      setPosition: () => object, setAngle: () => object, setScrollFactor: () => object,
      setStrokeStyle: () => object, setFillStyle: () => object, setParticleScale: () => object,
      clear: () => object, lineStyle: () => object, fillStyle: () => object,
      fillCircle: () => object, strokeCircle: () => object, fillEllipse: () => object,
      strokeEllipse: () => object, addEmitZone: () => object,
      add: (added: typeof children) => { children.push(...added); return object; },
      explode: (count: number) => { object.liveParticles += count; },
      destroy: vi.fn(() => { object.active = false; object.liveParticles = 0; children.splice(0).forEach(child => child.destroy()); }),
    };
    objects.push(object); return object;
  }
  const tweens: Array<{ targets: unknown; onComplete(): void }> = [];
  const timers: Array<{ callback(): void; remove: ReturnType<typeof vi.fn> }> = [];
  const scene = {
    events: { once() {} },
    cameras: { main: { flash() {} } },
    add: {
      image: makeObject, circle: makeObject, rectangle: makeObject,
      graphics: makeObject, container: makeObject, particles: makeObject,
    },
    tweens: { add: (config: typeof tweens[number]) => { tweens.push(config); }, killTweensOf: vi.fn() },
    time: { now: 1_000, delayedCall: (_delay: number, callback: () => void) => {
      const timer = { callback, remove: vi.fn() }; timers.push(timer); return timer;
    } },
  };
  const beer = new CaptureTheBeerRenderer(scene as never);
  const unused = { clear() {}, clearDynamicShadows() {}, setTerrainColorSnapshot() {}, setActive() {} };
  const bundle = Object.fromEntries([
    'powerUp', 'nuke', 'airstrike', 'encounterTelegraph', 'bossIntro', 'bossPresence', 'voidHunterSparks', 'voidRift', 'meteor', 'rockDestruction', 'carryZones',
    'leafBlower', 'movement', 'burrowGpu', 'shadow', 'lighting',
  ].map(key => [key, unused]));
  Object.assign(bundle, { beer });
  const clear = () => resetRenderersForWorldPresentationTeardown(bundle as never, false);
  return { scene, objects, tweens, timers, clear, play(kind: string) {
    if (kind === 'carry-delivered') beer.playCoopDefenseCarryDeliveredFx(500, 500);
    else if (kind === 'carried-trail') {
      beer.syncCoopDefenseCarry([{ id: 'carry-1', objectiveId: 'objective-1', x: 500, y: 500, holderId: 'player-1', state: 'carried' }]);
      beer.update(1_000, 16);
    } else if (kind === 'reset') beer.playFx({ kind, beerTeamId: 'blue', sourceX: 500, sourceY: 500, targetX: 600, targetY: 600 });
    else if (kind === 'score') beer.playFx({ kind, beerTeamId: 'blue', scoreTeamId: 'red', scorerName: 'Dachs', scorerColor: 0xff0000, x: 500, y: 500 });
    else beer.playFx({ kind: 'drop', beerTeamId: 'blue', x: 500, y: 500 });
  } };
}

describe('capture objective effects belong to the ending World', () => {
  it.each(['drop', 'score', 'reset', 'carry-delivered', 'carried-trail'])(
    'releases %s objects, tweens and emitter timers through the presentation owner', kind => {
      const f = fixture();
      f.play(kind);
      const retired = [...f.objects], retiredTweens = [...f.tweens], retiredTimers = [...f.timers];
      expect(retired.length).toBeGreaterThan(0);
      expect(retiredTweens.length).toBeGreaterThan(0);
      if (kind !== 'carried-trail') expect(retiredTimers.length).toBeGreaterThan(0);
      f.clear();
      expect(retired.every(object => !object.active)).toBe(true);
      expect(retired.every(object => object.liveParticles === 0)).toBe(true);
      expect(retiredTimers.every(timer => timer.remove.mock.calls.length === 1)).toBe(true);
      retiredTweens.forEach(tween => expect(f.scene.tweens.killTweensOf).toHaveBeenCalledWith(tween.targets));
      f.clear();
      expect(retired.every(object => object.destroy.mock.calls.length === 1)).toBe(true);

      const previousCount = f.objects.length;
      f.play(kind);
      retiredTweens.forEach(tween => tween.onComplete());
      retiredTimers.forEach(timer => timer.callback());
      expect(f.objects.slice(previousCount).every(object => object.active)).toBe(true);
      f.tweens.slice(retiredTweens.length).forEach(tween => tween.onComplete());
      f.timers.slice(retiredTimers.length).forEach(timer => timer.callback());
      for (const tween of f.tweens.slice(retiredTweens.length)) {
        expect((tween.targets as { active: boolean }).active).toBe(false);
      }
      if (kind !== 'carried-trail') expect(f.objects.slice(previousCount).every(object => !object.active)).toBe(true);
      else expect(f.objects.slice(previousCount).some(object => object.active)).toBe(true);
      f.clear();
      expect(f.objects.every(object => object.destroy.mock.calls.length === 1)).toBe(true);
    },
  );
});
