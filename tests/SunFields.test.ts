import { expect,it } from 'vitest';
import { cloudShadowAt, cloudTravel, sunGapMaskAt } from '../src/effects/sunlight/SunFieldModel';
import { setCloudUniforms } from '../src/effects/sunlight/cloudShadow';
import { createSunTuning } from '../src/effects/sunlight/SunAtmosphere';
import { validateSunTuning } from '../src/effects/sunlight/SunTuning';

it('keeps clouds bounded, deterministic, stable at zero/paused time and neutral at night',()=>{
  const state={tuning:createSunTuning(),timeSec:0,strength:1};
  for(const time of [0,1/60,30,50000,NaN,Infinity])for(let x=-1000;x<=1000;x+=173) {
    state.timeSec=time;const value=cloudShadowAt(x,x*.37,state);
    expect(value).toBeGreaterThanOrEqual(0);expect(value).toBeLessThanOrEqual(1);
    expect(cloudShadowAt(x,x*.37,state)).toBe(value);
    expect(cloudShadowAt(x,x*.37,{...state,strength:0})).toBe(1);
  }
  expect(cloudShadowAt(NaN,0,state)).toBe(1);
  const uniforms=new Map(),set=(key:string,value:unknown)=>uniforms.set(key,value);
  state.timeSec=0;setCloudUniforms(set,state);expect(uniforms.get('uCloudTime')).toBe(0);
  state.timeSec=16/1000;setCloudUniforms(set,state);const before=new Map(uniforms);
  setCloudUniforms(set,state);expect(uniforms).toEqual(before);
  expect(uniforms.get('uSunLeafTime')).toBe(state.timeSec);
});
it('changes cloud shape beyond rigid drift and keeps gust motion in the wind direction',()=>{
  const state={tuning:createSunTuning(),timeSec:0,strength:1};let difference=0;
  const time=40,drift=cloudTravel(time,state.tuning.cloudSpeed,state.tuning.cloudGust);
  for(let x=-800;x<=800;x+=80)difference+=Math.abs(cloudShadowAt(x,x*.7,state,0)-cloudShadowAt(x+drift,x*.7+drift*.23,state,time));
  expect(difference).toBeGreaterThan(.001);
  for(let t=0;t<300;t+=.7)expect(cloudTravel(t+.016,18,.45)).toBeGreaterThan(cloudTravel(t,18,.45));
  expect(cloudTravel(0,18,.45)).toBe(0);
});
it('uses sparse continuous anisotropic gap shapes instead of radial steps',()=>{
  let lit=0,dark=0,anisotropy=0;
  for(let u=-300;u<300;u+=7)for(let v=-300;v<300;v+=7) {
    const value=sunGapMaskAt(u,v,.8);
    expect(value).toBeGreaterThanOrEqual(0);expect(value).toBeLessThanOrEqual(1);
    expect(sunGapMaskAt(u,v,.8)).toBe(value);
    expect(Math.abs(sunGapMaskAt(u+.001,v,.8)-value)).toBeLessThan(.001);
    if(value>0){lit++;anisotropy+=Math.abs(sunGapMaskAt(u+5,v,.8)-sunGapMaskAt(u,v+5,.8));}else dark++;
  }
  expect(lit).toBeGreaterThan(0);expect(dark).toBeGreaterThan(lit);expect(anisotropy).toBeGreaterThan(.001);
  expect(sunGapMaskAt(NaN,0,1)).toBe(0);
});
it('validates new controls without accepting unbounded motion or nonfinite values',()=>{
  for(const values of [{cloudEvolution:NaN},{cloudGust:Infinity},{raysBreath:-1},{raysCloudSoftness:4}])expect(()=>validateSunTuning(values)).toThrow();
  expect(validateSunTuning({cloudEvolution:0,cloudGust:0,raysBreath:0,raysCloudSoftness:0})).toEqual({cloudEvolution:0,cloudGust:0,raysBreath:0,raysCloudSoftness:0});
});
