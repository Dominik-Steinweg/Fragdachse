import { it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 } }));
vi.mock('../src/effects/gpu/GpuVfxAtlas', async importOriginal => ({
  ...await importOriginal<object>(), getGpuVfxFrame: () => ({ width: 56 }),
}));
import assert from 'node:assert/strict';
import { TrainVfxController } from '../src/effects/train/TrainVfxController';
import { planTrainDestruction, trainVfxSeed, trainRandom } from '../src/effects/train/TrainVfxModel';
import { GpuVfxEffectId as Effect } from '../src/effects/gpu/GpuVfxEffects';
import { GpuVfxFrameId as Frame } from '../src/effects/gpu/GpuVfxAtlas';

function fixture(factor = 1) {
  let now = 0, callback: ((delta: number, now: number) => void) | null = null;
  let cleared = 0, released = 0;
  const particles: any[] = [], transforms: any[] = [], camera: any[] = [], retired: any[] = [];
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
    releaseMember: (h: any) => retired.push(h),
    updateTransform: (...args: any[]) => { transforms.push(args); return true; },
  };
  const scene = { cameras: { main: { width: 6000, height: 6000, originX: 0, originY: 0, zoom: 1, scrollX: -2000, scrollY: -2000, worldView: { x: -2000, y: -2000, right: 4000, bottom: 4000 } } } };
  const renderer = new TrainVfxController(scene as never, { gpu: gpu as never,
    camera: { request: (request: any) => camera.push(request) } as never, sampleGround: () => 0x345678 });
  return { renderer, particles, transforms, camera, gpu, scene, retired,
    tick: (delta: number) => { now += delta; callback?.(delta, now); },
    cleanup: () => ({ cleared, released, registered: callback !== null }) };
}

it('plans an ordered replicated rupture across every carriage, anchored in the visible world, deterministically', () => {
  const segments = Array.from({ length: 13 }, (_, i) => ({ x: 64, y: i * 200 - 400 }));
  const a = planTrainDestruction(segments, 0, 1200);
  assert.deepEqual(a, planTrainDestruction(segments, 0, 1200));
  assert.equal(a[0].delayMs, 0); assert.equal(a.filter(p => p.radius >= 140).length, 1);
  assert.equal(new Set(a.map(p => p.y)).size, a.length);
  assert.equal(a.length, segments.length); assert(a[0].y >= 0 && a[0].y <= 1200);
  assert(a.slice(1).every((p, i) => p.delayMs > a[i].delayMs));
  assert.deepEqual(planTrainDestruction(segments, 3000, 4000), []);
});

it('seeds match Float32 wire coordinates and do not consume Math.random', () => {
  assert.equal(trainVfxSeed(100.123456789, 20.3, 80), trainVfxSeed(Math.fround(100.123456789), Math.fround(20.3), 80));
  const a = trainRandom(42), b = trainRandom(42);
  for (let i = 0; i < 100; i++) { const n = a(); assert.equal(n, b()); assert(n >= 0 && n < 1); }
});

it('leaves burning wreckage to the shared fireball and host ground fire: no free flames in the smoke', () => {
  const f = fixture(); f.renderer.playExplosion(100, 120, 160);
  for (let i = 0; i < 800; i++) f.tick(16);
  const flames = new Set<number>([Frame.FlameTongue, Frame.GroundFireSurfaceB, Frame.GroundFireSurfaceC, Frame.ExplosionCore]);
  assert(!f.particles.some(p => flames.has(p.frame)));
  assert(f.particles.some(p => p.effect === Effect.TrainSmoke && p.at >= 4000));
  f.renderer.destroy();
});

it('uses terrain-colored motion dust, stays quiet at rest and stops emission when the train disappears', () => {
  const f = fixture(); f.renderer.setPose(50, 100, 1, [100]); f.tick(16);
  for (let i = 0; i < 10; i++) f.tick(16);
  assert.equal(f.particles.length, 0);
  for (let i = 1; i < 15; i++) { f.renderer.setPose(50, 100 + i * 9.6, 1, [100 + i * 9.6]); f.tick(16); }
  assert(f.particles.some(p => p.effect === Effect.TrainDust && p.tint !== 0xffffff && (p.tint & 255) > (p.tint >>> 16)));
  const count = f.particles.length; f.renderer.stopMovement(); f.tick(500);
  assert.equal(f.particles.length, count);
});

it('reduces decorative load on low quality without changing the hero impact', () => {
  const run = (factor: number) => { const f = fixture(factor); f.renderer.playExplosion(100, 120, 160); f.tick(16); return f; };
  const high = run(1), low = run(.25);
  assert(low.particles.length < high.particles.length);
  assert.equal(low.camera.length, high.camera.length);
  assert(low.particles.some(p => p.frame === Frame.ExplosionRing));
});

