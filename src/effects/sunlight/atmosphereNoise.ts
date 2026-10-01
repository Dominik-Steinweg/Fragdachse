/** No clock: sub-LSB error diffusion is stable when the scene is paused. */
export const ATMOSPHERE_DITHER_GLSL=`
float atmosphereDither(vec2 pixel) {
  return fract(52.9829189*fract(dot(floor(pixel),vec2(.06711056,.00583715))))-.5;
}
`;
/** Shared large bank field for fog and shafts. Same scenario time and cloud wind. */
export const FOG_BANK_GLSL=`
uniform float uFogCover,uFogBankScale,uFogWaterBoost,uFogShoreRamp,uFogPileSoftness,uFogScatter,uFogDensity;
uniform float uFogBankCore,uFogBankEdge,uFogClearHaze;
uniform float uFogPatchScale,uFogPatchDensity,uFogAreaBudget,uFogWaterAreaBudget;
uniform float uFogOpticalOpacity;
float fogBankHash(vec2 p){p=fract(p*vec2(.1031,.11369));p+=dot(p,p.yx+19.19);return fract((p.x+p.y)*p.x);}
float fogBankNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
 return mix(mix(fogBankHash(i),fogBankHash(i+vec2(1,0)),f.x),mix(fogBankHash(i+vec2(0,1)),fogBankHash(i+vec2(1,1)),f.x),f.y);}
float fogBank(vec2 world,float time,float speed) {
 if(uFogCover<=0.0)return 0.0;
 if(uFogCover>=1.0)return 1.0;
 vec2 q=world-vec2(1.0,.23)*cloudTravel(time,speed)*.18;
 vec2 wind=normalize(vec2(1.0,.23));
 vec2 p=vec2(dot(q,wind),dot(q,vec2(-wind.y,wind.x)))/(uFogBankScale*vec2(1.3,.65));
 vec2 evolve=time*vec2(.0017,-.0011);
 vec2 warp=vec2(fogBankNoise(p*.71+3.1+evolve),fogBankNoise(p*.71+17.3-evolve))-.5;
 float n=.85*fogBankNoise(p+warp*.6)+.15*fogBankNoise(p*2.17+warp+23.9+evolve);
 // Detail disturbs only the contour, never fills the clear zones with haze.
 n+=(fogBankNoise(q/95.0+warp)-.5)*.035;
 float threshold=mix(.80,.20,uFogCover);
 float width=uFogBankEdge/uFogBankScale*.65;
 return smoothstep(threshold-width*.5,threshold+width*.5,n);
}
`;
import type { SunTuning } from './SunTuning';

/** Shared bank envelope, not another clock or simulation. */
export function setFogBankUniforms(set:(name:string,value:unknown)=>void,t:SunTuning):void {
  set('uFogPatchScale',t.fogPatchScale);set('uFogPatchDensity',t.fogPatchDensity);
  set('uFogAreaBudget',t.fogAreaBudget);set('uFogWaterAreaBudget',t.fogWaterAreaBudget);
  set('uFogOpticalOpacity',t.fogOpacity);
  set('uFogCover',t.fogCover);set('uFogBankScale',t.fogBankScale);
  set('uFogBankCore',t.fogBankCore);set('uFogBankEdge',t.fogBankEdge);set('uFogClearHaze',t.fogClearHaze);
  set('uFogWaterBoost',t.fogWaterBoost);set('uFogShoreRamp',t.fogShoreRamp);
  set('uFogPileSoftness',t.fogPileSoftness);set('uFogScatter',t.fogScatter);set('uFogDensity',t.fogDensity);
}
