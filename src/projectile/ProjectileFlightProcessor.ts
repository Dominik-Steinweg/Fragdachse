import type { TrackedProjectile } from '../types';
import { MIN_PROJECTILE_BODY_LENGTH } from './ProjectileFlightConstants';
import type { ProjectileTimeFieldPort } from './ProjectileTimeFieldPort';
import type { ProjectileProvenance } from './ProjectileSpawnRequest';

/** Core results consumed by the still-legacy collision/effect stage. */
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
 * effects and presentation stay in the legacy stage until their planned cutover phases.
 */
export class ProjectileFlightProcessor {
  private readonly lifetimeExpiredIds = new Set<number>();
  private readonly grenadeExpiredIds = new Set<number>();
  private readonly rangeDepletedIds = new Set<number>();
  private readonly bounceLimitReachedIds = new Set<number>();
  private readonly miniRocketSafetyExpiredIds = new Set<number>();
  private readonly countdownEvents: Array<{ x: number; y: number; value: number }> = [];
  private timeFieldPort: ProjectileTimeFieldPort | null = null;
  private readonly fallbackProvenance = {
    gameplaySourceId: '',
    attributionId: '',
    allegiance: { ownerId: '', allowTeamDamage: undefined as boolean | undefined },
    weaponSourceId: undefined as string | undefined,
    sourceSlot: undefined as ProjectileProvenance['sourceSlot'],
    sourceTurretId: undefined as string | undefined,
  } satisfies ProjectileProvenance;

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

