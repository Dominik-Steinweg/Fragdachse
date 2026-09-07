import type { CombatDamageKind } from '../../types';

/** Impact feedback only; periodic damage and generic reactions never hold an enemy in place. */
export function resolveEnemyHitStaggerDuration(
  damageKind: CombatDamageKind,
  knockbackFactor: number,
  baseDurationMs: number,
): number {
  if (damageKind !== 'direct' && damageKind !== 'explosion' && damageKind !== 'chain' && damageKind !== 'reflect') return 0;
  if (!Number.isFinite(baseDurationMs) || baseDurationMs <= 0
    || !Number.isFinite(knockbackFactor) || knockbackFactor <= 0) return 0;
  return baseDurationMs * Math.max(1 / 3, Math.min(2, knockbackFactor));
}