it('caps event work, ages skipped phases, and releases all world-owned particles and callbacks', () => {
  const f = fixture(); for (let i = 0; i < 1000; i++) f.renderer.playExplosion(100, 120, 160);
  f.tick(16); assert(f.camera.length <= 16);
  const debris = f.particles.filter(p => p.effect === Effect.TrainDebris);
  assert(debris.length <= 16 * 12);
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

it('emits slow train dust in the actual origin-zero viewport, even with stale worldView', () => {
  const f = fixture();
  Object.assign(f.scene.cameras.main, { width: 1920, height: 1080, zoom: .3, scrollX: 6000, scrollY: -900 });
  f.renderer.setPose(9504, 500, -1, [500, 750, 1000]); f.tick(100);
  for (let i = 1; i <= 20; i++) {
    f.renderer.setPose(9504, 500 - i * 6, -1, [500 - i * 6, 750 - i * 6, 1000 - i * 6]); f.tick(100);
  }
  assert(f.particles.some(p => p.effect === Effect.TrainDust));
  f.renderer.destroy();
});

import { TrainRenderer } from '../src/train/TrainRenderer';
it('bounds keyed fire lights and releases them on generation changes and teardown', () => {
 const f=fixture(); const live=new Map<string, unknown>(); let peak=0;
 const light={setLight:(key:string,...args:unknown[])=>{live.set(key,args);peak=Math.max(peak,live.size);},releaseLight:(key:string)=>live.delete(key)};
 f.renderer.setLighting(light as never);
 for(let i=0;i<30;i++)f.renderer.playExplosion(100+i,120+i,160);
 for(let i=0;i<60;i++)f.tick(16);
 assert(peak<=12);assert(live.size>0);
 f.gpu.emissionGeneration++;f.tick(16);assert.equal(live.size,0);
 f.renderer.playExplosion(100,120,160);f.tick(16);assert(live.size>0);
 f.renderer.destroy();assert.equal(live.size,0);
});
it('continues material smoke beyond ten seconds and has no white birth tint on dust',()=>{
 const f=fixture();f.renderer.playExplosion(100,120,160);
 for(let i=0;i<750;i++)f.tick(16);
 assert(f.particles.some(p=>p.effect===Effect.TrainSmoke&&p.at>=10000));
 assert(f.particles.filter(p=>p.effect===Effect.TrainDust).every(p=>p.tintBlendStart===1));
 f.renderer.destroy();
});

it('derives flicker identities from the replicated blast rather than a peer clock', () => {
  const keys = (offset: number) => {
    const f = fixture(), result: string[] = [];
    f.renderer.setLighting({ setLight: key => { result.push(key); }, releaseLight: () => {} });
    f.tick(offset); f.renderer.playExplosion(100, 120, 160); f.tick(16);
    f.renderer.destroy(); return result.sort();
  };
  assert.deepEqual(keys(0), keys(100000));
});

it('covers every segment synchronously on High and Low, exactly once per destruction', () => {
  for (const factor of [1, .25]) {
    const f = fixture(factor), ys = [100, 360, 620];
    f.renderer.disintegrate(50, ys);
    for (const y of ys) assert(f.particles.some(p => p.effect === Effect.TrainHeat && Math.abs(p.y - y) < 30));
    assert(f.particles.filter(p => p.frame === Frame.ExplosionCore).every(p => p.at === 0));
    const count = f.particles.length; f.renderer.disintegrate(50, ys); assert.equal(f.particles.length, count);
    f.renderer.resetDestruction(); f.renderer.disintegrate(50, ys); assert(f.particles.length > count);
    f.renderer.destroy();
  }
});
it('immediately hides the complete train and never restores it from a stale alive snapshot', () => {
  const f: any = Object.create(TrainRenderer.prototype); let visible = true, starts = 0;
  Object.assign(f, {image:{setVisible:(v:boolean)=>{visible=v;}},lastAlive:true,lastX:50,displayY:100,lastDir:1,
    vfx:{disintegrate:()=>starts++,playExplosion:()=>{},stopMovement:()=>{},resetDestruction:()=>{}},
    audioSystem:null,moveLoopHandle:null});
  f.playExplosion(50,100,160); assert.equal(visible,false); assert.equal(starts,1);
  f.setTarget({alive:true,x:50,y:100,dir:1,hp:100,maxHp:100}); f.render(.5);
  assert.equal(visible,false); assert.equal(f.getShadowState(),null);
  f.setTarget(null); assert.equal(visible,false);
  f.setTarget({alive:true,x:50,y:100,dir:1,hp:100,maxHp:100}); assert.equal(f.destructionShown,false);
});
