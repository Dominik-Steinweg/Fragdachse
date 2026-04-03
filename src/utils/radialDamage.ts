import type { ProjectileExplosionConfig, RadialDamageFalloffConfig } from '../types';

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

export function computeRadialDamage(
  distance: number,
  radius: number,
  maxDamage: number,
  falloff?: RadialDamageFalloffConfig,
): number {
  if (maxDamage <= 0) return 0;
  if (distance > radius) return 0;
  if (!falloff) return maxDamage;

  const safeRadius = Math.max(1, radius);
  const minDamage = Math.max(0, Math.min(maxDamage, falloff.minDamage));
  const t = clamp01(distance / safeRadius);
  return lerp(maxDamage, minDamage, t);
}

export function computeProjectileExplosionDamage(distance: number, effect: ProjectileExplosionConfig): number {
  return computeRadialDamage(
    distance,
    effect.radius,
    effect.maxDamage,
    effect.minDamage === undefined ? undefined : { minDamage: effect.minDamage },
  );
}