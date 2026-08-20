import type { DirectCircleHitResult } from './DirectCombatHitResolver';

export interface ProjectileTargetImpactParams {
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly radius: number;
  /** Runtime-Projektile ignorieren einen Treffer direkt am Spawnpunkt. */
  readonly ignoreStartingOverlap?: boolean;
}

/** Runtime-Charakterisierung: Schnittpunkte direkt am Sweep-Start werden bis 0.01px ignoriert. */
const RUNTIME_STARTING_INTERSECTION_EPSILON_PX = 0.01;

/**
 * Gemeinsamer, Phaser-freier Resolver fuer einen Projektil-Sweep gegen ein Kreisziel.
 *
 * Der Headless-Benchmark verwendet den Resolver mit Starting-Overlap-Semantik; der Runtime-
 * Pfad kann die bestehende Selbsttreffer-Sperre ueber `ignoreStartingOverlap` beibehalten.
 * Flugsteuerung, Bounces, Hindernisse und Impact-Effekte bleiben bewusst beim jeweiligen
 * Orchestrator.
 */
export function resolveProjectileTargetImpact(
  params: ProjectileTargetImpactParams,
): DirectCircleHitResult | null {
  const {
    startX,
    startY,
    endX,
    endY,
    targetX,
    targetY,
    radius,
    ignoreStartingOverlap = false,
  } = params;
  const dx = endX - startX;
  const dy = endY - startY;
  const fx = startX - targetX;
  const fy = startY - targetY;
  const a = dx * dx + dy * dy;
  const startOffsetX = targetX - startX;
  const startOffsetY = targetY - startY;

  if (radius >= 0 && startOffsetX * startOffsetX + startOffsetY * startOffsetY <= radius * radius && !ignoreStartingOverlap) {
    return { hit: true, distance: 0, x: startX, y: startY };
  }
  if (a < 1e-9) return null;

  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const sqrtDisc = Math.sqrt(discriminant);
  const segmentLength = Math.sqrt(a);
  const minimumHitT = ignoreStartingOverlap && segmentLength > 1e-9
    ? RUNTIME_STARTING_INTERSECTION_EPSILON_PX / segmentLength
    : 0;
  const denominator = 2 * a;
  // Die Minus-Wurzel ist bei a > 0 bereits die kleinere der beiden Lösungen. Die
  // explizite Auswahl erhält die bisherige sort/find-Semantik ohne Array-Allokation.
  const firstRoot = (-b - sqrtDisc) / denominator;
  const secondRoot = (-b + sqrtDisc) / denominator;
  const tHit = firstRoot >= minimumHitT && firstRoot <= 1
    ? firstRoot
    : secondRoot >= minimumHitT && secondRoot <= 1
      ? secondRoot
      : undefined;
  if (tHit === undefined) return null;

  const hitX = startX + tHit * dx;
  const hitY = startY + tHit * dy;
  return {
    hit: true,
    distance: Math.hypot(hitX - startX, hitY - startY),
    x: hitX,
    y: hitY,
  };
}
