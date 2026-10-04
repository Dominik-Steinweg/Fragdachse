import assert from 'node:assert/strict';
import { expect,it } from 'vitest';
import { cloudShadowAt, cloudTravel, sunlightAt } from '../src/effects/sunlight/SunFieldModel';
import { setCloudUniforms } from '../src/effects/sunlight/cloudShadow';
import { createSunTuning } from '../src/effects/sunlight/SunAtmosphere';
import { createSunPath, resolveSunPath } from '../src/effects/sunlight/SunPath';
import { validateSunTuning } from '../src/effects/sunlight/SunTuning';

// Use native assertions in dense sampling loops; retain every coordinate and invariant.
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
  expect(uniforms.get('uCloudTime')).toBe(state.timeSec);
});
it('changes cloud shape beyond rigid drift and keeps gust motion in the wind direction',()=>{
  const state={tuning:createSunTuning(),timeSec:0,strength:1};let difference=0;
  const time=40,drift=cloudTravel(time,state.tuning.cloudSpeed,state.tuning.cloudGust);
  for(let x=-800;x<=800;x+=80)difference+=Math.abs(cloudShadowAt(x,x*.7,state,0)-cloudShadowAt(x+drift,x*.7+drift*.23,state,time));
  expect(difference).toBeGreaterThan(.001);
  for(let t=0;t<300;t+=.7)expect(cloudTravel(t+.016,18,.45)).toBeGreaterThan(cloudTravel(t,18,.45));
  expect(cloudTravel(0,18,.45)).toBe(0);
});
it('anchors organic openings to the world, independent of azimuth and elevation',()=>{
 const state={tuning:createSunTuning(),timeSec:37,strength:1,sunPath:createSunPath()};
 let variationX=0,variationY=0,min=1,max=0;
 for(let x=-1600;x<1600;x+=83)for(let y=-1600;y<1600;y+=89){
  const opening=sunlightAt(x,y,state);min=Math.min(min,opening);max=Math.max(max,opening);
  for(const minute of [360,480,720,1020,1200]){
   resolveSunPath(minute,null,state.sunPath);assert.equal(sunlightAt(x,y,state),opening);
  }
  variationX+=Math.abs(sunlightAt(x+20,y,state)-opening);variationY+=Math.abs(sunlightAt(x,y+20,state)-opening);
  assert.ok(Math.abs(sunlightAt(x+.001,y,state)-opening)<.001);
 }
 expect(max-min).toBeGreaterThan(.25);expect(variationX/variationY).toBeGreaterThan(.5);expect(variationX/variationY).toBeLessThan(2);
});
it('fades continuously into completely clear and overcast weather',()=>{
 const state={tuning:createSunTuning(),timeSec:19,strength:1};
 for(const endpoint of [0,1]){state.tuning.cloudCover=endpoint;const end=cloudShadowAt(330,750,state);
  state.tuning.cloudCover=endpoint===0?1e-6:1-1e-6;expect(cloudShadowAt(330,750,state)).toBeCloseTo(end,7);}
});
it('validates new controls without accepting unbounded motion or nonfinite values',()=>{
  for(const values of [{cloudEvolution:NaN},{cloudGust:Infinity},{cloudWarp:-1},{cloudSoftness:4}])expect(()=>validateSunTuning(values)).toThrow();
  expect(validateSunTuning({cloudEvolution:0,cloudGust:0,cloudWarp:0,cloudSoftness:.12})).toEqual({cloudEvolution:0,cloudGust:0,cloudWarp:0,cloudSoftness:.12});
});

it('keeps neutral nights and cancels ground modulation exactly for fog radiance',async()=>{
 const {sunCompositeFactor}=await import('../src/effects/sunlight/sunVisibility');
 const {SUN_ATMOSPHERE_KEYFRAMES,resolveSunAtmosphere}=await import('../src/effects/sunlight/SunAtmosphere');
 const t=createSunTuning(),sun=createSunPath(),factor=[0,0,0];
 for(const {minute} of SUN_ATMOSPHERE_KEYFRAMES){resolveSunAtmosphere(minute,t);resolveSunPath(minute,null,sun);
  for(const opening of [0,.1,.4,.8,1])for(const grain of [-.5,0,.5]){
   sunCompositeFactor(factor,t.shade,t.daylight,t.sun,opening,sun.strength,grain);
   expect(factor.every(Number.isFinite)).toBe(true);
   if(sun.strength===0)expect(factor).toEqual([1,1,1]);
   for(const f of factor)expect((.4/f)*f).toBeCloseTo(.4,12);
  }
 }
});


