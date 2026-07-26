/**
 * Returns the multiplier for a mini-rocket explosion after the given number
 * of completed explosions. The initial explosion intentionally has no bonus.
 */
export function getMiniRocketCascadeMultiplier(
  explosionIndex: number,
  bonusPerExplosion: number,
): number {
  return 1
    + Math.max(0, explosionIndex) * Math.max(0, bonusPerExplosion);
}
