import type { SunTuning } from './SunTuning';
import type { SunPathState } from './SunPath';
import { cloudTimeSeconds } from './SunFieldModel';

/** Borrowed world presentation state; time follows the pausible presentation clock. */
export interface SunCloudState { tuning: SunTuning; timeSec: number; strength: number; sunPath?: SunPathState; cache?: CloudFieldBinding; quality?: import('./SunRenderQuality').SunRenderQuality }
export interface CloudFieldBinding { readonly world: number[]; readonly delay: number; bind(): void }
export function cloudDirectFactor(open: number, density: number, strength: number): number {
  if(!Number.isFinite(strength)||strength<=0)return 1;
  return 1-(1-Math.max(0,Math.min(1,open)))*Math.max(0,Math.min(1,density))*Math.min(1,strength);
}
export const CLOUD_SHADOW_GLSL = `
uniform float uCloudTime,uCloudCover,uCloudDensity,uCloudSpeed,uCloudScale,uCloudStrength;
uniform float uCloudEvolution,uCloudGust;
float cloudHash(vec2 p) { p=fract(p*vec2(.1031,.11369)); p+=dot(p,p.yx+19.19); return fract((p.x+p.y)*p.x); }
float cloudNoise(vec2 p) {
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(cloudHash(i),cloudHash(i+vec2(1,0)),f.x),
    mix(cloudHash(i+vec2(0,1)),cloudHash(i+vec2(1,1)),f.x),f.y);
}
// Integrate the gust velocity analytically. No accumulating state, no drift jumps,
// positive east/south velocity even at the maximum allowed gust amplitude.
float cloudTravel(float timeSec,float speed) {
  return speed*(timeSec+uCloudGust*(.65*sin(timeSec*.071)/.071+.35*sin(timeSec*.113)/.113));
}
uniform sampler2D uCloudField;
uniform vec4 uCloudWorld;
uniform float uCloudCached,uCloudDelay;
float cloudShadowAnalytic(vec2 world,float timeSec) {
  if(uCloudCover<=0.0||uCloudStrength<=0.0)return 1.0;
  if(uCloudCover>=1.0)return 0.0;
  vec2 drift=vec2(1.0,.23)*cloudTravel(timeSec,uCloudSpeed);
  vec2 p=(world-drift)/max(500.0,uCloudScale);
  vec2 shear=timeSec*vec2(.009,-.006)*uCloudEvolution;
  vec2 warp=vec2(cloudNoise(p*.67+shear+3.1),cloudNoise(p*.67-shear*.71+19.7))-.5;
  p+=warp*uCloudEvolution;
  float field=.62*cloudNoise(p)+.27*cloudNoise(p*2.03+vec2(17.3,39.1)+shear*1.7)
    +.11*cloudNoise(p*4.11+7.7-shear*2.3);
  float threshold=mix(.20,.84,uCloudCover);
  return smoothstep(threshold-.14,threshold+.14,field);
}
float cloudShadow(vec2 world,float timeSec) {
  if(uCloudCover<=0.0||uCloudStrength<=0.0)return 1.0;
  if(uCloudCover>=1.0)return 0.0;
  vec2 uv=(world-uCloudWorld.xy)/max(uCloudWorld.zw,vec2(1.0));
  if(uCloudCached>0.5 && all(greaterThanEqual(uv,vec2(0.0))) && all(lessThanEqual(uv,vec2(1.0)))) {
    vec3 c=texture2D(uCloudField,vec2(uv.x,1.0-uv.y)).rgb;
    float lag=clamp((uCloudTime-timeSec)/max(.001,uCloudDelay),0.0,2.0);
    return lag<=1.0?mix(c.r,c.g,lag):mix(c.g,c.b,lag-1.0);
  }
  return cloudShadowAnalytic(world,timeSec);
}
float cloudTransmission(vec2 world) {
  return mix(1.0,cloudShadow(world,uCloudTime),uCloudDensity*uCloudStrength);
}
float cloudFormStrength(vec2 world) {
  return mix(1.0,.42,(1.0-cloudShadow(world,uCloudTime))*uCloudStrength*min(1.0,uCloudDensity/.75));
}
`;
export function setCloudUniforms(set: (name: string, value: unknown) => void, state?: SunCloudState, cached = true): void {
  const cache=cached?state?.cache:undefined;
  cache?.bind();
  set('uCloudCached',cache?1:0);set('uCloudField',cache?8:0);
  set('uCloudWorld',cache?.world??EMPTY_CLOUD_WORLD);set('uCloudDelay',cache?.delay??1);
  set('uSunStretch',sunBandStretch(state?.sunPath?.elevation));
  set('uSunDirection',state?.sunPath?.direction??FIXED_SUN_DIRECTION);
  const time=cloudTimeSeconds(state?.timeSec??0);
  set('uCloudTime',time);set('uCloudStrength',state?.strength??0);
  set('uSunLeafTime',time);set('uSunLeafFlutter',state?1.5:0);
  set('uCloudEvolution',state?.tuning.cloudEvolution??0);set('uCloudGust',state?.tuning.cloudGust??0);
  set('uCloudCover',state?.tuning.cloudCover??0);set('uCloudDensity',state?.tuning.cloudDensity??0);
  set('uCloudSpeed',state?.tuning.cloudSpeed??0);set('uCloudScale',state?.tuning.cloudScale??1000);
}
const EMPTY_CLOUD_WORLD = [0,0,1,1];
const FIXED_SUN_DIRECTION = [-Math.SQRT1_2,-Math.SQRT1_2];
/** Existing elevation encodes shadowLengthMult = cot(elevation), minimum 1 at noon. */
export function sunBandStretch(elevation?:number):number {
  if(elevation===undefined||!Number.isFinite(elevation))return 1;
  const length=1/Math.max(.001,Math.tan(elevation));
  const t=Math.max(0,Math.min(1,(length-1)/.6));
  return t*t*(3-2*t);
}
