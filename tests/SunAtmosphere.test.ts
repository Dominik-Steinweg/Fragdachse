import { expect, it } from 'vitest';
import { createSunTuning, resolveSunAtmosphere, SUN_ATMOSPHERE_KEYFRAMES, SunAtmosphereClock } from '../src/effects/sunlight/SunAtmosphere';
import { SUN_TUNING_DEFAULTS, validateSunTuning } from '../src/effects/sunlight/SunTuning';
import { cloudDirectFactor, setCloudUniforms } from '../src/effects/sunlight/cloudShadow';

it('interpolates cyclically with exact supports, finite values and clamped authored optics',()=>{
  const out=createSunTuning(),other=createSunTuning(),vectors=Object.values(out).filter(Array.isArray);
  const original=structuredClone(SUN_TUNING_DEFAULTS);
  for(const frame of SUN_ATMOSPHERE_KEYFRAMES){resolveSunAtmosphere(frame.minute,out);expect(out).toEqual(frame.values);}
  for(let minute=-1500;minute<3000;minute+=13){
    resolveSunAtmosphere(minute,out);resolveSunAtmosphere(minute+1440,other);expect(out).toEqual(other);
    expect(()=>validateSunTuning(out)).not.toThrow();
  }
  resolveSunAtmosphere(NaN,out);resolveSunAtmosphere(0,other);expect(out).toEqual(other);
  Object.values(out).filter(Array.isArray).forEach((v,i)=>expect(v).toBe(vectors[i]));
  expect(SUN_TUNING_DEFAULTS).toEqual(original);
});
it('keeps overrides across clock changes and resolves the current atmosphere when cleared',()=>{
  const out=createSunTuning(),base=createSunTuning(),override={fogOpacity:.51,sun:[1.1,1.2,1.3]};
  for(const frame of SUN_ATMOSPHERE_KEYFRAMES){
    resolveSunAtmosphere(frame.minute,out,override);expect(out.fogOpacity).toBe(override.fogOpacity);expect(out.sun).toEqual(override.sun);
    resolveSunAtmosphere(frame.minute,out,{});resolveSunAtmosphere(frame.minute,base);expect(out).toEqual(base);
  }
  expect(out.sun).not.toBe(override.sun);
  for(const value of [{cloudCover:-1},{cloudDensity:NaN},{cloudSpeed:Infinity},{cloudScale:0},{cloudCanopyShade:[1,1]}])expect(()=>validateSunTuning(value)).toThrow();
});
it('uses only supplied presentation time for smooth paused and stepped clock changes',()=>{
  const clock=new SunAtmosphereClock();expect(clock.resolve(480,1000)).toBe(480);
  expect(clock.resolve(1020,1000)).toBe(480);
  const mid=clock.resolve(1020,1400);expect(mid).toBeGreaterThan(480);expect(mid).toBeLessThan(1020);
  expect(clock.resolve(1020,1400)).toBe(mid);expect(clock.resolve(1020,1800)).toBe(1020);
  const cyclic=new SunAtmosphereClock();cyclic.resolve(1430,0);cyclic.resolve(10,0);
  expect(cyclic.resolve(10,800)).toBe(10);
});
it('keeps cloud attenuation exactly neutral without sunlight and bounded in daylight',()=>{
  for(const open of [0,.5,1])for(const density of [0,.5,1]){
    expect(cloudDirectFactor(open,density,0)).toBe(1);
    for(const strength of [0,.5,1]){const value=cloudDirectFactor(open,density,strength);expect(value).toBeGreaterThanOrEqual(0);expect(value).toBeLessThanOrEqual(1);}
  }
  expect(cloudDirectFactor(0,0,1)).toBe(1);
  const uniforms=new Map(),set=(key:string,value:unknown)=>uniforms.set(key,value);
  setCloudUniforms(set);expect(uniforms.get('uCloudStrength')).toBe(0);
  const state={tuning:createSunTuning(),timeSec:3,strength:1};
  setCloudUniforms(set,state);expect(uniforms.get('uCloudTime')).toBe(3);
  state.timeSec+=.016;setCloudUniforms(set,state);expect(uniforms.get('uCloudTime')).toBe(state.timeSec);
});

