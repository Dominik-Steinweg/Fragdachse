import {expect,it} from 'vitest';
import {isVolumeVegetation,stampVegetationAlpha,packVegetationVolume,vegetationFormFactor,
 vegetationShadowLength,VEGETATION_PAD} from '../src/effects/sunlight/VegetationVolume';
import {GROUND_COVER_CONFIG,FOREST_VEGETATION_CONFIG,FOREST_LITTER_CONFIG,GROUND_PATCH_CONFIG} from '../src/arena/GroundCoverConfig';
import {SUN_RENDER_QUALITY} from '../src/effects/sunlight/SunRenderQuality';
import {createSunPath,resolveSunPath} from '../src/effects/sunlight/SunPath';

it('classifies upright authored tiers, excluding flat litter, moss and anonymous decals',()=>{
 for(const tier of [GROUND_COVER_CONFIG,FOREST_VEGETATION_CONFIG])for(const v of tier.variants)
  expect(isVolumeVegetation(v.fileName.replace('.png',''))).toBe(true);
 for(const tier of [FOREST_LITTER_CONFIG,GROUND_PATCH_CONFIG])for(const v of tier.variants)
  expect(isVolumeVegetation(v.fileName.replace('.png',''))).toBe(false);
 for(const key of ['busch01','flower04','grass02','pilz01'])expect(isVolumeVegetation(key,true)).toBe(true);
 for(const key of ['Kiesel2','decal03','dirt_brown_mottle_a','rock_lichen'])expect(isVolumeVegetation(key,true)).toBe(false);
});
const source={width:16,height:16,alpha:Uint8Array.from({length:256},(_,i)=>{
 const x=i%16,y=Math.floor(i/16);return x>3&&x<12&&y>2&&y<13?Math.min(255,(x-3)*(13-y)*7):0;
})};
function field(rotation=0,flip=false,origin=-80,x=0){
 const n=80,r=4,raw=new Float32Array(n*n),a=new Float32Array(n*n),b=new Float32Array(n*n),out=new Uint8Array((n-4*r)**2*4);
 stampVegetationAlpha(raw,n,origin,-80,source,x,0,64,64,rotation,1,flip);
 packVegetationVolume(raw,a,b,n,r,out);return {raw,out,n};
}
it('rasterizes coverage deterministically with the same rotation/reflection as colour',()=>{
 const first=field(),again=field(),turned=field(Math.PI/2),flipped=field(0,true);
 expect(again.out).toEqual(first.out);
 for(let y=0;y<80;y++)for(let x=0;x<80;x++){
  expect(turned.raw[y*80+x]).toBeCloseTo(first.raw[(79-x)*80+y],6);
  expect(flipped.raw[y*80+x]).toBeCloseTo(first.raw[y*80+79-x],6);
 }
 const n=64;
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const p=(y*n+x)*4,q=((n-1-x)*n+y)*4;
  expect(Math.abs(turned.out[p]-first.out[q])).toBeLessThanOrEqual(1);
  expect(Math.abs(turned.out[p+2]-(255-first.out[q+3]))).toBeLessThanOrEqual(1);
  expect(Math.abs(turned.out[p+3]-first.out[q+2])).toBeLessThanOrEqual(1);
 }
});
it('bakes matching world samples across independently padded chunk borders',()=>{
 const left=field(0,false,-80,55).out,overlap=field(0,false,-16,55).out,n=64;
 for(let y=0;y<n;y++)for(let x=32;x<n;x++)for(let c=0;c<4;c++)
  expect(Math.abs(left[(y*n+x)*4+c]-overlap[(y*n+x-32)*4+c])).toBeLessThanOrEqual(1);
 expect(VEGETATION_PAD).toBeGreaterThanOrEqual(16);
});
it('follows solar direction, limits response, attenuates under clouds and is neutral at night',()=>{
 const sun=createSunPath();
 for(const minute of [420,720,1020,1140]){
  resolveSunPath(minute,null,sun);const nx=sun.direction[0]*.6,ny=sun.direction[1]*.6;
  const lit=vegetationFormFactor(nx,ny,sun.sun,sun.strength),shade=vegetationFormFactor(-nx,-ny,sun.sun,sun.strength);
  expect(lit).toBeGreaterThan(shade);expect(lit).toBeLessThanOrEqual(1.15);expect(shade).toBeGreaterThanOrEqual(.8);
  expect(Math.abs(vegetationFormFactor(nx,ny,sun.sun,1,1,.42)-1)).toBeLessThanOrEqual(Math.abs(vegetationFormFactor(nx,ny,sun.sun,1)-1));
  for(const strength of [0,-1,NaN])expect(vegetationFormFactor(nx,ny,sun.sun,strength)).toBe(1);
  const length=vegetationShadowLength(sun.elevation,6);expect(length).toBeGreaterThanOrEqual(3);expect(length).toBeLessThanOrEqual(22);
 }
});
it('uses the existing high/medium/low profile',()=>{
 expect(SUN_RENDER_QUALITY.high.vegetationForm&&SUN_RENDER_QUALITY.high.vegetationShadows).toBe(true);
 expect(SUN_RENDER_QUALITY.medium.vegetationForm).toBe(true);expect(SUN_RENDER_QUALITY.medium.vegetationShadows).toBe(false);
 expect(SUN_RENDER_QUALITY.low.vegetationForm||SUN_RENDER_QUALITY.low.vegetationShadows).toBe(false);
});
