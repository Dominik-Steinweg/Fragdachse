import type { SunCloudState } from '../../effects/sunlight/cloudShadow';
import { normalizeTimeOfDay, resolveSkyState } from '../../effects/TimeOfDay';
import { resolveDaylightStrength } from '../../effects/sunlight/SunSky';
/** Shared mineral material state; the world owner supplies time and sunlight. */
export interface RockLightingState {
 enabled: boolean; normals: boolean; strength: number; sun: [number,number,number];
 material?: 'original' | 'mineral'; colourTextureKey?: string; mineralResponse?: boolean;
 clouds?: SunCloudState; selfShadow?: boolean; softShadow?: boolean; castShadow?: boolean;
}
export function updateRockLightingSun(state: Pick<RockLightingState, 'strength' | 'sun' | 'clouds'>, minutes: number): void {
  const time = normalizeTimeOfDay(minutes);
  const path=state.clouds?.sunPath;
  if(path) {
    state.strength=resolveDaylightStrength(time);
    state.sun[0]=path.sun[0];state.sun[1]=path.sun[1];state.sun[2]=path.sun[2];return;
  }
  const sky = resolveSkyState(time);
  state.strength = resolveDaylightStrength(time);
  // Follow the existing shadow-length curve and fixed azimuth; there is no second clock.
  const elevation = Math.atan(1 / Math.max(.1, sky.shadowLengthMult));
  const horizontal = -Math.SQRT1_2 * Math.cos(elevation);
  state.sun[0] = horizontal; state.sun[1] = horizontal; state.sun[2] = Math.sin(elevation);
}
