import { fogBankAt, fogBankShape } from '../src/effects/sunlight/SunFieldModel';
import { createSunTuning, resolveSunAtmosphere, SunAtmosphereClock } from '../src/effects/sunlight/SunAtmosphere';
import { describe, expect, it } from 'vitest';
import { FogBankField, fogPileEnvelope, fogShoreRamp, fogDayWeight, snapshotFogBoundary } from '../src/effects/groundFog/FogBankField';
import { FogTerrainModel } from '../src/effects/groundFog/FogTerrainModel';
import { validateSunTuning } from '../src/effects/sunlight/SunTuning';

const decode=(data:Uint8Array,x:number,y:number)=>((data[(y*64+x)*4]*256+data[(y*64+x)*4+1])/65535-.5)*128;
describe('fog bank boundary contracts',()=>{
  it('has a continuous monotone shoreline ramp on both sides of the waterline',()=>{
    for(const width of [60,110,140])for(const warp of [-12,0,12]) {
      let previous=0;
      for(let x=-200;x<=200;x+=.25) {
        const v=fogShoreRamp(x,width,warp);
        expect(v).toBeGreaterThanOrEqual(previous);expect(v).toBeLessThanOrEqual(1);
        expect(v-previous).toBeLessThan(.01);previous=v;
      }
      expect(Math.abs(fogShoreRamp(.001,width,warp)-fogShoreRamp(-.001,width,warp))).toBeLessThan(.0001);
    }
  });
  it('has bounded continuous obstacle shoulders rather than binary cell cuts',()=>{
    for(const softness of [12,22,40]) {
      let previous=fogPileEnvelope(-64,softness);
      for(let x=-63.75;x<=64;x+=.25) {
        const value=fogPileEnvelope(x,softness);
        expect(value).toBeGreaterThanOrEqual(0);expect(value).toBeLessThanOrEqual(1.28);
        expect(Math.abs(value-previous)).toBeLessThan(.04);previous=value;
      }
    }
  });
  it('builds deterministic signed distances across chunk borders and updates after destruction',()=>{
    const terrain=new FogTerrainModel({offsetX:70,offsetY:90,width:1536,height:1024},[]);
    terrain.setObstacle('rock',[{gridX:15,gridY:8}],true);
    const field=new FogBankField(),a=new Uint8Array(64*64*4),b=new Uint8Array(a.length),copy=new Uint8Array(a.length);
    field.build(terrain,0,0,a,64,0,0);field.build(terrain,1,0,b,64,0,0);
    field.build(terrain,0,0,copy,64,0,0);expect(a).toEqual(copy);
    expect(decode(a,63,33)).toBeLessThan(0);expect(decode(b,0,33)).toBeGreaterThan(0);
    expect(decode(b,0,33)-decode(a,63,33)).toBeCloseTo(8,1);
    for(let x=0;x<10;x++)expect(decode(b,x,33)).toBeGreaterThanOrEqual(decode(b,Math.max(0,x-1),33));
    for(let y=0;y<64;y++)for(let x=0;x<64;x++)expect(Math.abs(decode(a,x,y))).toBeLessThanOrEqual(64);
    terrain.removeObstacle('rock');field.build(terrain,1,0,b,64,0,0);
    expect(decode(b,0,33)).toBeCloseTo(64);
  });
  it('snapshots interrupted topology fades without jumping to either endpoint',()=>{
    const data=new Uint8Array([255,255,0,0]);snapshotFogBoundary(data,.5);
    expect(data[2]*256+data[3]).toBe(32768);expect(data[0]*256+data[1]).toBe(65535);
    snapshotFogBoundary(data,1);expect(data[2]*256+data[3]).toBe(65535);
  });
  it('adds no woodland material at night and rejects invalid live parameters',()=>{
    for(const s of [0,-1,NaN,Infinity])expect(fogDayWeight(s)).toBe(0);
    expect(fogDayWeight(.00001)).toBeLessThan(.000001);
    expect(fogDayWeight(1)).toBe(1);
    expect(()=>validateSunTuning({fogShoreRamp:0})).toThrow();
    expect(()=>validateSunTuning({fogCover:NaN})).toThrow();
    expect(()=>validateSunTuning({fogDensity:Infinity})).toThrow();
  });
});

