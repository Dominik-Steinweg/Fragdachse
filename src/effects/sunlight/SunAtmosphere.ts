import { SUN_TUNING_DEFAULTS, SUN_ATMOSPHERE_KEYFRAMES, type SunTuning } from '../../config/sunlight';
export { SUN_ATMOSPHERE_KEYFRAMES } from '../../config/sunlight';

const keys = Object.keys(SUN_TUNING_DEFAULTS) as (keyof SunTuning)[];
type MutableValues = Record<keyof SunTuning, number | number[] | null>;

export function createSunTuning(): SunTuning {
  const result = {} as MutableValues;
  for(const key of keys) { const v=SUN_TUNING_DEFAULTS[key]; result[key]=Array.isArray(v)?[...v]:v as number; }
  return result as SunTuning;
}

/** Time-setting transitions share the paused/stepped scenario clock. The same
 * presentation minute must also drive the ordinary ambient light. */
export class SunAtmosphereClock {
  private target = NaN;
  private start = 0;
  private since = 0;
  private current = 0;
  private lastTime = 0;
  reset(): void { this.target=NaN; }
  resolve(minute: number, timeMs: number): number {
    if(!Number.isFinite(timeMs)) timeMs=0;
    const m=Number.isFinite(minute)?((minute%1440)+1440)%1440:0;
    if(!Number.isFinite(this.target)) { this.target=m;this.current=m;this.start=m;this.since=timeMs; }
    // Allow authored fast transitions at low FPS (up to 120 minutes/second),
    // but do not interpret a long pause or a large clock jump as continuous drift.
    const elapsed=Math.max(0,Math.min(500,timeMs-this.lastTime));this.lastTime=timeMs;
    if(m!==this.target) {
      const advance=((m-this.target+2160)%1440)-720;
      // Repliziert fortlaufende Uhr (auch Mitternacht): nicht jeden Frame eine
      // neue 800-ms-Blende starten, sonst bleibt die Darstellung stehen.
      if(Math.abs(advance)<=Math.max(5,elapsed*.12)) {this.start+=advance;this.current+=advance;this.target=m;}
      else {this.start=this.current;this.target=m;this.since=timeMs;}
    }
    let t=Math.max(0,Math.min(1,(timeMs-this.since)/800));t=t*t*(3-2*t);
    const distance=((this.target-this.start+2160)%1440)-720;
    this.current=((this.start+distance*t)%1440+1440)%1440;
    return this.current;
  }
}

/** Reuses the object and every vector. Override edits are validated by the API;
 * clock ticks touch numeric values only. Smooth cyclic interpolation, including
 * negative/unwrapped minutes; invalid input falls back to midnight. */
export function resolveSunAtmosphere(minute: number, out: SunTuning, overrides: Partial<SunTuning> = {}): boolean {
  const m=Number.isFinite(minute)?((minute%1440)+1440)%1440:0;
  let a=SUN_ATMOSPHERE_KEYFRAMES[SUN_ATMOSPHERE_KEYFRAMES.length-1], b=SUN_ATMOSPHERE_KEYFRAMES[0];
  for(let i=0;i<SUN_ATMOSPHERE_KEYFRAMES.length-1;i++) {
    if(m>=SUN_ATMOSPHERE_KEYFRAMES[i].minute && m<SUN_ATMOSPHERE_KEYFRAMES[i+1].minute) {
      a=SUN_ATMOSPHERE_KEYFRAMES[i];b=SUN_ATMOSPHERE_KEYFRAMES[i+1];break;
    }
  }
  const span=(b.minute-a.minute+1440)%1440;
  let t=((m-a.minute+1440)%1440)/span; t=t*t*(3-2*t);
  const target=out as MutableValues; let changed=false;
  for(const key of keys) {
    if(key==='sunAzimuthOverride') {
      const value=overrides.sunAzimuthOverride??null;
      changed ||= target[key]!==value;target[key]=value;continue;
    }
    const av=a.values[key],bv=b.values[key],override=overrides[key];
    if(Array.isArray(av)) {
      const vector=target[key] as number[];
      for(let i=0;i<3;i++) {
        const value=override ? (override as readonly number[])[i] : av[i]+((bv as readonly number[])[i]-av[i])*t;
        changed ||= vector[i]!==value; vector[i]=value;
      }
    } else {
      const value=override ?? (av as number)+((bv as number)-(av as number))*t;
      changed ||= target[key]!==value; target[key]=value as number;
    }
  }
  return changed;
}
