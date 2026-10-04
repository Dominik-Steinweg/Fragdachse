import authored from './mgTurret.json';

export function validateMgTurretRules(rules: typeof authored): void {
  for (const [key, value] of Object.entries(rules)) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`[mgTurret] Invalid ${key}`);
  }
}
validateMgTurretRules(authored);
export const MG_TURRET_RULES = Object.freeze(authored);
