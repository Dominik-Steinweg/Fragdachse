import type { WorldGrade } from '../postfx/worldGrade';
import { SUN_TUNING_LIMITS as LIMITS, type SunTuning } from '../../config/sunlight';
export { SUN_TUNING_DEFAULTS, type SunTuning } from '../../config/sunlight';

export function validateSunTuning(value: unknown): Partial<SunTuning> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('sunTuning.values: Objekt erwartet.');
  const patch: Record<string, number | number[] | null> = {};
  const valid = (n: unknown, min: number, max: number): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  for (const [key, entry] of Object.entries(value)) {
    if(key==='sunAzimuthOverride') {
      if(entry!==null&&!valid(entry,-360,360))throw new Error('sunAzimuthOverride: null oder endliche Gradzahl von -360 bis 360 erwartet.');
      patch[key]=entry;
    } else if (key === 'shade' || key === 'sun' || key === 'raysColor' || key === 'fogShade' || key === 'fogSun' || key === 'cloudCanopyShade') {
      if (!Array.isArray(entry) || entry.length !== 3 || !entry.every(n => valid(n, 0, key === 'shade' || key === 'sun' ? 2 : 1)))
        throw new Error(`sunTuning.${key}: drei endliche Farbwerte im gültigen Bereich erwartet.`);
      patch[key] = [...entry];
    } else {
      const range = LIMITS[key as keyof typeof LIMITS];
      if (!range || !valid(entry, range[0], range[1])) throw new Error(`sunTuning.${key}: ungültiger Wert.`);
      patch[key] = entry;
    }
  }
  return patch;
}

export function sunAtmosphereGrade(t: SunTuning, out: { -readonly [K in keyof WorldGrade]?: WorldGrade[K] } = {}): Partial<WorldGrade> {
  out.temperature=t.gradeTemperature;out.contrast=t.gradeContrast;out.brightness=t.gradeBrightness;
  out.saturation=t.gradeSaturation;out.bloomThreshold=t.gradeBloomThreshold;out.bloomAmount=t.gradeBloomAmount;
  return out;
}
