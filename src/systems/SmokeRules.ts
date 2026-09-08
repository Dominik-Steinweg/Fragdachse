import type { ProjectileHomingConfig } from '../types';

/** Authored smoke tuning, resolved once at throw time. */
export interface SmokeBehaviorConfig {
  readonly confusionFraction: number;
  readonly aftereffectMs: number;
  readonly directionMinMs: number;
  readonly directionMaxMs: number;
  readonly recoveryFadeMs: number;
  readonly retentionBias: number;
  readonly retentionEdgeFraction: number;
  readonly nearSightPx: number;
  readonly bossNearSightPx: number;
  readonly bossConfusionFactor: number;
  readonly bossAftereffectFactor: number;
  readonly vulnerabilityEnabled: number;
  readonly chargeDurationMs: number;
  readonly dischargeCount: number;
  readonly dischargeCooldownMs: number;
  readonly dischargeDamage: number;
  readonly dischargeSpeed: number;
  readonly dischargeRange: number;
  readonly dischargeSize: number;
  readonly dischargeHoming: ProjectileHomingConfig;
  readonly growthMaxProcs: number;
  readonly growthDurationMs: number;
  readonly growthRadiusFraction: number;
  readonly growthTransitionMs: number;
}

export interface SmokeConfusionInfluence {
  readonly cloudId: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly fraction: number;
  readonly retentionBias: number;
  readonly edgeFraction: number;
  readonly directionMinMs: number;
  readonly directionMaxMs: number;
}

export interface SmokePerceptionPort {
  getConfusion(enemyId: string, now: number): SmokeConfusionInfluence | null;
  canSee(enemyId: string, x: number, y: number, targetX: number, targetY: number, range: number, now: number): boolean;
}

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
export const smoothSmokeGrowth = (value: number): number => { const t = clamp01(value); return t * t * (3 - 2 * t); };
