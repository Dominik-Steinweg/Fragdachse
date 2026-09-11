import authored from './mgTurret.json';

for (const [key, value] of Object.entries(authored)) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`[mgTurret] Invalid ${key}`);
}
export const MG_TURRET_RULES = Object.freeze(authored);
