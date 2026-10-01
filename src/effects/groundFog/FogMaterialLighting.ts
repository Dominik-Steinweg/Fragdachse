import type { SunTuning } from '../sunlight/SunTuning';

/** Resolve woodland radiance in the existing material target. Keep the display fallback
 * for unsupported samplers or extreme live tints which could overflow RGBA8. */
export function canPrelightFog(t:SunTuning|undefined,units:number,normal:boolean):boolean {
  if(!t||!normal||units<10)return false;
  for(let i=0;i<3;i++)if(t.shade[i]<.65||t.sun[i]<.65)return false;
  return true;
}
