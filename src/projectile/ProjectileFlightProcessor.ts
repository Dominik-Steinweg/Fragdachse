import type { ProjectileRuntimeRecord } from './ProjectileRuntimeRecord';
import { MIN_PROJECTILE_BODY_LENGTH } from './ProjectileFlightConstants';
import { isGrenadeFragment } from '../systems/GrenadeFragmentRules';
import type { ProjectileTimeFieldPort } from './ProjectileTimeFieldPort';
import { advanceSpeedVariation, createSpeedVariation } from './ProjectileSpeedVariation';

/** Core results consumed by the world owner's downstream lifecycle stage. */
export interface ProjectileCoreStageResult {
  readonly lifetimeExpiredIds: ReadonlySet<number>;
  readonly grenadeExpiredIds: ReadonlySet<number>;
  readonly rangeDepletedIds: ReadonlySet<number>;
  readonly bounceLimitReachedIds: ReadonlySet<number>;
  readonly miniRocketSafetyExpiredIds: ReadonlySet<number>;
  readonly countdownEvents: Array<{ x: number; y: number; value: number }>;
}

/**
 * World-owned Flight/Lifetime core.
 *
 * The processor owns only deterministic runtime bookkeeping and physics-body state. Collision,
 * effects and presentation are consumed by their dedicated downstream owners.
 */
export class ProjectileFlightProcessor {
  private readonly lifetimeExpiredIds = new Set<number>();
  private readonly grenadeExpiredIds = new Set<number>();
  private readonly rangeDepletedIds = new Set<number>();
  private readonly bounceLimitReachedIds = new Set<number>();
  private readonly miniRocketSafetyExpiredIds = new Set<number>();
  private readonly countdownEvents: Array<{ x: number; y: number; value: number }> = [];
  private timeFieldPort: ProjectileTimeFieldPort | null = null;

  private readonly result: ProjectileCoreStageResult = {
    lifetimeExpiredIds: this.lifetimeExpiredIds,
    grenadeExpiredIds: this.grenadeExpiredIds,
    rangeDepletedIds: this.rangeDepletedIds,
    bounceLimitReachedIds: this.bounceLimitReachedIds,
    miniRocketSafetyExpiredIds: this.miniRocketSafetyExpiredIds,
    countdownEvents: this.countdownEvents,
  };

  setTimeFieldPort(port: ProjectileTimeFieldPort | null): void {
    this.timeFieldPort = port;
  }

  run(projectiles: readonly ProjectileRuntimeRecord[], deltaMs: number, nowMs: number): ProjectileCoreStageResult {
    this.lifetimeExpiredIds.clear();
    this.grenadeExpiredIds.clear();
    this.rangeDepletedIds.clear();
    this.bounceLimitReachedIds.clear();
    this.miniRocketSafetyExpiredIds.clear();
    this.countdownEvents.length = 0;

    for (const projectile of projectiles) {
      this.step(projectile, deltaMs, nowMs);
    }

    return this.result;
  }

  reset(): void {
    this.lifetimeExpiredIds.clear();
    this.grenadeExpiredIds.clear();
    this.rangeDepletedIds.clear();
    this.bounceLimitReachedIds.clear();
    this.miniRocketSafetyExpiredIds.clear();
    this.countdownEvents.length = 0;
    this.timeFieldPort = null;
  }