describe('separated fog banks',()=>{
  it('keeps noon mostly clear while retaining dense cores at all sampled presentation times',()=>{
    const tuning=createSunTuning();resolveSunAtmosphere(720,tuning);
    for(const timeSec of [0,60,300]){
      const state={tuning,timeSec,strength:1};let clear=0,core=0,edge=0,total=0;
      for(let y=-4096;y<4096;y+=64)for(let x=-4096;x<4096;x+=64){
        const v=fogBankAt(x,y,state);total++;
        if(v<.01)clear++;if(v>.95)core++;if(v>.1&&v<.9)edge++;
        expect(v).toBeGreaterThanOrEqual(0);expect(v).toBeLessThanOrEqual(1);
      }
      expect(clear/total).toBeGreaterThanOrEqual(.60);
      expect(core/total).toBeGreaterThan(.05);expect(edge/total).toBeGreaterThan(.01);
    }
  });
  it('separates coverage from core density and has continuous, non-popping edges',()=>{
    const tuning=createSunTuning(),state={tuning,timeSec:0,strength:1};
    let edge=0;
    for(let x=-2000;x<=2000;x+=11){
      const v=fogBankAt(x,x*.71,state);
      expect(fogBankAt(x,x*.71,state)).toBe(v);
      expect(fogBankAt(x,x*.71,{...state,tuning:{...tuning,fogDensity:.7,fogBankCore:2.5}})).toBe(v);
      expect(fogBankAt(x,x*.71,{...state,tuning:{...tuning,fogCover:.8}})).toBeGreaterThanOrEqual(v);
      expect(Math.abs(fogBankAt(x+.001,x*.71,state)-v)).toBeLessThan(.001);
      expect(Math.abs(fogBankAt(x,x*.71,state,.001)-v)).toBeLessThan(.001);
      if(v>.05&&v<.95)edge++;
    }
    expect(edge).toBeGreaterThan(0);
    expect(fogBankShape(0,.5,tuning)*tuning.fogDensity-.004).toBeLessThanOrEqual(0);
    expect(fogBankShape(1,.5,tuning)).toBeGreaterThan(fogBankShape(.5,.5,tuning));
    expect(fogBankAt(30,40,{...state,tuning:{...tuning,fogCover:0}})).toBe(0);
    expect(fogBankAt(30,40,{...state,tuning:{...tuning,fogCover:1}})).toBe(1);
  });
  it('uses only shared presentation time, is finite for invalid time, and keeps night on its original receiver',()=>{
    const tuning=createSunTuning(),state={tuning,timeSec:0,strength:1};let motion=0;
    for(let x=-3000;x<3000;x+=71){
      const v=fogBankAt(x,100,state);
      expect(fogBankAt(x,100,state,NaN)).toBe(v);expect(fogBankAt(x,100,state,Infinity)).toBe(v);
      motion+=Math.abs(fogBankAt(x,100,state,120)-v);
    }
    expect(motion).toBeGreaterThan(.1);expect(fogBankAt(NaN,0,state)).toBe(0);
    const clock=new SunAtmosphereClock();clock.resolve(480,0);clock.resolve(720,0);
    const before=createSunTuning();resolveSunAtmosphere(clock.resolve(720,0),before);
    const paused=createSunTuning();resolveSunAtmosphere(clock.resolve(720,0),paused);
    expect(paused).toEqual(before);
    resolveSunAtmosphere(clock.resolve(720,1),paused);
    expect(Math.abs(paused.fogCover-before.fogCover)).toBeLessThan(.001);
    for(const strength of [0,-1,NaN])expect(fogDayWeight(strength)).toBe(0);
    for(const patch of [{fogBankCore:NaN},{fogBankEdge:0},{fogClearHaze:Infinity},{fogCover:1.1}])
      expect(()=>validateSunTuning(patch)).toThrow();
  });
});
