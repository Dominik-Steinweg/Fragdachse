export function getRageGeneratingDamage(
  hpLost: number,
  armorLost: number,
  includeArmorDamage: boolean,
): number {
  return Math.max(0, hpLost) + (includeArmorDamage ? Math.max(0, armorLost) : 0);
}
