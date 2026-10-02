/** Optical response only; never changes fog density, coverage or formation geometry. */
export const FOG_ROCK_LIGHTING = {
  contactStrength: .34,
  sunShadowStrength: .14,
  aerialStrength: .20,
  // Ignore clear-air haze; fade in only with a visible bank's optical coverage.
  aerialHazeOpacity: .10,
  aerialFullOpacity: .35,
  // Broad angular penumbra for scattering near the floor, in radians.
  sunSoftness: .06,
  maxStrength: .5,
} as const;

export interface FogRockLightingOptions {
  fogRockContactStrength?: number;
  fogRockSunShadowStrength?: number;
  /** Local fog radiance on mineral surfaces; enabled by default, debug overrides are temporary. */
  rockAerialPerspective?: boolean;
  rockAerialPerspectiveStrength?: number;
}

/** Shared by the dev API and the renderer boundary. Omitted values reset to defaults. */
export function resolveFogRockLighting(options: FogRockLightingOptions = {}): [number, number] {
  const values: [number, number] = [options.fogRockContactStrength ?? FOG_ROCK_LIGHTING.contactStrength,
    options.fogRockSunShadowStrength ?? FOG_ROCK_LIGHTING.sunShadowStrength];
  for (const value of values) if (!Number.isFinite(value) || value < 0 || value > FOG_ROCK_LIGHTING.maxStrength)
    throw new Error(`Fog rock strength: 0…${FOG_ROCK_LIGHTING.maxStrength} erwartet.`);
  return values;
}

export function resolveRockAerialPerspective(options: FogRockLightingOptions = {}): number {
  const strength=options.rockAerialPerspectiveStrength??FOG_ROCK_LIGHTING.aerialStrength;
  if(options.rockAerialPerspective!==undefined&&typeof options.rockAerialPerspective!=='boolean')
    throw new Error('rockAerialPerspective: Boolean erwartet.');
  if(!Number.isFinite(strength)||strength<0||strength>FOG_ROCK_LIGHTING.maxStrength)
    throw new Error(`Rock aerial strength: 0…${FOG_ROCK_LIGHTING.maxStrength} erwartet.`);
  return options.rockAerialPerspective!==false?strength:0;
}
