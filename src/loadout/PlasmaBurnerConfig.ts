/** Authored tuning. Upgrades change flags/levels, never duplicate these tables. */
export interface PlasmaBurnerConfig {
  readonly overloadEnabled: number;
  readonly chainEnabled: number;
  readonly capacitorLevel: number;
  readonly retentionLevel: number;
  readonly cascadeLevel: number;
  readonly couplingLevel: number;
  readonly chargesLevel: number;
  readonly targetLockLevel: number;
  readonly qMaxByLevel: readonly number[];
  readonly decayPerSecondByLevel: readonly number[];
  readonly jumpsByLevel: readonly number[];
  readonly couplingRadiusByLevel: readonly number[];
  readonly intervalSecondsByLevel: readonly number[];
  readonly toleranceDegreesByLevel: readonly number[];
  readonly buildPerSecond: number;
  readonly secondaryFactor: number;
  readonly secondaryOverloadWeight: number;
  readonly contactToleranceMs: number;
  readonly chargeDamage: number;
  readonly chargeHeal: number;
  readonly chargeSearchRadius: number;
  readonly chargeSpeed: number;
  readonly chargeTurnDegreesPerSecond: number;
  readonly chargeLifetimeMs: number;
  readonly outboundMs: number;
  readonly size: number;
}

export const PLASMA_BURNER_LEVEL_TABLES = {
  capacitorLevel: 'qMaxByLevel', retentionLevel: 'decayPerSecondByLevel',
  cascadeLevel: 'jumpsByLevel', couplingLevel: 'couplingRadiusByLevel',
  chargesLevel: 'intervalSecondsByLevel', targetLockLevel: 'toleranceDegreesByLevel',
} as const;

export function resolvePlasmaBurnerStats(config: PlasmaBurnerConfig) {
  return {
    ...config,
    qMax: config.overloadEnabled ? config.qMaxByLevel[config.capacitorLevel] : 0,
    decayPerSecond: config.decayPerSecondByLevel[config.retentionLevel],
    maxJumps: config.chainEnabled ? config.jumpsByLevel[config.cascadeLevel] : 0,
    couplingRadius: config.couplingRadiusByLevel[config.couplingLevel],
    chargeIntervalSeconds: config.chargesLevel ? config.intervalSecondsByLevel[config.chargesLevel - 1] : 0,
    lockToleranceDegrees: config.targetLockLevel ? config.toleranceDegreesByLevel[config.targetLockLevel - 1] : 0,
  };
}
export type PlasmaBurnerStats = ReturnType<typeof resolvePlasmaBurnerStats>;

export function validatePlasmaBurnerConfig(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['plasmaBurner: object required'];
  const c = value as Record<string, unknown>;
  const issues: string[] = [];
  for (const field of ['overloadEnabled', 'chainEnabled']) {
    if (c[field] !== 0 && c[field] !== 1) issues.push(`plasmaBurner.${field}: flag required`);
  }
  for (const [level, table] of Object.entries(PLASMA_BURNER_LEVEL_TABLES)) {
    const values = c[table];
    const activated = level === 'chargesLevel' || level === 'targetLockLevel';
    if (!Array.isArray(values) || values.length !== (activated ? 3 : 4)
      || values.some(n => typeof n !== 'number' || !Number.isFinite(n) || n <= 0
        || (table === 'jumpsByLevel' && !Number.isSafeInteger(n)))) {
      issues.push(`plasmaBurner.${table}: positive level table required`);
    }
    if (!Number.isSafeInteger(c[level]) || Number(c[level]) < 0
      || !Array.isArray(values) || Number(c[level]) > values.length - (activated ? 0 : 1)) {
      issues.push(`plasmaBurner.${level}: level out of range`);
    }
  }
  for (const field of ['buildPerSecond', 'secondaryFactor', 'secondaryOverloadWeight', 'contactToleranceMs',
    'chargeDamage', 'chargeHeal', 'chargeSearchRadius', 'chargeSpeed', 'chargeTurnDegreesPerSecond',
    'chargeLifetimeMs', 'outboundMs', 'size']) {
    if (typeof c[field] !== 'number' || !Number.isFinite(c[field]) || Number(c[field]) < 0)
      issues.push(`plasmaBurner.${field}: nonnegative finite number required`);
  }
  if (Number(c.secondaryFactor) > 1 || Number(c.secondaryOverloadWeight) > 1
    || Number(c.size) <= 0 || Number(c.chargeSpeed) <= 0 || Number(c.chargeLifetimeMs) <= Number(c.outboundMs))
    issues.push('plasmaBurner: invalid bounds');
  return issues;
}
