/** Resolved tuning captured by one primary-cloud activation. */
export interface StinkPlagueConfig {
  readonly damagePerTick: number;
  readonly tickIntervalMs: number;
  readonly directDurationMs: number;
  readonly firstGenerationDurationMs: number;
  readonly secondGenerationDurationMs: number;
  readonly spreadIntervalMs: number;
  readonly searchRadius: number;
  readonly contactGap: number;
  readonly lifeLeechFraction: number;
  readonly pandemicEnabled: number;
  readonly vulnerabilityEnabled: number;
  readonly deathChunkCount: number;
  readonly combatMoveSpeedBonus: number;
  readonly combatDamageReduction: number;
}

export const STINK_PLAGUE_FIELDS = [
  'damagePerTick', 'tickIntervalMs', 'directDurationMs', 'firstGenerationDurationMs',
  'secondGenerationDurationMs', 'spreadIntervalMs', 'searchRadius', 'contactGap',
  'lifeLeechFraction', 'pandemicEnabled', 'vulnerabilityEnabled', 'deathChunkCount',
  'combatMoveSpeedBonus', 'combatDamageReduction',
] as const satisfies readonly (keyof StinkPlagueConfig)[];

export function validateStinkPlagueConfig(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['$.plague: complete tuning required'];
  const value = raw as Record<string, unknown>;
  const issues: string[] = [];
  for (const key of STINK_PLAGUE_FIELDS) {
    const n = value[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) issues.push(`$.plague.${key}: nonnegative finite number required`);
  }
  for (const key of ['tickIntervalMs', 'directDurationMs', 'firstGenerationDurationMs',
    'secondGenerationDurationMs', 'spreadIntervalMs', 'searchRadius'] as const) {
    if (!(Number(value[key]) > 0)) issues.push(`$.plague.${key}: positive value required`);
  }
  for (const key of ['lifeLeechFraction', 'combatDamageReduction'] as const) {
    if (Number(value[key]) > 1) issues.push(`$.plague.${key}: expected fraction`);
  }
  for (const key of ['pandemicEnabled', 'vulnerabilityEnabled'] as const) {
    if (value[key] !== 0 && value[key] !== 1) issues.push(`$.plague.${key}: expected zero or one`);
  }
  if (!Number.isSafeInteger(value.deathChunkCount)) issues.push('$.plague.deathChunkCount: integer required');
  return issues;
}