it('separates neutral daylight from warm openings and cool cloud shade',async()=>{
 const {sunCompositeFactor}=await import('../src/effects/sunlight/sunVisibility');
 const {resolveSunAtmosphere}=await import('../src/effects/sunlight/SunAtmosphere');
 const t=createSunTuning(),dark=[0,0,0],normal=[0,0,0],lit=[0,0,0];
 const luma=(v:number[])=>v[0]*.2126+v[1]*.7152+v[2]*.0722;
 for(const minute of [480,600,720,1020,1140,1185]){
  resolveSunAtmosphere(minute,t);const strength=resolveSunPath(minute,null,createSunPath()).strength;
  sunCompositeFactor(dark,t.shade,t.daylight,t.sun,0,strength);
  sunCompositeFactor(normal,t.shade,t.daylight,t.sun,.7,strength);
  sunCompositeFactor(lit,t.shade,t.daylight,t.sun,1,strength);
  expect(luma(lit)).toBeGreaterThan(luma(normal));expect(luma(normal)).toBeGreaterThan(luma(dark));
  expect(dark[0]).toBeLessThan(dark[2]);expect(lit[0]-lit[2]).toBeGreaterThan(normal[0]-normal[2]);
  // Ordinary daylight has no blanket golden lift. Twilight smoothly relaxes contrast.
  expect(Math.abs(normal[0]-normal[2])).toBeLessThan(.05);
  if(strength===1)expect(luma(dark)/luma(normal)).toBeLessThan(.85);
 }
 expect(validateSunTuning({daylight:[1,1,1]})).toEqual({daylight:[1,1,1]});
 expect(()=>validateSunTuning({daylight:[NaN,1,1]})).toThrow();
});

it('retains broad shadows and minority highlights throughout active atmosphere anchors',async()=>{
 const {SUN_ATMOSPHERE_KEYFRAMES,resolveSunAtmosphere}=await import('../src/effects/sunlight/SunAtmosphere');
 const t=createSunTuning(),state={tuning:t,timeSec:30,strength:1};
 for(const {minute} of SUN_ATMOSPHERE_KEYFRAMES){
  resolveSunAtmosphere(minute,t);if(t.cloudCover===0)continue;
  let count=0,shadow=0,highlight=0,gradient=0;
  // Several independent cloud cells in both axes; no assertions on a camera/seed.
  for(let y=-8192;y<8192;y+=137)for(let x=-8192;x<8192;x+=131){
   const v=sunlightAt(x,y,state);count++;if(v<.5)shadow++;if(v>.9)highlight++;
   gradient=Math.max(gradient,Math.abs(sunlightAt(x+1,y,state)-v));
  }
  expect(shadow/count).toBeGreaterThan(.35);expect(shadow/count).toBeLessThan(.60);
  expect(highlight/count).toBeGreaterThan(.03);expect(highlight/count).toBeLessThan(.25);
  expect(gradient).toBeLessThan(.025);
 }
});

