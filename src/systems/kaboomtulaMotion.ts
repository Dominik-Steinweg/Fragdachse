import type { CoopDefenseEnemyKaboomtulaConfig } from '../config/coopDefenseEnemies';

type SkitterConfig = CoopDefenseEnemyKaboomtulaConfig['skitter'];
type LeapConfig = CoopDefenseEnemyKaboomtulaConfig['leap'];

/** One leg of the spider's rush: a straight dart or an angled zig, optionally followed by a freeze. */
export interface SkitterSegment {
  readonly durationMs: number;
  /** Signed offset from the route heading in radians (0 for a dart). */
  readonly angle: number;
  readonly speedFactor: number;
  readonly pauseMs: number;
}

/** Deterministic value in [0, 1) per body, segment and salt (FNV-1a). */
function unitHash(id: string, index: number, salt: number): number {
  let hash = 2166136261 ^ Math.imul(index + 1, 2654435761) ^ salt;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
  return ((hash ^ (hash >>> 13)) >>> 0) / 4294967296;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Spider-like rush pattern: segments alternate sides, some are straight darts, some end in a short
 * freeze. Pure and deterministic per body so the host can replay a segment after any frame.
 */
export function skitterSegment(enemyId: string, index: number, config: SkitterConfig): SkitterSegment {
  const dart = unitHash(enemyId, index, 2) < config.dartChance;
  const side = index % 2 === 0 ? 1 : -1;
  const degrees = lerp(config.zigMinDegrees, config.zigMaxDegrees, unitHash(enemyId, index, 3));
  const pause = unitHash(enemyId, index, 4) < config.pauseChance;
  return {
    durationMs: Math.round(lerp(config.segmentMinMs, config.segmentMaxMs, unitHash(enemyId, index, 1))),
    angle: dart ? 0 : side * degrees * Math.PI / 180,
    speedFactor: dart ? config.dartSpeedFactor : 1,
    pauseMs: pause ? Math.round(lerp(config.pauseMinMs, config.pauseMaxMs, unitHash(enemyId, index, 5))) : 0,
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
