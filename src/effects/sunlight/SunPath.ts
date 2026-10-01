import { normalizeTimeOfDay, resolveSkyShadowLength } from '../TimeOfDay';
import { resolveSunStrength, resolveDaylightStrength } from './SunSky';

import { SUN_PATH } from '../../config/sunlight';
export { SUN_PATH } from '../../config/sunlight';
export interface SunPathState {
  /** Degrees counterclockwise from screen east: north=90, west=180. */
  azimuth: number;
  elevation: number;
  strength: number;
  direction: [number, number];
  sun: [number, number, number];
  horizonAzimuth: number;
}
const smooth = (t: number): number => { t=Math.max(0,Math.min(1,t));return t*t*(3-2*t); };
export function quantizeSunAzimuth(degrees: number, step: number = SUN_PATH.stepDegrees): number {
  if(!Number.isFinite(degrees))return 0;
  if(!Number.isFinite(step)||step<=0)step=SUN_PATH.stepDegrees;
  return (Math.round((((degrees%360)+360)%360)/step)*step)%360;
}
export function createSunPath(): SunPathState {
  return {azimuth:0,elevation:0,strength:0,direction:[1,0],sun:[1,0,0],horizonAzimuth:0};
}
/** Deterministic from replicated minute only; writes into caller-owned storage.
 * At unlit midnight the held western direction resets to the eastern sunrise.
 * The two smooth half-arcs put solar noon at the existing 12:00 elevation peak. */
export function resolveSunPath(minutes: number, override: number | null, out: SunPathState): SunPathState {
  const m=normalizeTimeOfDay(Number.isFinite(minutes)?minutes:0);
  const f=m<=SUN_PATH.noon ? .5*smooth((m-SUN_PATH.sunrise)/(SUN_PATH.noon-SUN_PATH.sunrise))
    : .5+.5*smooth((m-SUN_PATH.noon)/(SUN_PATH.sunset-SUN_PATH.noon));
  out.azimuth=override!==null&&Number.isFinite(override)?((override%360)+360)%360:180*f;
  const angle=out.azimuth*Math.PI/180;
  out.direction[0]=Math.cos(angle);out.direction[1]=-Math.sin(angle);
  const length=resolveSkyShadowLength(m);
  out.strength=resolveSunStrength(m,resolveDaylightStrength(m));
  out.elevation=Math.atan(1/Math.max(.1,length));out.sun[2]=Math.sin(out.elevation);
  const horizontal=Math.cos(out.elevation);
  out.sun[0]=out.direction[0]*horizontal;out.sun[1]=out.direction[1]*horizontal;
  out.horizonAzimuth=quantizeSunAzimuth(out.azimuth);
  return out;
}