  private step(projectile: ProjectileRuntimeRecord, deltaMs: number, nowMs: number): void {
    if (projectile.pendingDestroy) return;

    const nextFactor = this.resolveMovementFactor(projectile, nowMs);
    const simulatedDeltaMs = Math.max(0, deltaMs * nextFactor);
    projectile.simulatedAgeMs = (projectile.simulatedAgeMs ?? 0) + simulatedDeltaMs;
    const simulatedAgeMs = projectile.simulatedAgeMs;
    const realAgeMs = nowMs - projectile.createdAt;

    this.decrementRange(projectile);
    if (projectile.spec.flight.speedVariation === 'charged_bolt') {
      const state = projectile.speedVariation ??= createSpeedVariation(projectile.id);
      const factor = advanceSpeedVariation(state, simulatedDeltaMs);
      // Relative scaling preserves homing/deflection direction and external speed modifiers.
      const ratio = factor / state.appliedFactor;
      const velocity = projectile.physics.body.velocity;
      projectile.physics.body.setVelocity(velocity.x * ratio, velocity.y * ratio);
      state.appliedFactor = factor;
    }

    if (projectile.spec.flight.isGrenade) {
      const velocity = projectile.physics.body.velocity;
      if (Math.hypot(velocity.x, velocity.y) > 0.001) projectile.grenadeLastDirection = Math.atan2(velocity.y, velocity.x);
      const fuseExpired = realAgeMs >= (projectile.spec.flight.fuseTime ?? Number.POSITIVE_INFINITY);
      const bouncedOut = !isGrenadeFragment(projectile.spec.interaction.grenadeEffect)
        && projectile.maxBounces > 0 && projectile.bounceCount >= projectile.maxBounces;
      if (fuseExpired || bouncedOut) this.grenadeExpiredIds.add(projectile.id);

      this.emitCountdown(projectile, realAgeMs);
      this.updateDragAndStop(projectile, nextFactor, simulatedAgeMs);
      projectile.bounceProcessedThisStep = false;
      projectile.velocityAfterFirstBounce = undefined;
      return;
    }

    const awaitingContinuation = projectile.pendingExplosion
      && (projectile.interaction.multiExplosionsRemaining ?? 0) > 0;
    const deferredExplosion = projectile.miniRocket.deferredExplosion === true;

    if (projectile.spec.flight.miniRocket.stageRangePx !== undefined
      && simulatedAgeMs >= (projectile.spec.flight.miniRocket.safetyLifetimeMs ?? projectile.spec.flight.lifetimeMs)) {
      this.miniRocketSafetyExpiredIds.add(projectile.id);
    }

    if (!awaitingContinuation && !deferredExplosion && projectile.spec.flight.miniRocket.stageRangePx === undefined
      && simulatedAgeMs > projectile.spec.flight.lifetimeMs) {
      this.lifetimeExpiredIds.add(projectile.id);
    }
    if (!awaitingContinuation && !deferredExplosion && projectile.spec.flight.miniRocket.stageRangePx === undefined
      && simulatedAgeMs > projectile.spec.flight.lifetimeMs && projectile.spec.interaction.impactCloud) {
      this.lifetimeExpiredIds.add(projectile.id);
    }

    if (projectile.remainingRangePx !== undefined && projectile.remainingRangePx <= 0.5) {
      this.rangeDepletedIds.add(projectile.id);
    }
    if (projectile.bounceCount > projectile.maxBounces) {
      this.bounceLimitReachedIds.add(projectile.id);
    }

    if (!awaitingContinuation && !deferredExplosion && !this.lifetimeExpiredIds.has(projectile.id)
      && !this.miniRocketSafetyExpiredIds.has(projectile.id)) {
      this.updateGrowingHitbox(projectile, simulatedDeltaMs / 1000);
    }

    this.updateDragAndStop(projectile, nextFactor, simulatedAgeMs);
    this.updateAntiTunnelingBody(projectile);
  }

  resolveMovementFactor(projectile: ProjectileRuntimeRecord, nowMs: number): number {
    const queried = this.timeFieldPort?.getMovementFactor(
      projectile.physics.sprite.x,
      projectile.physics.sprite.y,
      nowMs,
    );
    const nextFactor = clamp(queried ?? projectile.timeBubbleFactor ?? 1, 0, 1);
    const previousFactor = clamp(projectile.timeBubbleFactor ?? 1, 0, 1);
    if (Math.abs(nextFactor - previousFactor) > 0.0001) {
      if (previousFactor > 0.0001) {
        const ratio = nextFactor / previousFactor;
        projectile.physics.body.setVelocity(projectile.physics.body.velocity.x * ratio, projectile.physics.body.velocity.y * ratio);
      }
      projectile.timeBubbleFactor = nextFactor;
      this.syncTimeBubbleDrag(projectile);
    } else {
      projectile.timeBubbleFactor = nextFactor;
    }
    return nextFactor;
  }

  private decrementRange(projectile: ProjectileRuntimeRecord): void {
    if (projectile.remainingRangePx === undefined) return;
    const dx = projectile.physics.sprite.x - projectile.lastX;
    const dy = projectile.physics.sprite.y - projectile.lastY;
    const distance = Math.hypot(dx, dy);
    if (distance > 0.01) projectile.remainingRangePx = Math.max(0, projectile.remainingRangePx - distance);
  }

  private emitCountdown(projectile: ProjectileRuntimeRecord, realAgeMs: number): void {
    const fuseTimeMs = projectile.spec.flight.fuseTime ?? 0;
    if (fuseTimeMs < 1500) return;
    const remainingSeconds = Math.max(0, Math.ceil((fuseTimeMs - realAgeMs) / 1000));
    if (remainingSeconds <= 0 || projectile.lastCountdownEmitted === remainingSeconds) return;
    projectile.lastCountdownEmitted = remainingSeconds;
    this.countdownEvents.push({ x: projectile.physics.sprite.x, y: projectile.physics.sprite.y, value: remainingSeconds });
  }

