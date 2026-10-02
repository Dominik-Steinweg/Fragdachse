import { it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 } }));
vi.mock('../src/effects/gpu/GpuVfxAtlas', async importOriginal => ({
  ...await importOriginal<object>(), getGpuVfxFrame: () => ({ width: 56 }),
}));
import assert from 'node:assert/strict';
import { TrainVfxController } from '../src/effects/train/TrainVfxController';
import { planTrainDestruction, trainVfxSeed, trainRandom, sampleTrainChunk } from '../src/effects/train/TrainVfxModel';
import { GpuVfxEffectId as Effect } from '../src/effects/gpu/GpuVfxEffects';
import { GpuVfxFrameId as Frame } from '../src/effects/gpu/GpuVfxAtlas';

function fixture(factor = 1) {
  let now = 0, callback: ((delta: number, now: number) => void) | null = null;
  let cleared = 0, released = 0;
  const particles: any[] = [], transforms: any[] = [], camera: any[] = [];
  const gpu = {
    emissionGeneration: 0, isSuppressed: () => false, now: () => now,
    quality: { getEmissionFactor: () => factor },
    createSpec: (effect: number) => ({ effect }), createSource: () => 7,
    registerEmission: (fn: typeof callback) => { callback = fn; return () => { callback = null; }; },
    releaseSource: () => { released++; }, clearSource: () => { cleared++; },
    spawn: (s: any, source: number, time: number, age: number, handle?: any) => {
      particles.push({ ...s, source, at: time - age });
      if (handle) Object.assign(handle, { slot: particles.length, lifeMs: s.lifeMs });
      return true;
    },
    updateTransform: (...args: any[]) => { transforms.push(args); return true; },
  };
  const scene = { cameras: { main: { worldView: { x: -2000, y: -2000, right: 4000, bottom: 4000 } } } };
  const renderer = new TrainVfxController(scene as never, { gpu: gpu as never,
    camera: { request: (request: any) => camera.push(request) } as never, sampleGround: () => 0x345678 });
  return { renderer, particles, transforms, camera, gpu,
    tick: (delta: number) => { now += delta; callback?.(delta, now); },
    cleanup: () => ({ cleared, released, registered: callback !== null }) };
}

it('plans an ordered replicated rupture within the world, deterministically', () => {
  const segments = Array.from({ length: 13 }, (_, i) => ({ x: 64, y: i * 200 - 400 }));
  const a = planTrainDestruction(segments, 0, 1200);
  assert.deepEqual(a, planTrainDestruction(segments, 0, 1200));
  assert.equal(a[0].delayMs, 0); assert.equal(a.filter(p => p.radius >= 140).length, 1);
  assert.equal(new Set(a.map(p => p.y)).size, a.length);
  assert(a.every(p => p.y >= 0 && p.y <= 1200));
  assert(a.slice(1).every((p, i) => p.delayMs > a[i].delayMs));
  assert.deepEqual(planTrainDestruction(segments, 3000, 4000), []);
});

it('seeds match Float32 wire coordinates and do not consume Math.random', () => {
  assert.equal(trainVfxSeed(100.123456789, 20.3, 80), trainVfxSeed(Math.fround(100.123456789), Math.fround(20.3), 80));
  const a = trainRandom(42), b = trainRandom(42);
  for (let i = 0; i < 100; i++) { const n = a(); assert.equal(n, b()); assert(n >= 0 && n < 1); }
});

it('projects height above the XY path and settles at a fixed ground point', () => {
  const path = { x: 10, y: 20, dx: 60, dy: -40, height: 50, flightMs: 800, spin: 4 };
  assert.equal(sampleTrainChunk(path, 0).z, 0);
  assert.equal(sampleTrainChunk(path, 400).z, 50);
  const end = sampleTrainChunk(path, 800);
  assert.equal(end.x, 70); assert.equal(end.y, -20); assert(end.landed);
  assert.deepEqual(end, sampleTrainChunk(path, 5000));
});

it('keeps chunk trajectories and fixed-time trails stable at different frame rates', () => {
  const run = (delta: number) => {
    const f = fixture(); f.renderer.playExplosion(100, 120, 160);
    for (let i = 0; i < 1000 / delta; i++) f.tick(delta);
    return f.particles.filter(p => p.frame === Frame.FlameBillow).map(p => ({ x: p.x, y: p.y, at: p.at, tint: p.tint }));
  };
  assert.deepEqual(run(20), run(40));
});

it('uses terrain-colored motion dust, stays quiet at rest and stops emission when the train disappears', () => {
  const f = fixture(); f.renderer.setPose(50, 100, 1, [100]); f.tick(16);
  for (let i = 0; i < 10; i++) f.tick(16);
  assert.equal(f.particles.length, 0);
  for (let i = 1; i < 15; i++) { f.renderer.setPose(50, 100 + i * 9.6, 1, [100 + i * 9.6]); f.tick(16); }
  assert(f.particles.some(p => p.effect === Effect.TrainDust && p.tint === 0x345678));
  const count = f.particles.length; f.renderer.stopMovement(); f.tick(500);
  assert.equal(f.particles.length, count);
});

it('reduces decorative load on low quality without changing the hero impact', () => {
  const run = (factor: number) => { const f = fixture(factor); f.renderer.playExplosion(100, 120, 160); f.tick(16); return f; };
  const high = run(1), low = run(.25);
  assert(low.particles.length < high.particles.length);
  assert.equal(low.camera.length, high.camera.length);
  assert(low.particles.some(p => p.frame === Frame.ExplosionCore));
});

it('caps event work, ages skipped phases, and releases all world-owned particles and callbacks', () => {
  const f = fixture(); for (let i = 0; i < 1000; i++) f.renderer.playExplosion(100, 120, 160);
  f.tick(16); assert(f.camera.length <= 16);
  const debris = f.particles.filter(p => p.effect === Effect.TrainDebris);
  assert(debris.length <= 64);
  f.tick(10000);
  assert(f.particles.every(p => Number.isFinite(p.x + p.y + p.lifeMs + p.scaleStart)));
  f.renderer.destroy(); f.renderer.destroy();
  assert.deepEqual(f.cleanup(), { cleared: 0, released: 1, registered: false });
  const n = f.particles.length; f.tick(1000); assert.equal(n, f.particles.length);
});

it('discards stale phases and trails when the shared presentation generation changes', () => {
  const f = fixture(); f.renderer.playExplosion(100, 120, 160); f.tick(16);
  f.gpu.emissionGeneration++; const n = f.particles.length; f.tick(500); f.tick(500);
  assert.equal(f.particles.length, n); assert.equal(f.cleanup().cleared, 1);
});
