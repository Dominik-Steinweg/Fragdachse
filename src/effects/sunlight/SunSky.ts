import { SUN_SKY_KEYFRAMES, EVENING_SUN } from '../../config/sunlight';
export { SUN_SKY_KEYFRAMES } from '../../config/sunlight';
import { normalizeTimeOfDay } from '../TimeOfDay';

/** Sonnenwald ambient anchors. Zero weight borrows the production sky exactly.
 * Local lights, emissives, shadows and production SKY_KEYFRAMES are untouched. */
const smooth=(x:number):number=>x*x*(3-2*x);
function mixColor(a:number,b:number,t:number):number {
  let color=0;
  for(let shift=0;shift<=16;shift+=8)color|=Math.round(((a>>>shift)&255)*(1-t)+((b>>>shift)&255)*t)<<shift;
  return color;
}
export function resolveSunAmbient(minutes:number):number|null {
  const m=normalizeTimeOfDay(minutes);
  if(m<=1050||m>=1245)return null;
  let a: typeof SUN_SKY_KEYFRAMES[number]=SUN_SKY_KEYFRAMES[SUN_SKY_KEYFRAMES.length-1];
  let b: typeof SUN_SKY_KEYFRAMES[number]=SUN_SKY_KEYFRAMES[0];
  for(let i=0;i<SUN_SKY_KEYFRAMES.length-1;i++)if(m>=SUN_SKY_KEYFRAMES[i].minute&&m<SUN_SKY_KEYFRAMES[i+1].minute){a=SUN_SKY_KEYFRAMES[i];b=SUN_SKY_KEYFRAMES[i+1];break;}
  const t=smooth(((m-a.minute+1440)%1440)/((b.minute-a.minute+1440)%1440));
  const weight=a.weight+(b.weight-a.weight)*t;
  if(weight===0)return null;
  const color=mixColor(a.color,b.color,t);
  return color; // Endpoint colours borrow production once at module initialization.
}

/** Retain the approved morning curve; extend soft direct light through golden
 * hour, then fade it completely into the unchanged production night. */

export function resolveSunStrength(minutes:number,production:number):number {
  const m=normalizeTimeOfDay(minutes);
  if(m<=1050||m>=1215)return production;
  for(let i=0;i<EVENING_SUN.length-1;i++) {
    const a=EVENING_SUN[i],b=EVENING_SUN[i+1];
    if(m>=a[0]&&m<b[0])return a[1]+(b[1]-a[1])*smooth((m-a[0])/(b[0]-a[0]));
  }
  return 0;
}

export function resolveDaylightStrength(time: number): number {
  const daylight = time >= 6 * 60 && time <= 20 * 60;
  const fade = Math.max(0, Math.min(1, (time - 360) / 90, (1200 - time) / 90));
  return daylight ? fade * fade * (3 - 2 * fade) : 0;
}
