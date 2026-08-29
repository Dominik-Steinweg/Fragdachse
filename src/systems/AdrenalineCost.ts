/**
 * Gemeinsame reine Kosten-Semantik fuer Client-Gate, Host-Gate, HUD und Drain.
 * AK47 Fire Superiority wird vom aufrufenden Weapon2-Pfad als baseCost = 0 uebergeben.
 */
export function resolveEffectiveAdrenalineCost(
  baseCost: number,
  costMultiplier = 1,
): number {
  if (baseCost <= 0) return 0;
  return baseCost * Math.max(0, costMultiplier);
}
