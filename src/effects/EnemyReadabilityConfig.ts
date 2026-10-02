/** Screen-pixel tuning. This is a world contour, never an emissive halo. */
export const ENEMY_READABILITY = {
  darkWidth: 1.4,
  lightWidth: 1.0,
  darkAlpha: 0.62,
  lightAlpha: 0.38,
  darkColor: [0.19, 0.175, 0.155] as const,
  lightColor: [0.78, 0.75, 0.65] as const,
  nightStrength: 0.25,
  // Same narrow, two-sided tangential bridge as the player's outer-silhouette mask.
  bridgeFraction: 0.045,
} as const;

/** The shared sky-derived emissive scale is 0.55 at noon and 1 at night, independent of clouds. */
export function enemyContourStrength(emissiveScale: number): number {
  const daylight = Math.max(0, Math.min(1, (1 - emissiveScale) / 0.45));
  const smooth = daylight * daylight * (3 - 2 * daylight);
  return ENEMY_READABILITY.nightStrength + (1 - ENEMY_READABILITY.nightStrength) * smooth;
}