it('limits the reversible sky to evening and meets production exactly at both boundaries',async()=>{
  const {resolveSunAmbient,resolveSunStrength,SUN_SKY_KEYFRAMES}=await import('../src/effects/sunlight/SunSky');
  const {resolveSkyState}=await import('../src/effects/TimeOfDay');
  for(const minute of [0,300,480,720,1020,1050,1245,1320,1439,NaN]) expect(resolveSunAmbient(minute)).toBeNull();
  for(const minute of [0,300,480,720,1020,1050,1215,1320,1439,NaN]) expect(resolveSunStrength(minute,.37)).toBe(.37);
  for(const frame of SUN_SKY_KEYFRAMES) if(frame.weight===1)expect(resolveSunAmbient(frame.minute)).toBe(frame.color);
  for(const minute of [1050.00001,1244.99999]) {
    const actual=resolveSunAmbient(minute)!;
    const expected=resolveSkyState(minute<1100?1050:1245).ambientColor;
    for(const shift of [0,8,16])expect(Math.abs(((actual>>>shift)&255)-((expected>>>shift)&255))).toBeLessThanOrEqual(1);
  }
  // After the dusk anchor the override only fades towards production violet: no red bounce.
  let red=Infinity;
  for(let minute=1185;minute<1245;minute+=.5){const r=(resolveSunAmbient(minute)!>>>16)&255;expect(r).toBeLessThanOrEqual(red);red=r;}
  for(let minute=1050;minute<=1245;minute+=.37) {
    const color=resolveSunAmbient(minute);
    if(color!==null){expect(Number.isInteger(color)).toBe(true);expect(color).toBeGreaterThanOrEqual(0);expect(color).toBeLessThanOrEqual(0xffffff);}
    const strength=resolveSunStrength(minute,1);expect(strength).toBeGreaterThanOrEqual(0);expect(strength).toBeLessThanOrEqual(1);
    expect(resolveSunAmbient(minute+1440)).toBe(resolveSunAmbient(minute));
  }
});

it('validates rim tuning and holds geometry constant across all atmospheric keyframes',()=>{
  for(const bad of [{rockRimWidth:NaN},{rockRimWidth:0},{rockRimHeight:-1},{rockRimLip:Infinity},{rockContactAO:1}])expect(()=>validateSunTuning(bad)).toThrow();
  const out=createSunTuning();
  for(const frame of SUN_ATMOSPHERE_KEYFRAMES){resolveSunAtmosphere(frame.minute,out);for(const key of ['rockRimWidth','rockRimHeight','rockRimLip'] as const)expect(out[key]).toBe(SUN_TUNING_DEFAULTS[key]);}
  resolveSunAtmosphere(720,out,{rockRimHeight:5});expect(out.rockRimHeight).toBe(5);
  resolveSunAtmosphere(720,out,{});expect(out.rockRimHeight).toBe(SUN_TUNING_DEFAULTS.rockRimHeight);
});


it('tracks a continuous replicated clock across midnight instead of perpetually restarting a blend',async()=>{
 const {SunAtmosphereClock}=await import('../src/effects/sunlight/SunAtmosphere');const clock=new SunAtmosphereClock();
 clock.resolve(1438,0);
 for(let i=1;i<40;i++)expect(clock.resolve((1438+i*.4)%1440,i*16)).toBeCloseTo((1438+i*.4)%1440,8);
 const before=clock.resolve(10,640);expect(clock.resolve(720,640)).toBe(before);
 expect(clock.resolve(720,640)).toBe(before);expect(clock.resolve(720,1440)).toBe(720);
});


it('follows authored fast clocks at low frame rates, settles jumps and remains frozen on pause',async()=>{
 const {ArenaTimeOfDayController}=await import('../src/systems/ArenaTimeOfDayController');
 const {getCoopDefenseMapConfig}=await import('../src/config/coopDefenseMaps');
 const {parseTimeOfDay}=await import('../src/effects/TimeOfDay');
 const {SunAtmosphereClock}=await import('../src/effects/sunlight/SunAtmosphere');
 for(const id of ['0','15']){
  const map=getCoopDefenseMapConfig(id),source=new ArenaTimeOfDayController({startMinutes:parseTimeOfDay(map.timeOfDay!)!,roundStartTime:0,dynamic:map.dynamicTimeOfDay,bossSpawnAtMs:0});
  const clock=new SunAtmosphereClock();clock.resolve(source.sample(0).minutes,0);
  for(let ms=100;ms<=6000;ms+=100){const minute=source.sample(ms,{bossSpawnedAtMs:0,bossPhase:1}).minutes;expect(clock.resolve(minute,ms)).toBeCloseTo(minute,7);}
  const jump=source.sample(6100,{bossSpawnedAtMs:0,bossPhase:2}).minutes;
  const held=clock.resolve(jump,6100);expect(clock.resolve(jump,6100)).toBe(held);
  expect(clock.resolve(jump,6900)).toBeCloseTo(jump,7);
 }
});
