import authored from './coopDefenseTurrets.json';

/** Only automatic turret damage against hostile bases; figure/terrain damage is unchanged. */
export function validateCoopDefenseTurretRules(rules: typeof authored): void {
  if (!Number.isFinite(rules.baseDamageMultiplier) || rules.baseDamageMultiplier < 0) {
    throw new Error('[coopDefenseTurrets] Invalid baseDamageMultiplier');
  }
}
validateCoopDefenseTurretRules(authored);
export const COOP_DEFENSE_TURRET_RULES = Object.freeze(authored);