  run(projectiles: readonly TrackedProjectile[], deltaMs: number, nowMs: number): ProjectileCoreStageResult {
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

  private step(projectile: TrackedProjectile, deltaMs: number, nowMs: number): void {
    if (projectile.pendingDestroy) return;

    const nextFactor = this.resolveMovementFactor(projectile, nowMs);
    const simulatedDeltaMs = Math.max(0, deltaMs * nextFactor);
    projectile.simulatedAgeMs = (projectile.simulatedAgeMs ?? 0) + simulatedDeltaMs;
    const simulatedAgeMs = projectile.simulatedAgeMs;
    const realAgeMs = nowMs - projectile.createdAt;

    this.decrementRange(projectile);

    if (projectile.isGrenade) {
      const fuseExpired = realAgeMs >= (projectile.fuseTime ?? Number.POSITIVE_INFINITY);
      const bouncedOut = projectile.maxBounces > 0 && projectile.bounceCount >= projectile.maxBounces;
      if (fuseExpired || bouncedOut) this.grenadeExpiredIds.add(projectile.id);

      this.emitCountdown(projectile, realAgeMs);
      this.updateDragAndStop(projectile, nextFactor, simulatedAgeMs);
      projectile.bounceProcessedThisStep = false;
      projectile.velocityAfterFirstBounce = undefined;
      return;
    }

    const awaitingContinuation = projectile.pendingExplosion
      && (projectile.multiExplosionsRemaining ?? 0) > 0;
    const deferredExplosion = projectile.miniRocketDeferredExplosion === true;

    if (projectile.miniRocketStageRangePx !== undefined
      && simulatedAgeMs >= (projectile.miniRocketSafetyLifetimeMs ?? projectile.lifetime)) {
      this.miniRocketSafetyExpiredIds.add(projectile.id);
    }

    if (!awaitingContinuation && !deferredExplosion && projectile.miniRocketStageRangePx === undefined
      && simulatedAgeMs > projectile.lifetime) {
      this.lifetimeExpiredIds.add(projectile.id);
    }
    if (!awaitingContinuation && !deferredExplosion && projectile.miniRocketStageRangePx === undefined
      && simulatedAgeMs > projectile.lifetime && projectile.impactCloud) {
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

  private resolveMovementFactor(projectile: TrackedProjectile, nowMs: number): number {
    const fallbackProvenance = this.fallbackProvenance;
    fallbackProvenance.gameplaySourceId = projectile.ownerId;
    fallbackProvenance.attributionId = projectile.ownerId;
    fallbackProvenance.allegiance.ownerId = projectile.ownerId;
    fallbackProvenance.allegiance.allowTeamDamage = projectile.allowTeamDamage;
    fallbackProvenance.weaponSourceId = projectile.sourceId;
    fallbackProvenance.sourceSlot = projectile.sourceSlot;
    fallbackProvenance.sourceTurretId = projectile.sourceTurretId;
    const queried = this.timeFieldPort?.getMovementFactor(
      projectile.sprite.x,
      projectile.sprite.y,
      nowMs,
      fallbackProvenance,
    );
    const nextFactor = clamp(queried ?? projectile.timeBubbleFactor ?? 1, 0, 1);
    const previousFactor = clamp(projectile.timeBubbleFactor ?? 1, 0, 1);
    if (Math.abs(nextFactor - previousFactor) > 0.0001) {
      if (previousFactor > 0.0001) {
        const ratio = nextFactor / previousFactor;
        projectile.body.setVelocity(projectile.body.velocity.x * ratio, projectile.body.velocity.y * ratio);
      }
      projectile.timeBubbleFactor = nextFactor;
      this.syncTimeBubbleDrag(projectile);
    } else {
      projectile.timeBubbleFactor = nextFactor;
    }
    return nextFactor;
  }

  private decrementRange(projectile: TrackedProjectile): void {
    if (projectile.remainingRangePx === undefined) return;
    const dx = projectile.sprite.x - projectile.lastX;
    const dy = projectile.sprite.y - projectile.lastY;
    const distance = Math.hypot(dx, dy);
    if (distance > 0.01) projectile.remainingRangePx = Math.max(0, projectile.remainingRangePx - distance);
  }

  private emitCountdown(projectile: TrackedProjectile, realAgeMs: number): void {
    const fuseTimeMs = projectile.fuseTime ?? 0;
    if (fuseTimeMs < 1500) return;
    const remainingSeconds = Math.max(0, Math.ceil((fuseTimeMs - realAgeMs) / 1000));
    if (remainingSeconds <= 0 || projectile.lastCountdownEmitted === remainingSeconds) return;
    projectile.lastCountdownEmitted = remainingSeconds;
    this.countdownEvents.push({ x: projectile.sprite.x, y: projectile.sprite.y, value: remainingSeconds });
  }

  private updateGrowingHitbox(projectile: TrackedProjectile, deltaSeconds: number): void {
    if (!projectile.isFlame && projectile.projectileStyle !== 'leaf_blower') return;
    const growRate = projectile.hitboxGrowRate ?? 0;
    const currentSize = projectile.hitboxSize ?? projectile.sprite.displayWidth;
    const maxSize = projectile.hitboxMaxSize ?? currentSize;
    if (currentSize < maxSize) {
      const nextSize = Math.min(maxSize, currentSize + growRate * deltaSeconds);
      projectile.hitboxSize = nextSize;
    }
    const decay = projectile.velocityDecay ?? 1;
    if (decay < 1) {
      const factor = Math.pow(decay, deltaSeconds);
      projectile.body.setVelocity(projectile.body.velocity.x * factor, projectile.body.velocity.y * factor);
    }
  }

  private updateDragAndStop(projectile: TrackedProjectile, timeFactor: number, simulatedAgeMs: number): void {
    if (projectile.airFrictionDecayPerSec !== undefined && !projectile.frictionActivated
      && (projectile.frictionDelayMs === undefined || simulatedAgeMs >= projectile.frictionDelayMs)) {
      const effectiveDecay = effectiveAirFrictionDecay(projectile.airFrictionDecayPerSec, timeFactor);
      projectile.body.setDrag(effectiveDecay, effectiveDecay);
      projectile.frictionActivated = true;
      projectile.appliedAirFrictionDecay = effectiveDecay;
    }
    this.syncTimeBubbleDrag(projectile);
    if (projectile.frictionActivated && projectile.stopSpeedThreshold !== undefined) {
      const speedSq = projectile.body.velocity.lengthSq();
      const effectiveThreshold = projectile.stopSpeedThreshold * timeFactor;
      if (speedSq > 0 && speedSq < effectiveThreshold * effectiveThreshold) projectile.body.setVelocity(0, 0);
    }
  }

  private syncTimeBubbleDrag(projectile: TrackedProjectile): void {
    if (!projectile.frictionActivated || projectile.airFrictionDecayPerSec === undefined) return;
    const effectiveDecay = effectiveAirFrictionDecay(
      projectile.airFrictionDecayPerSec,
      projectile.timeBubbleFactor ?? 1,
    );
    if (projectile.appliedAirFrictionDecay !== undefined
      && Math.abs(projectile.appliedAirFrictionDecay - effectiveDecay) <= 0.0001) return;
    projectile.body.setDrag(effectiveDecay, effectiveDecay);
    projectile.appliedAirFrictionDecay = effectiveDecay;
  }

  private updateAntiTunnelingBody(projectile: TrackedProjectile): void {
    if (projectile.originalBodySize === undefined) return;
    const velocityX = Math.abs(projectile.body.velocity.x);
    const velocityY = Math.abs(projectile.body.velocity.y);
    const speed = Math.hypot(velocityX, velocityY);
    if (speed <= 1) return;
    const originalSize = projectile.originalBodySize;
    const width = Math.max(originalSize, (velocityX / speed) * MIN_PROJECTILE_BODY_LENGTH);
    const height = Math.max(originalSize, (velocityY / speed) * MIN_PROJECTILE_BODY_LENGTH);
    projectile.body.setSize(width, height);
    projectile.body.setOffset((originalSize - width) / 2, (originalSize - height) / 2);
  }
}

export function effectiveAirFrictionDecay(baseDecay: number, timeFactor: number): number {
  return Math.pow(clamp(baseDecay, 0.0001, 1), clamp(timeFactor, 0.0001, 1));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
