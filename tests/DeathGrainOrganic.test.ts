import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 }, Math: {
  Clamp: (v:number,a:number,b:number)=>Math.max(a,Math.min(b,v)), Linear:(a:number,b:number,t:number)=>a+(b-a)*t,
} }));
import { createDeathGrainLayout } from '../src/effects/gpu/DeathGrainMaterial';
import { createDeathGrainBaker } from '../src/effects/gpu/DeathMorphFrames';
import { DEATH_TUNING_DEFAULTS as T, resolveDeathTuning } from '../src/effects/gpu/DeathTuning';
import { GPU_VFX_ATLAS, GPU_VFX_DEATH_MORPH_VARIANT_FRAME_IDS, packGpuVfxAtlas, resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { makeFakeGpuVfxScene } from './fakeGpuVfxScene';
import { CombatGoreGpuRenderer } from '../src/effects/CombatGoreGpuRenderer';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { GpuVfxEffectId } from '../src/effects/gpu/GpuVfxEffects';
import type { GpuVfxSpawnSpec } from '../src/effects/gpu/GpuVfxSpawnSpec';

function square() {
  const pixels = new Uint8ClampedArray(48 * 48 * 4);
  for (let y = 12; y < 36; y++) for (let x = 12; x < 36; x++) pixels[(y * 48 + x) * 4 + 3] = 210;
  return pixels;
}
describe('organic death material', () => {
  it('has deterministic non-grid Poisson positions, distinct variants and varied radii', () => {
    const src = square(), layout = createDeathGrainLayout(src, T, 0), points = layout.grains;
    expect(layout).toEqual(createDeathGrainLayout(src, T, 0));
    expect(points.length).toBeGreaterThan(20); expect(points.length).toBeLessThanOrEqual(256);
    for (let i = 0; i < points.length; i++) {
      const p = points[i]; expect(src[(Math.floor(p.y) * 48 + Math.floor(p.x)) * 4 + 3]).toBeGreaterThan(0);
      for (let j = 0; j < i; j++) expect(Math.hypot(p.x - points[j].x, p.y - points[j].y)).toBeGreaterThanOrEqual(T.grainSpacingPx - 1e-6);
    }
    // Regular C2 3px subcells have phase coherence near 1; arbitrary Poisson phases do not.
    for (const key of ['x', 'y'] as const) {
      const phase = points.map(p => p[key] * Math.PI * 2 / 3);
      expect(Math.hypot(phase.reduce((s, p) => s + Math.cos(p), 0), phase.reduce((s, p) => s + Math.sin(p), 0)) / points.length).toBeLessThan(0.4);
    }
    expect(Math.max(...points.map(p => p.radius)) / Math.min(...points.map(p => p.radius))).toBeGreaterThan(2);
    for (let v = 1; v < 4; v++) expect(createDeathGrainLayout(src, T, v).grains).not.toEqual(points);
    expect(createDeathGrainLayout(src, { ...T, grainSeed: T.grainSeed + 1 }, 0).grains).not.toEqual(points);
  });
  it('erodes the edge before the centre, with persistent per-pixel owners and no rectangular subcell mask', () => {
    const { threshold, owners, grains } = createDeathGrainLayout(square(), T, 0);
    const edge = Array.from({length:24}, (_, i) => threshold[12 * 48 + 12 + i]);
    const core = Array.from({length:8}, (_, i) => threshold[24 * 48 + 20 + i]);
    expect(edge.reduce((a,b)=>a+b)/edge.length).toBeLessThan(core.reduce((a,b)=>a+b)/core.length - 0.15);
    expect(new Set(Array.from(threshold.slice(12*48+12,12*48+36))).size).toBeGreaterThan(15);
    for(let y=12;y<36;y++) for(let x=12;x<36;x++) expect(owners[y*48+x]).toBeGreaterThanOrEqual(0);
    expect(grains.reduce((s,g)=>s+g.mass,0)).toBeCloseTo(24*24*210/255, 4);
  });
  it('keeps coverage continuous, bounds drift at extreme tuning, and ends transparent for every variant', () => {
    const src = square();
    for (const tuning of [T, resolveDeathTuning({grainDriftPx:8, grainSizeVariance:0.65, grainRoughness:0.4})]) {
      for(let v=0;v<4;v++) {
        const bake=createDeathGrainBaker(src,tuning,v), out=new Uint8ClampedArray(src.length);
        let previous=0;
        for(let frame=38;frame<128;frame++) {
          bake(out,frame/127); let mass=0; for(let i=3;i<out.length;i+=4) mass+=out[i]/255;
          if(frame>38) expect(Math.abs(mass-previous)).toBeLessThan(24*24*210/255*0.13);
          if(frame/127>=T.dustAt && frame/127<=T.fineDustAt) expect(mass).toBeGreaterThan(24*24*210/255*0.44);
          previous=mass;
        }
        expect(previous).toBe(0);
      }
    }
    for(const values of [{grainDriftPx:9}, {grainJitter:1.1}, {grainSizeVariance:0.7}, {grainSpacingPx:1}, {grainSeed:0.5}]) expect(()=>resolveDeathTuning(values)).toThrow();
  });
  it('adds four full sequences with unique IDs while retaining old IDs and the atlas size limit', () => {
    expect(GPU_VFX_DEATH_MORPH_VARIANT_FRAME_IDS.map(v=>v.length)).toEqual([128,128,128,128]);
    expect(GPU_VFX_DEATH_MORPH_VARIANT_FRAME_IDS[0][0]).toBe(54);
    expect(GPU_VFX_DEATH_MORPH_VARIANT_FRAME_IDS[1][0]).toBeGreaterThan(219);
    expect(new Set(GPU_VFX_ATLAS.map(e=>e.id)).size).toBe(GPU_VFX_ATLAS.length);
    expect(packGpuVfxAtlas().size).toBeLessThanOrEqual(2048);
  });
  it('selects multiple variants from the death seed without new members, RNG draws or changed flight paths', () => {
    resetGpuVfxAtlasForTests(); const scene=makeFakeGpuVfxScene(), gpu=new GpuVfxSystem(scene as never);
    const renderer=new CombatGoreGpuRenderer(scene as never); renderer.registerGpuVfx(gpu);
    vi.spyOn(renderer.fragmentTemplateCache,'get').mockReturnValue({ textureKey:'fixture',frame:'0', sourceWidth:32,sourceHeight:32,
      chunks:Array.from({length:32},(_,i)=>({offsetX:(i%8)/8-0.5,offsetY:Math.floor(i/8)/4-0.5,width:0.125,height:0.125,color:0xdddddd,brightness:0.86})) });
    let specs: GpuVfxSpawnSpec[]=[];
    gpu.setPreviewSpawnObserver(spec=>{if(spec.effect===GpuVfxEffectId.DeathFragment) specs.push({...spec});});
    const play=(seed:number,organic:number)=>{specs=[];gpu.releaseAll();renderer.setDeathTuning({grainOrganic:organic});renderer.playDeath({type:'death',x:0,y:0,targetId:'test',textureKey:'fixture',frame:0,displayWidth:32,displayHeight:32,rotation:0,seed,dirX:1,dirY:0},false);return specs;};
    const first=play(1234,1), again=play(1234,1), other=play(2345,1), grid=play(1234,0);
    expect(first).toEqual(again); expect(new Set(first.map(s=>s.frameAnimation)).size).toBe(4);
    expect(other.map(s=>s.frameAnimation)).not.toEqual(first.map(s=>s.frameAnimation));
    const flight=(s:GpuVfxSpawnSpec)=>{const {frameAnimation,rotation,...rest}=s;return rest;};
    expect(first.map(flight)).toEqual(grid.map(flight));
    for(const s of first) expect(s.rotation).toBeCloseTo(Math.atan2(s.vy,s.vx),10);
    renderer.destroy();gpu.destroy();
  });
});
