import type { ProjectileExplosionConfig } from '../types';

/** Authored rocket tuning; upgrade descriptors change only the enabled levels. */
export interface RocketLauncherConfig {
  readonly jumpMultiplier: number;
  readonly healFraction: number;
  readonly pressureShieldDurationMs: number;
  readonly pressureShieldReduction: number;
  readonly distanceLevel: number;
  readonly distanceBonusPerLevel: number;
  readonly distanceForMaxBonus: number;
  readonly magazineLevel: number;
  readonly magazineCapacities: readonly number[];
  readonly salvoAngleDegrees: number;
  readonly focusAngleFactor: number;
  readonly aftershockEnabled: number;
  readonly chunkCount: number;
  readonly targetedChunks: number;
  readonly chunkFlightMs: number;
  readonly groundDurationMs: number;
  readonly burnDurationMs: number;
  readonly burnDamagePerTick: number;
  readonly aftershockRadius: number;
  readonly aftershockMaxDamage: number;
  readonly aftershockMinDamage: number;
}

export function rocketMagazineCapacity(config: RocketLauncherConfig): number {
  return config.magazineLevel > 0 ? config.magazineCapacities[config.magazineLevel - 1] ?? 1 : 1;
}

export function rocketSalvoAngles(count: number, angle: number, spacingDegrees: number, focusFactor = 1): number[] {
  const half = Math.floor(count / 2);
  const steps = Array.from({ length: half }, (_, i) => i + 1);
  return [...steps.map(i => -i).reverse(), ...(count % 2 ? [0] : []), ...steps]
    .map(i => angle + i * spacingDegrees * Math.PI / 180 * focusFactor);
}

export function resolveRocketExplosion(effect: ProjectileExplosionConfig, rocket: RocketLauncherConfig): ProjectileExplosionConfig {
  const support = { healFraction: rocket.healFraction, pressureShieldDurationMs: rocket.pressureShieldDurationMs,
    pressureShieldReduction: rocket.pressureShieldReduction };
  return {
    ...effect,
    selfKnockbackMult: (effect.selfKnockbackMult ?? 1) * rocket.jumpMultiplier,
    rocketSupport: support,
    fireChunkBurst: rocket.aftershockEnabled > 0 ? {
      count: rocket.chunkCount, searchRadius: effect.radius, flightMs: rocket.chunkFlightMs,
      igniteCenter: false, durationMs: rocket.groundDurationMs, burnDurationMs: rocket.burnDurationMs,
      burnDamagePerTick: rocket.burnDamagePerTick, sourceId: 'ground_fire.rocket_chunks',
      requireLineOfSight: true, targetSurvivors: rocket.targetedChunks > 0,
      landingExplosion: { radius: rocket.aftershockRadius, maxDamage: rocket.aftershockMaxDamage,
        minDamage: rocket.aftershockMinDamage, knockback: 0, selfDamageMult: 0,
        excludeFriendlyPlayers: true, visualStyle: 'rocket',
        rocketSupport: { ...support, healFraction: 0 } },
    } : undefined,
  };
}

export function validateRocketLauncherConfig(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['rocketLauncher: object required'];
  const r = value as Record<string, unknown>;
  const fields = ['jumpMultiplier','healFraction','pressureShieldDurationMs','pressureShieldReduction','distanceLevel',
    'distanceBonusPerLevel','distanceForMaxBonus','magazineLevel','salvoAngleDegrees','focusAngleFactor',
    'aftershockEnabled','chunkCount','targetedChunks','chunkFlightMs','groundDurationMs','burnDurationMs',
    'burnDamagePerTick','aftershockRadius','aftershockMaxDamage','aftershockMinDamage'];
  const issues = fields.filter(key => typeof r[key] !== 'number' || !Number.isFinite(r[key]) || Number(r[key]) < 0)
    .map(key => `rocketLauncher.${key}: nonnegative finite number required`);
  if (!Array.isArray(r.magazineCapacities) || r.magazineCapacities.length !== 3
    || r.magazineCapacities.some(n => !Number.isInteger(n) || n < 1)) issues.push('rocketLauncher.magazineCapacities: three positive capacities required');
  if (!(Number(r.distanceForMaxBonus) > 0) || Number(r.pressureShieldReduction) > 1
    || Number(r.focusAngleFactor) > 1 || Number(r.aftershockMinDamage) > Number(r.aftershockMaxDamage)) issues.push('rocketLauncher: invalid bounds');
  for (const key of ['distanceLevel', 'magazineLevel']) {
    if (!Number.isInteger(r[key]) || Number(r[key]) > 3) issues.push(`rocketLauncher.${key}: level out of range`);
  }
  for (const key of ['aftershockEnabled','targetedChunks']) if (r[key] !== 0 && r[key] !== 1) issues.push(`rocketLauncher.${key}: flag required`);
  if (!Number.isInteger(r.chunkCount)) issues.push('rocketLauncher.chunkCount: integer required');
  return issues;
}
