import type { CoopDefenseEnemyKaboomtulaConfig } from '../config/coopDefenseEnemies';

type SkitterConfig = CoopDefenseEnemyKaboomtulaConfig['skitter'];
type LeapConfig = CoopDefenseEnemyKaboomtulaConfig['leap'];

/** The spider's rush at one moment: a smooth sideways weave around the route heading. */
export interface SkitterWeave {
  /** Signed offset from the route heading in radians. */
  readonly angle: number;
  readonly speedFactor: number;
}

/** Deterministic value in [0, 1) per body, segment and salt (FNV-1a). */
function unitHash(id: string, index: number, salt: number): number {
  let hash = 2166136261 ^ Math.imul(index + 1, 2654435761) ^ salt;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
  return ((hash ^ (hash >>> 13)) >>> 0) / 4294967296;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const TAU = Math.PI * 2;

/**
 * Spider-like rush: a continuous sideways weave with a per-body rhythm and a faint second harmonic,
 * plus a scurry surge that peaks while the body crosses its route. No hard turns and no freezes, so
 * the run stays readable and dodgeable (gameplay before realism). Pure and deterministic per body
 * and elapsed rush time.
 */
export function skitterWeave(enemyId: string, elapsedMs: number, config: SkitterConfig): SkitterWeave {
  const period = lerp(config.weavePeriodMinMs, config.weavePeriodMaxMs, unitHash(enemyId, 0, 1));
  const phase = TAU * Math.max(0, elapsedMs) / period;
  const side = unitHash(enemyId, 0, 2) < 0.5 ? 1 : -1;
  const accent = TAU * unitHash(enemyId, 0, 3);
  // The harmonic is offset by its own start value so every rush leaves straight along its route.
  const sway = 0.84 * Math.sin(phase) + 0.16 * (Math.sin(2.37 * phase + accent) - Math.sin(accent));
  return {
    angle: side * config.weaveDegrees * Math.PI / 180 * sway,
    speedFactor: 1 + config.surge * Math.cos(2 * phase),
  };
}

/** Zig amplitude near the target fades linearly to a third, so the spider still closes in. */
export function skitterAmplitude(distance: number, config: SkitterConfig): number {
  if (config.calmWithinPx <= 0 || distance >= config.calmWithinPx) return 1;
  return 1 / 3 + 2 / 3 * Math.max(0, distance) / config.calmWithinPx;
}

export interface Point { readonly x: number; readonly y: number }

/** Locked leap lane: aim point with velocity lead, overshoot and the world-clipped length. */
export interface LeapLaneLock {
  readonly angle: number;
  readonly length: number;
  /** Distance from the origin to the aimed point (without overshoot). */
  readonly aimDistance: number;
  readonly endX: number;
  readonly endY: number;
}

/**
 * Aim the leap where the target will be after `leadFactor` of the flight time, extend it by the
 * overshoot, cap it and clip it by world geometry. Null when the clipped lane cannot even reach
 * the target's body (a blocked leap is no leap).
 */
export function lockLeapLane(origin: Point, target: Point, velocity: Point, targetReachPx: number, config: LeapConfig,
  clearance: (angle: number, length: number) => number): LeapLaneLock | null {
  const leadS = config.airMs / 1000 * config.leadFactor;
  const aimX = target.x + velocity.x * leadS, aimY = target.y + velocity.y * leadS;
  const dx = aimX - origin.x, dy = aimY - origin.y;
  const aimDistance = Math.hypot(dx, dy);
  if (aimDistance < 1e-3) return null;
  const angle = Math.atan2(dy, dx);
  const wanted = Math.min(config.maxLengthPx, aimDistance + config.overshootPx);
  const length = Math.min(wanted, clearance(angle, wanted));
  const targetDistance = Math.hypot(target.x - origin.x, target.y - origin.y);
  if (length < Math.min(aimDistance, targetDistance) - targetReachPx) return null;
  return { angle, length, aimDistance, endX: origin.x + Math.cos(angle) * length, endY: origin.y + Math.sin(angle) * length };
}

export function closestOnSegment(ax: number, ay: number, bx: number, by: number, px: number, py: number): Point {
  const dx = bx - ax, dy = by - ay, lengthSq = dx * dx + dy * dy;
  const t = lengthSq <= 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return { x: ax + dx * t, y: ay + dy * t };
}