  private updateGrowingHitbox(projectile: ProjectileRuntimeRecord, deltaSeconds: number): void {
    if (!projectile.spec.flight.isFlame
      && projectile.spec.interaction.impulse.leafBlowerMinKnockback === undefined
      && projectile.spec.interaction.impulse.leafBlowerMaxKnockback === undefined
      && projectile.spec.interaction.impulse.leafBlowerDeflectsProjectiles !== true) return;
    const growRate = projectile.spec.flight.hitboxGrowth.growRatePerSec ?? 0;
    const currentSize = projectile.hitboxSize ?? projectile.physics.sprite.displayWidth;
    const maxSize = projectile.spec.flight.hitboxGrowth.maxSize ?? currentSize;
    if (currentSize < maxSize) {
      const nextSize = Math.min(maxSize, currentSize + growRate * deltaSeconds);
      projectile.hitboxSize = nextSize;
    }
    const decay = projectile.spec.flight.drag.velocityDecayPerSec ?? 1;
    if (decay < 1) {
      const factor = Math.pow(decay, deltaSeconds);
      projectile.physics.body.setVelocity(projectile.physics.body.velocity.x * factor, projectile.physics.body.velocity.y * factor);
    }
  }

  private updateDragAndStop(projectile: ProjectileRuntimeRecord, timeFactor: number, simulatedAgeMs: number): void {
    if (projectile.spec.flight.drag.airFrictionDecayPerSec !== undefined && !projectile.frictionActivated
      && (projectile.spec.flight.drag.frictionDelayMs === undefined || simulatedAgeMs >= projectile.spec.flight.drag.frictionDelayMs)) {
      const effectiveDecay = effectiveAirFrictionDecay(projectile.spec.flight.drag.airFrictionDecayPerSec, timeFactor);
      projectile.physics.body.setDrag(effectiveDecay, effectiveDecay);
      projectile.frictionActivated = true;
      projectile.appliedAirFrictionDecay = effectiveDecay;
    }
    this.syncTimeBubbleDrag(projectile);
    if (projectile.frictionActivated && projectile.spec.flight.drag.stopSpeedThreshold !== undefined) {
      const speedSq = projectile.physics.body.velocity.lengthSq();
      const effectiveThreshold = projectile.spec.flight.drag.stopSpeedThreshold * timeFactor;
      if (speedSq > 0 && speedSq < effectiveThreshold * effectiveThreshold) projectile.physics.body.setVelocity(0, 0);
    }
  }

  private syncTimeBubbleDrag(projectile: ProjectileRuntimeRecord): void {
    if (!projectile.frictionActivated || projectile.spec.flight.drag.airFrictionDecayPerSec === undefined) return;
    const effectiveDecay = effectiveAirFrictionDecay(
      projectile.spec.flight.drag.airFrictionDecayPerSec,
      projectile.timeBubbleFactor ?? 1,
    );
    if (projectile.appliedAirFrictionDecay !== undefined
      && Math.abs(projectile.appliedAirFrictionDecay - effectiveDecay) <= 0.0001) return;
    projectile.physics.body.setDrag(effectiveDecay, effectiveDecay);
    projectile.appliedAirFrictionDecay = effectiveDecay;
  }

  private updateAntiTunnelingBody(projectile: ProjectileRuntimeRecord): void {
    if (projectile.spec.flight.originalBodySize === undefined) return;
    const velocityX = Math.abs(projectile.physics.body.velocity.x);
    const velocityY = Math.abs(projectile.physics.body.velocity.y);
    const speed = Math.hypot(velocityX, velocityY);
    if (speed <= 1) return;
    const originalSize = projectile.spec.flight.originalBodySize;
    const width = Math.max(originalSize, (velocityX / speed) * MIN_PROJECTILE_BODY_LENGTH);
    const height = Math.max(originalSize, (velocityY / speed) * MIN_PROJECTILE_BODY_LENGTH);
    projectile.physics.body.setSize(width, height);
    projectile.physics.body.setOffset((originalSize - width) / 2, (originalSize - height) / 2);
  }
}

export function effectiveAirFrictionDecay(baseDecay: number, timeFactor: number): number {
  return Math.pow(clamp(baseDecay, 0.0001, 1), clamp(timeFactor, 0.0001, 1));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