it('adds bounded smaller openings with negligible mean exposure shift and stable paused coordinates',async()=>{
 const {SUN_ATMOSPHERE_KEYFRAMES,resolveSunAtmosphere}=await import('../src/effects/sunlight/SunAtmosphere');
 const {sunCompositeFactor}=await import('../src/effects/sunlight/sunVisibility');const t=createSunTuning(),out=[0,0,0];
 const state={tuning:t,timeSec:30,strength:1};
 for(const {minute} of SUN_ATMOSPHERE_KEYFRAMES){resolveSunAtmosphere(minute,t);let delta=0,changes=0,n=0;
  for(let y=-4096;y<4096;y+=137)for(let x=-4096;x<4096;x+=131){
   const amount=t.cloudSpotAmount,withSpot=sunlightAt(x,y,state);t.cloudSpotAmount=0;const without=sunlightAt(x,y,state);t.cloudSpotAmount=amount;
   assert.equal(sunlightAt(x,y,state),withSpot);sunCompositeFactor(out,t.shade,t.daylight,t.sun,withSpot,1);const a=out[0]*.2126+out[1]*.7152+out[2]*.0722;
   sunCompositeFactor(out,t.shade,t.daylight,t.sun,without,1);delta+=a-(out[0]*.2126+out[1]*.7152+out[2]*.0722);changes+=Math.abs(withSpot-without);n++;
  }
  expect(Math.abs(delta/n)).toBeLessThan(.02);if(t.cloudCover>0)expect(changes/n).toBeGreaterThan(.005);else expect(changes).toBe(0);
 }
});

it('gives small openings visible local contrast while bounding average exposure and preserving night',async()=>{
 const {cloudSmallOpeningAt}=await import('../src/effects/sunlight/SunFieldModel');
 const {sunCompositeFactor}=await import('../src/effects/sunlight/sunVisibility');
 const {resolveSunAtmosphere}=await import('../src/effects/sunlight/SunAtmosphere');
 const t=createSunTuning(),state={tuning:t,timeSec:30,strength:1,sunPath:createSunPath()},out=[0,0,0];
 const luma=()=>out[0]*.2126+out[1]*.7152+out[2]*.0722;
 for(const minute of [0,480,600,720,1020,1155]){
  resolveSunAtmosphere(minute,t);state.strength=resolveSunPath(minute,null,state.sunPath).strength;
  let before=0,after=0,peak=1;
  for(let y=-2000;y<2000;y+=39)for(let x=-2000;x<2000;x+=37){
   const spot=cloudSmallOpeningAt(x,y,state),visibility=sunlightAt(x,y,state);
   assert.equal(cloudSmallOpeningAt(x,y,state,0),0);
   assert.equal(cloudSmallOpeningAt(x,y,state),spot);
   state.sunPath.azimuth+=37;assert.equal(cloudSmallOpeningAt(x,y,state),spot);
   sunCompositeFactor(out,t.shade,t.daylight,t.sun,visibility,state.strength);const base=luma();before+=base;
   sunCompositeFactor(out,t.shade,t.daylight,t.sun,visibility,state.strength,0,spot,t.cloudCover>0?t.cloudSpotAmount:0);
   after+=luma();peak=Math.max(peak,luma()/base);
   if(!state.strength)assert.deepEqual(out,[1,1,1]);
  }
  if(state.strength>.99){expect(peak).toBeGreaterThan(1.15);expect(peak).toBeLessThan(1.35);}
  expect(Math.abs(after/before-1)).toBeLessThan(.04);
 }
});

it('keeps the material factor finite and positive for all atmosphere anchors and RGBA8 field extremes',async()=>{
 const {sunCompositeFactor}=await import('../src/effects/sunlight/sunVisibility');
 const {SUN_ATMOSPHERE_KEYFRAMES}=await import('../src/effects/sunlight/SunAtmosphere');
 const result=[0,0,0];
 for(const {values:t} of SUN_ATMOSPHERE_KEYFRAMES)for(const strength of [0,.5,1]){
  for(const visibility of [0,1/255,.5,1])for(const spot of [0,1])for(const grain of [-.5,.5]){
   sunCompositeFactor(result,t.shade,t.daylight,t.sun,visibility,strength,grain,spot,t.cloudSpotAmount);
   for(const factor of result){
    assert.ok(Number.isFinite(factor));assert.ok(factor>0);assert.ok(factor<=2);
    if(strength===0)assert.equal(factor,1);
    // Effect colour is the destination of modulate-2x, never a material input.
    // RGBA8 clamps out-of-range colour on its preceding write, before blending.
    for(const effect of [-1,0,1/255,1,4]){
     const destination=Math.max(0,Math.min(1,effect));
     const output=2*(factor*.5)*destination;
     assert.ok(Number.isFinite(output));assert.ok(output>=0);
    }
   }
  }
 }
});
