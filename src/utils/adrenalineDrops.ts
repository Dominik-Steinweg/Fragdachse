export function getAdrenalineSyringeDropChance(
  enemyXp: number,
  mapXpTotal: number,
  chanceMultiplier = 1,
): number {
  const chance = (Math.max(0, enemyXp) * 2 / Math.max(1, mapXpTotal))
    * Math.max(0, chanceMultiplier);
  return Math.max(0, Math.min(1, chance));
}
