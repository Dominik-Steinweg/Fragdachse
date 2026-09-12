import type { ProjectileRuntimeRecord } from './ProjectileRuntimeRecord';
import type { ProjectileExplosionConfig } from '../types';

export interface ProjectileDistanceScaling {
  readonly maxBonus: number;
  readonly maxDistance: number;
}

/** The current step is provisional: a swept contact can shorten it after the flight stage. */
export function advanceProjectileDistance(record: ProjectileRuntimeRecord, x = record.physics.sprite.x, y = record.physics.sprite.y): void {
  const tuning = record.spec.flight.distanceScaling;
  if (!tuning) return;
  const state = record.distanceScaling ??= { distance: 0, committed: 0, startX: record.lastX, startY: record.lastY,
    range: record.remainingRangePx ?? Infinity, x: record.lastX, y: record.lastY, factor: 1 };
  if (state.startX !== record.lastX || state.startY !== record.lastY) {
    state.committed = state.distance;
    state.startX = record.lastX; state.startY = record.lastY;
    state.range = record.remainingRangePx ?? Infinity;
  }
  state.distance = state.committed + Math.min(Math.hypot(x - state.startX, y - state.startY), state.range);
  const segment = Math.hypot(x - state.startX, y - state.startY);
  const clipped = segment > 0 ? Math.min(1, state.range / segment) : 1;
  state.x = state.startX + (x - state.startX) * clipped;
  state.y = state.startY + (y - state.startY) * clipped;
  const factor = 1 + Math.min(1, state.distance / tuning.maxDistance) * tuning.maxBonus;
  const ratio = factor / state.factor;
  if (ratio !== 1) {
    record.damage *= ratio;
    const velocity = record.physics.body.velocity;
    record.physics.body.setVelocity(velocity.x * ratio, velocity.y * ratio);
    if (record.interaction.explosion) record.interaction.explosion = scaleRocketExplosion(record.interaction.explosion, ratio);
  }
  state.factor = factor;
}

/** Commit the entry segment, then start at the exit without counting the teleport displacement. */
export function resetProjectileDistanceAnchor(record: ProjectileRuntimeRecord, x: number, y: number): void {
  const state = record.distanceScaling;
  if (!state) return;
  state.committed = state.distance;
  state.startX = state.x = x; state.startY = state.y = y;
  state.range = record.remainingRangePx ?? Infinity;
}

/** Acceleration must not move the interaction endpoint beyond the cursor range. */
export function clipProjectileDistanceStep(record: ProjectileRuntimeRecord): void {
  if (!record.spec.flight.distanceScaling || record.remainingRangePx === undefined) return;
  const { sprite, body } = record.physics;
  const dx = sprite.x - record.lastX, dy = sprite.y - record.lastY;
  const length = Math.hypot(dx, dy);
  if (length <= record.remainingRangePx) return;
  const fraction = record.remainingRangePx / length;
  const vx = body.velocity.x, vy = body.velocity.y;
  body.reset(record.lastX + dx * fraction, record.lastY + dy * fraction);
  body.setVelocity(vx, vy);
}

function scaleRocketExplosion(effect: ProjectileExplosionConfig, ratio: number): ProjectileExplosionConfig {
  return { ...effect, maxDamage: effect.maxDamage * ratio,
    minDamage: effect.minDamage === undefined ? undefined : effect.minDamage * ratio,
    fireChunkBurst: effect.fireChunkBurst ? { ...effect.fireChunkBurst,
      landingExplosion: effect.fireChunkBurst.landingExplosion ? {
        ...effect.fireChunkBurst.landingExplosion,
        maxDamage: effect.fireChunkBurst.landingExplosion.maxDamage * ratio,
        minDamage: effect.fireChunkBurst.landingExplosion.minDamage === undefined ? undefined
          : effect.fireChunkBurst.landingExplosion.minDamage * ratio,
      } : undefined,
    } : undefined,
  };
}
