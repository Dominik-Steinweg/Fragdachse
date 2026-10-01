import type { SunTuning } from './SunTuning';

/** A SCREEN source s retains (1-s) of its destination. Reserve its maximum
 * channel contribution before allocating fog alpha: 1-(1-a)*(1-s) <= cover.
 * This is a compositing budget, independent of the optical-density model. */
export const FOG_VISIBILITY_BUDGET_GLSL=`
uniform float uFogMaxCover,uFogWaterMaxCover,uFogScatterBudget,uFogRadianceLimit;
float fogRayReserve(float strength) {
 return min(uFogScatterBudget,min(uFogMaxCover,uFogWaterMaxCover)*.5)*clamp(strength,0.0,1.0);
}
float fogSoftLimit(float value,float limit) {
 float knee=limit*.65;
 if(value<=knee)return value;
 return limit-(limit-knee)*exp(-(value-knee)/max(.00001,limit-knee));
}
float fogBudgetAlpha(float alpha,float water,float strength) {
 float day=smoothstep(0.0,.15,strength);
 float cover=mix(uFogMaxCover,uFogWaterMaxCover,clamp(water,0.0,1.0));
 float total=mix(alpha,fogSoftLimit(alpha,cover),day);
 float rays=fogRayReserve(strength);
 return max(0.0,(total-rays)/(1.0-rays));
}
`;

const clamp=(n:number,a=0,b=1)=>Number.isFinite(n)?Math.max(a,Math.min(b,n)):a;
export function fogRayReserve(strength:number,t:SunTuning):number {
  return Math.min(t.fogScatterBudget,Math.min(t.fogMaxCover,t.fogWaterMaxCover)*.5)*clamp(strength);
}
export function fogSoftLimit(value:number,limit:number):number {
  const knee=limit*.65;
  return value<=knee?value:limit-(limit-knee)*Math.exp(-(value-knee)/Math.max(.00001,limit-knee));
}
export function fogBudgetAlpha(alpha:number,water:number,strength:number,t:SunTuning):number {
  let day=clamp(strength/.15);day=day*day*(3-2*day);
  const cover=t.fogMaxCover+(t.fogWaterMaxCover-t.fogMaxCover)*clamp(water);
  const total=alpha+(fogSoftLimit(alpha,cover)-alpha)*day,rays=fogRayReserve(strength,t);
  return Math.max(0,(total-rays)/(1-rays));
}
/** Brightest-channel counterpart, after composite compensation and dithering.
 * CPU tests only; callers rendering a frame use the allocation-free GLSL above. */
export function fogBudgetSample(alpha:number,radiance:number,rays:number,water:number,strength:number,t:SunTuning) {
  if(!(strength>0))return {alpha,radiance,rays:0,cover:alpha};
  let day=clamp(strength/.15);day=day*day*(3-2*day);
  const a=fogBudgetAlpha(alpha,water,strength,t),r=Math.min(clamp(rays),fogRayReserve(strength,t));
  const ceiling=a*(1+(fogRadianceLimit(t)-1)*day);
  return {alpha:a,radiance:Math.min(Math.max(0,radiance*a/Math.max(.0001,alpha)),ceiling),rays:r,cover:1-(1-a)*(1-r)};
}
/** Leave headroom for the existing global grade/bloom; it still affects the
 * entire world. Do not add another grade pass or alter production grading. */
export function fogRadianceLimit(t:SunTuning):number {
  const gain=t.gradeBrightness*Math.max(1,t.gradeContrast)*Math.max(1,t.gradeSaturation)
    *(1+Math.abs(t.gradeTemperature)*.12)*(1+t.gradeBloomAmount);
  return .80/Math.max(1,gain);
}
export function setFogVisibilityUniforms(set:(key:string,value:unknown)=>void,t:SunTuning):void {
  set('uFogMaxCover',t.fogMaxCover);set('uFogWaterMaxCover',t.fogWaterMaxCover);
  set('uFogScatterBudget',t.fogScatterBudget);set('uFogRadianceLimit',fogRadianceLimit(t));
}
