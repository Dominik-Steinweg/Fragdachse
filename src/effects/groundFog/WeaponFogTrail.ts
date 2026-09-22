import { WEAPON_CONFIGS, UTILITY_CONFIGS, ULTIMATE_CONFIGS } from '../../loadout/LoadoutConfig';
import { fogTrailFactor, type FogTrailModifiers } from '../../config/fogTrail';
import { FOG } from './FogConfig';
import type { FogTrailProfile } from './FogTrailSegments';

const DEFAULTS: FogTrailModifiers = Object.freeze({});
/** Resolve authored presentation from the exact source ID, never from a shared visual style. */
export function weaponFogTrail(sourceId?: string): FogTrailModifiers {
  return sourceId ? WEAPON_CONFIGS[sourceId] ?? UTILITY_CONFIGS[sourceId] ?? ULTIMATE_CONFIGS[sourceId] ?? DEFAULTS : DEFAULTS;
}

export function createWeaponFogTrailProfile(radius: number, strength: number, modifiers: FogTrailModifiers, arcDegrees?: number): FogTrailProfile | null {
  const width = fogTrailFactor(modifiers.fogTrailWidthFactor), duration = fogTrailFactor(modifiers.fogTrailDurationFactor);
  if (!width || !duration) return null;
  return { radius: radius * width, strength, lifeMs: FOG.trailMs * duration, decayMs: FOG.trailDecayMs * duration, arcDegrees };
}
