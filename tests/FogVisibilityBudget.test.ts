import {expect,it} from 'vitest';
import {fogBudgetAlpha,fogBudgetSample,fogRayReserve,fogRadianceLimit,fogSoftLimit} from '../src/effects/sunlight/FogVisibilityBudget';
import {createSunTuning,resolveSunAtmosphere,SUN_ATMOSPHERE_KEYFRAMES} from '../src/effects/sunlight/SunAtmosphere';
import {createSunPath,resolveSunPath} from '../src/effects/sunlight/SunPath';
import {validateSunTuning} from '../src/effects/sunlight/SunTuning';

it('bounds fallback fog plus SCREEN scattering without patch metadata at every daytime anchor',()=>{
 const t=createSunTuning(),sun=createSunPath();
 for(const {minute}of SUN_ATMOSPHERE_KEYFRAMES){
  resolveSunAtmosphere(minute,t);resolveSunPath(minute,null,sun);
  if(sun.strength<.15)continue;
  for(const water of [0,.1,.5,.9,1])for(const alpha of [0,.005,.05,.3,.62,.95])for(const rgb of [0,.5,1,4]){
   const result=fogBudgetSample(alpha,rgb,1,water,sun.strength,t);
   const budget=t.fogMaxCover+(t.fogWaterMaxCover-t.fogMaxCover)*water;
   expect(result.cover).toBeLessThanOrEqual(budget+1e-12);
   expect(result.alpha).toBeGreaterThanOrEqual(0);expect(result.alpha).toBeLessThanOrEqual(alpha);
   expect(result.radiance).toBeLessThanOrEqual(result.alpha*fogRadianceLimit(t)+1e-12);
   // Brightness counts as coverage too: even a black substrate cannot receive
   // more than the reserved white-veil equivalent after the SCREEN pass.
   expect(result.radiance*(1-result.rays)+result.rays).toBeLessThanOrEqual(budget+1e-12);
   expect(result.rays).toBeLessThanOrEqual(fogRayReserve(sun.strength,t));
   expect(Object.values(result).every(Number.isFinite)).toBe(true);
  }
 }
});
it('keeps water clearer and transitions continuously across shores and budget knees',()=>{
 const t=createSunTuning();
 expect(t.fogWaterMaxCover).toBeLessThan(t.fogMaxCover);
 let previous=1;
 for(let water=0;water<=1;water+=.001){
   const a=fogBudgetAlpha(.6,water,1,t);expect(a).toBeLessThanOrEqual(previous);previous=a;
   expect(Math.abs(fogBudgetAlpha(.6,water+.00001,1,t)-a)).toBeLessThan(.0001);
 }
 for(const limit of [.1,.3,.5]){
   const knee=limit*.65;
   expect(fogSoftLimit(knee-1e-6,limit)).toBeCloseTo(fogSoftLimit(knee+1e-6,limit),5);
   expect(fogSoftLimit(100,limit)).toBeLessThanOrEqual(limit);
 }
});
it('leaves night unchanged and fades to the production receiver without a jump',()=>{
 const t=createSunTuning();
 for(const strength of [0,-1,NaN]){
  expect(fogBudgetSample(.4,.31,1,1,strength,t)).toEqual({alpha:.4,radiance:.31,rays:0,cover:.4});
 }
 const dawn=fogBudgetSample(.4,.31,1,1,1e-7,t);
 expect(Math.abs(dawn.alpha-.4)).toBeLessThan(1e-6);expect(Math.abs(dawn.radiance-.31)).toBeLessThan(1e-6);
 expect(fogRayReserve(0,t)).toBe(0);
});
it('accepts bounded live controls and keeps overrides within their combined budget',()=>{
 for(const patch of [{fogMaxCover:NaN},{fogWaterMaxCover:.8},{fogScatterBudget:Infinity}])expect(()=>validateSunTuning(patch)).toThrow();
 const t=createSunTuning();Object.assign(t,validateSunTuning({fogMaxCover:.10,fogWaterMaxCover:.05,fogScatterBudget:.06}));
 const a=fogBudgetSample(.95,8,1,1,1,t);
 expect(a.cover).toBeLessThanOrEqual(.05+1e-12);
 expect(fogRayReserve(1,t)).toBeLessThanOrEqual(t.fogWaterMaxCover*.5);
});
