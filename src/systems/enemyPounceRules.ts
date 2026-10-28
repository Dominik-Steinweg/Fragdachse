import type { CoopDefenseEnemyBoundingGaitConfig, CoopDefenseEnemyPounceConfig } from '../config/coopDefenseEnemies';

/**
 * Pure pounce rules shared by the host decision and the client telegraph: landing prediction with
 * lead, air time, target velocity tracking, the bounding gait and per-body timing jitter.
 */

export interface PounceLandingPrediction {
  readonly x: number;
  readonly y: number;
  readonly length: number;
  readonly airMs: number;
}

/** Smoothed velocity estimate of a hunted body from position samples. */
export interface PounceTargetTrack {
  x: number;
  y: number;
  at: number;
  vx: number;
  vy: number;
}

/** Position jumps beyond this between two samples are teleports (dash portals, respawns), not velocity. */
const TRACK_TELEPORT_PX = 64;
/** Blend window of the velocity estimate. */
const TRACK_BLEND_MS = 120;

export function createPounceTargetTrack(x: number, y: number, at: number): PounceTargetTrack {
  return { x, y, at, vx: 0, vy: 0 };
}

export function trackPounceTarget(track: PounceTargetTrack, x: number, y: number, at: number): void {
  const dt = at - track.at;
  if (dt <= 0) return;
  const dx = x - track.x, dy = y - track.y;
  if (Math.hypot(dx, dy) > TRACK_TELEPORT_PX) {
    track.vx = 0; track.vy = 0;
  } else {
    const blend = Math.min(1, dt / TRACK_BLEND_MS);
    track.vx += (dx / dt * 1000 - track.vx) * blend;
    track.vy += (dy / dt * 1000 - track.vy) * blend;
  }
  track.x = x; track.y = y; track.at = at;
}

/** Air time of a flight of `length`: the nominal speed within the authored bounds. */
export function pounceAirMs(length: number, config: Pick<CoopDefenseEnemyPounceConfig, 'airSpeedPx' | 'airMinMs' | 'airMaxMs'>): number {
  return Math.round(Math.max(config.airMinMs, Math.min(config.airMaxMs, length / config.airSpeedPx * 1000)));
}

/**
 * Landing point of a pounce taking off in `takeoffInMs` from the origin: the target's position plus
 * `leadFactor` of its travel until the landing (capped at `maxLeadPx`), kept within the pounce range.
 * The air time depends on the length, so the lead is refined once.
 */
export function predictPounceLanding(originX: number, originY: number, targetX: number, targetY: number,
  velocityX: number, velocityY: number, takeoffInMs: number, config: CoopDefenseEnemyPounceConfig): PounceLandingPrediction {
  let airMs = pounceAirMs(Math.hypot(targetX - originX, targetY - originY), config);
  let x = targetX, y = targetY;
  for (let pass = 0; pass < 2; pass++) {
    const leadS = Math.max(0, takeoffInMs + airMs) / 1000 * config.leadFactor;
    let leadX = velocityX * leadS, leadY = velocityY * leadS;
    const lead = Math.hypot(leadX, leadY);
    if (lead > config.maxLeadPx) { leadX *= config.maxLeadPx / lead; leadY *= config.maxLeadPx / lead; }
    x = targetX + leadX; y = targetY + leadY;
    const clamped = clampToRange(originX, originY, x, y, config.minRangePx, config.maxRangePx);
    x = clamped.x; y = clamped.y;
    airMs = pounceAirMs(Math.hypot(x - originX, y - originY), config);
  }
  return { x, y, length: Math.hypot(x - originX, y - originY), airMs };
}

/**
 * Aim point of an aiming body: the target's position plus a lead offset. The target part follows
 * at once (a straight runner stays met); only the lead offset turns with a speed limit, so a
 * target that changes direction makes the zone swing over instead of flipping across.
 */
export interface PounceReticle {
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  at: number;
}

type ReticleConfig = Pick<CoopDefenseEnemyPounceConfig, 'aimTrackSpeedPx' | 'minRangePx' | 'maxRangePx'>;

export function createPounceReticle(targetX: number, targetY: number, at: number, originX: number, originY: number,
  config: ReticleConfig): PounceReticle {
  const start = clampToRange(originX, originY, targetX, targetY, config.minRangePx, config.maxRangePx);
  return { x: start.x, y: start.y, offsetX: 0, offsetY: 0, at };
}

/** One aim step towards the predicted landing; the lead offset moves at most `aimTrackSpeedPx` per second. */
export function stepPounceReticle(reticle: PounceReticle, targetX: number, targetY: number, predictedX: number, predictedY: number,
  at: number, originX: number, originY: number, config: ReticleConfig): void {
  const step = config.aimTrackSpeedPx * Math.max(0, at - reticle.at) / 1000;
  reticle.at = Math.max(reticle.at, at);
  const dx = predictedX - targetX - reticle.offsetX, dy = predictedY - targetY - reticle.offsetY, distance = Math.hypot(dx, dy);
  if (distance <= step) { reticle.offsetX += dx; reticle.offsetY += dy; }
  else { reticle.offsetX += dx / distance * step; reticle.offsetY += dy / distance * step; }
  const aim = clampToRange(originX, originY, targetX + reticle.offsetX, targetY + reticle.offsetY, config.minRangePx, config.maxRangePx);
  reticle.x = aim.x; reticle.y = aim.y;
}

export function clampToRange(originX: number, originY: number, x: number, y: number, min: number, max: number): { x: number; y: number } {
  const dx = x - originX, dy = y - originY, distance = Math.hypot(dx, dy);
  if (distance < 1e-6) return { x: originX + min, y: originY };
  const clamped = Math.max(min, Math.min(max, distance));
  return { x: originX + dx / distance * clamped, y: originY + dy / distance * clamped };
}

/** Deterministic value in [0, 1) per body, counter and salt (FNV-1a). */
export function pounceUnitHash(id: string, index: number, salt: number): number {
  let hash = 2166136261 ^ Math.imul(index + 1, 2654435761) ^ salt;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
  return ((hash ^ (hash >>> 13)) >>> 0) / 4294967296;
}

/** Speed factor of a bounding run at host time `now`: one pulse per bound, mean 1, rhythm per body. */
export function boundingGaitFactor(enemyId: string, now: number, gait: CoopDefenseEnemyBoundingGaitConfig): number {
  const period = gait.periodMinMs + (gait.periodMaxMs - gait.periodMinMs) * pounceUnitHash(enemyId, 0, 7);
  const offset = period * pounceUnitHash(enemyId, 0, 11);
  return 1 + gait.surge * Math.cos(2 * Math.PI * (now + offset) / period);
}
