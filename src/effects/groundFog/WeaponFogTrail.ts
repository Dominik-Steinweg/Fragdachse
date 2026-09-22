import { WEAPON_CONFIGS, UTILITY_CONFIGS, ULTIMATE_CONFIGS } from '../../loadout/LoadoutConfig';
import type { FogTrailModifiers } from '../../config/fogTrail';

const DEFAULTS: FogTrailModifiers = Object.freeze({});
/** Resolve authored presentation from the exact source ID, never from a shared visual style. */
export function weaponFogTrail(sourceId?: string): FogTrailModifiers {
  return sourceId ? WEAPON_CONFIGS[sourceId] ?? UTILITY_CONFIGS[sourceId] ?? ULTIMATE_CONFIGS[sourceId] ?? DEFAULTS : DEFAULTS;
}
