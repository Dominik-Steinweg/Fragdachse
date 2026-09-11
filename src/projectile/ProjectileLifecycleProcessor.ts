import type { ProjectileRuntimeRecord } from './ProjectileRuntimeRecord';
import type { ProjectileCoreStageResult } from './ProjectileFlightProcessor';
import type { ProjectileExplosionRequest, ProjectileGrenadePayloadRequest } from './ProjectileExplosionPort';
import type { ProjectileHostStageResult } from './WorldProjectileRuntime';
import { getMiniRocketCascadeMultiplier } from '../utils/miniRocketCascade';
import { projectExplosionCascadeAppearance } from './ProjectileExplosionProjection';

/** Private collaborators of the one World owner; none owns a registry or a domain writer. */
export interface ProjectileLifecycleDependencies {
  prepareGrenadePayload?(projectile: ProjectileRuntimeRecord): ProjectileGrenadePayloadRequest;
  queueDestroy(projectile: ProjectileRuntimeRecord): void;
  release(projectile: ProjectileRuntimeRecord): void;
  isCurrent(projectile: ProjectileRuntimeRecord): boolean;
  shouldSweepRocks(projectile: ProjectileRuntimeRecord): boolean;
  sweepRocks(projectile: ProjectileRuntimeRecord): void;
  advanceCarrier?(projectile: ProjectileRuntimeRecord): void;
  updateHoming(projectile: ProjectileRuntimeRecord, simulatedAgeMs: number): void;
  onImpact(projectile: ProjectileRuntimeRecord, x: number, y: number): void;
  onNaturalFlameExpiry(projectile: ProjectileRuntimeRecord): void;
  onProximityPulse(projectile: ProjectileRuntimeRecord): void;
  onSpentDestruction(projectile: ProjectileRuntimeRecord): void;
}

/**
 * Projectile-local terminal and explosion transitions, statically driven by WorldProjectileRuntime.
 * Requests are buffered until the host's deferred domain stage; this processor never applies them.
 */
export class ProjectileLifecycleProcessor {
  private readonly pendingGrenadePayloads: ProjectileGrenadePayloadRequest[] = [];
  private readonly pendingProjectileExplosions: ProjectileExplosionRequest[] = [];
  private readonly finalizationRecords: ProjectileRuntimeRecord[] = [];
  constructor(private readonly deps: ProjectileLifecycleDependencies) {}

  reset(): void {
    this.pendingGrenadePayloads.length = 0;
    this.pendingProjectileExplosions.length = 0;
    this.finalizationRecords.length = 0;
  }

  triggerExplosion(projectile: ProjectileRuntimeRecord, impactTargetKey?: string): boolean {
    if (!projectile.interaction.explosion) return false;
    // Only the direct trigger target is excluded during coast, not every AoE recipient.
    projectile.interaction.multiExplosionExcludedTargetKeys?.clear();
    if (impactTargetKey) projectile.interaction.multiExplosionExcludedTargetKeys?.add(impactTargetKey);
    this.queueExplosion(projectile, true);
    return true;
  }

  triggerGrenadeExplosion(projectile: ProjectileRuntimeRecord): boolean {
    if (projectile.pendingDestroy || !projectile.spec.interaction.grenadeEffect) return false;
    this.pendingGrenadePayloads.push(this.createGrenadePayload(projectile));
    this.deps.queueDestroy(projectile);
    return true;
  }

  private createGrenadePayload(projectile: ProjectileRuntimeRecord): ProjectileGrenadePayloadRequest {
    return this.deps.prepareGrenadePayload?.(projectile) ?? {
      projectileId: projectile.id, x: projectile.physics.sprite.x, y: projectile.physics.sprite.y,
      provenance: projectile.provenance, effect: projectile.spec.interaction.grenadeEffect!,
    };
  }

  triggerEnemyImpactExplosion(projectile: ProjectileRuntimeRecord): boolean {
    if (!projectile.spec.interaction.enemyHitExplosion || projectile.pendingExplosion) return false;
    projectile.pendingExplosion = true;
    this.pendingProjectileExplosions.push(this.createExplosionRequest(projectile, projectile.spec.interaction.enemyHitExplosion));
    this.deps.queueDestroy(projectile);
    return true;
  }

  run(projectiles: readonly ProjectileRuntimeRecord[], coreStage: ProjectileCoreStageResult): ProjectileHostStageResult {
    // Requests queued by the preceding interaction stage resolve now. Requests raised during
    // finalization retain their established next-host-stage timing.
    const projectileExplosions = this.pendingProjectileExplosions.splice(0);
    const grenadePayloads = this.pendingGrenadePayloads.splice(0);
    for (const projectile of projectiles) {
      if ((projectile.spec.flight.isFlame || projectile.spec.interaction.impulse.leafBlowerMinKnockback !== undefined
        || projectile.spec.interaction.impulse.leafBlowerMaxKnockback !== undefined || projectile.spec.interaction.impulse.leafBlowerDeflectsProjectiles === true)
        && projectile.hitboxSize !== undefined
        && Math.abs(projectile.physics.sprite.displayWidth - projectile.hitboxSize) > 0.0001) {
        projectile.physics.sprite.setDisplaySize(projectile.hitboxSize, projectile.hitboxSize);
      }
    }
    // Snapshot membership, not array indices: terminal reactions may remove siblings or spawn.
    for (const projectile of projectiles) this.finalizationRecords.push(projectile);
    while (this.finalizationRecords.length > 0) {
      const projectile = this.finalizationRecords.pop()!;
      if (this.deps.isCurrent(projectile)) {
        this.stepProjectileEffects(projectile, coreStage, projectileExplosions, grenadePayloads);
      }
    }
    return { projectileExplosions, grenadePayloads, countdownEvents: coreStage.countdownEvents };
  }

  queueExplosion(
    proj: ProjectileRuntimeRecord,
    allowMultiContinue = false,
    stopMultiContinuationAtObstacle = false,
  ): void {
    if (proj.pendingExplosion) return;
    if (!proj.interaction.explosion) {
      if (proj.miniRocket.spent) this.queueSpentMiniRocketDestruction(proj);
      return;
    }
    const simulatedAge = proj.simulatedAgeMs ?? 0;
    const nextExplosionAt = proj.miniRocket.nextExplosionAtAgeMs ?? 0;
    if (proj.spec.flight.miniRocket.stageRangePx !== undefined && simulatedAge < nextExplosionAt) {
      const velocityLength = proj.physics.body.velocity.length();
      if (velocityLength > 0.001) {
        proj.miniRocket.continuationVx = proj.physics.body.velocity.x;
        proj.miniRocket.continuationVy = proj.physics.body.velocity.y;
      }
      proj.miniRocket.deferredExplosion = true;
      proj.miniRocket.deferredExplosionStopsAtObstacle =
        (proj.miniRocket.deferredExplosionStopsAtObstacle ?? false) || stopMultiContinuationAtObstacle;
      proj.physics.body.setVelocity(0, 0);
      proj.physics.body.enable = false;
      return;
    }
    proj.miniRocket.deferredExplosion = false;
    const stopsAtObstacle = (proj.miniRocket.deferredExplosionStopsAtObstacle ?? false)
      || stopMultiContinuationAtObstacle;
    proj.miniRocket.deferredExplosionStopsAtObstacle = false;
    const remaining = Math.max(1, proj.interaction.multiExplosionsRemaining ?? 1);
    const explosionIndex = Math.max(0, proj.miniRocket.explosionIndex ?? 0);
    const cascadeMultiplier = getMiniRocketCascadeMultiplier(
      explosionIndex,
      proj.spec.flight.miniRocket.cascadeDamageBonusPerExplosion ?? 0,
    );
    const resolvedEffect = cascadeMultiplier > 1.0001
      ? {
          ...proj.interaction.explosion,
          radius: proj.interaction.explosion.radius * cascadeMultiplier,
          maxDamage: proj.interaction.explosion.maxDamage * cascadeMultiplier,
          minDamage: proj.interaction.explosion.minDamage === undefined
            ? undefined
            : proj.interaction.explosion.minDamage * cascadeMultiplier,
          ...projectExplosionCascadeAppearance(proj.interaction.explosion, explosionIndex),
        }
      : proj.interaction.explosion;
    if (proj.spec.flight.miniRocket.stageRangePx !== undefined) {
      proj.miniRocket.explosionIndex = explosionIndex + 1;
    }
    const isExtendedMiniRocket = proj.spec.flight.miniRocket.stageRangePx !== undefined;
    const continuesChainAfterExplosion = !stopsAtObstacle
      && (allowMultiContinue || isExtendedMiniRocket)
      && remaining > 1;
    const returnsSpentAfterExplosion = isExtendedMiniRocket
      && proj.spec.flight.miniRocket.returnEnabled === true
      && !continuesChainAfterExplosion;
    const resumesAfterExplosion = continuesChainAfterExplosion || returnsSpentAfterExplosion;
    if (resumesAfterExplosion && isExtendedMiniRocket) {
      const velocityLength = proj.physics.body.velocity.length();
      if (velocityLength > 0.001) {
        proj.miniRocket.continuationVx = proj.physics.body.velocity.x;
        proj.miniRocket.continuationVy = proj.physics.body.velocity.y;
      } else {
        const dx = proj.physics.sprite.x - proj.lastX;
        const dy = proj.physics.sprite.y - proj.lastY;
        const distance = Math.hypot(dx, dy);
        const fallbackSpeed = Math.max(1, (proj.spec.flight.speed ?? 1) * (proj.timeBubbleFactor ?? 1));
        if (distance > 0.001) {
          proj.miniRocket.continuationVx = (dx / distance) * fallbackSpeed;
          proj.miniRocket.continuationVy = (dy / distance) * fallbackSpeed;
        }
      }
    }
    proj.interaction.multiExplosionsRemaining = returnsSpentAfterExplosion ? 0 : remaining - 1;
    proj.miniRocket.spent = returnsSpentAfterExplosion;
    proj.pendingExplosion = true;
    this.pendingProjectileExplosions.push(this.createExplosionRequest(proj, resolvedEffect, resumesAfterExplosion));
    if (resumesAfterExplosion) {
      proj.physics.body.setVelocity(0, 0);
      proj.physics.body.enable = false;
    } else {
      this.deps.queueDestroy(proj);
    }
  }

  private createExplosionRequest(
    proj: ProjectileRuntimeRecord,
    effect: ProjectileRuntimeRecord['interaction']['explosion'] = proj.interaction.explosion,
    continuesAfterExplosion = false,
  ): ProjectileExplosionRequest {
    if (!effect) throw new Error(`[ProjectileLifecycleProcessor] explosion request without effect for ${proj.id}`);
    const excludedTargetKey = proj.interaction.multiExplosionExcludedTargetKeys?.values().next().value as string | undefined;
    return {
      x: proj.physics.sprite.x,
      y: proj.physics.sprite.y,
      projectileId: proj.id,
      provenance: proj.provenance,
      effect,
      continuation: continuesAfterExplosion
        ? { projectileId: proj.id, excludedTargetKey }
        : undefined,
    };
  }

  private stepProjectileEffects(
    proj: ProjectileRuntimeRecord,
    coreStage: ProjectileCoreStageResult,
    projectileExplosions: ProjectileExplosionRequest[],
    grenadePayloads: ProjectileGrenadePayloadRequest[],
  ): boolean {
    if (proj.pendingDestroy) {
      this.deps.release(proj);
      return false;
    }

    if (proj.spec.flight.isGrenade) {
      if (coreStage.grenadeExpiredIds.has(proj.id) && proj.spec.interaction.grenadeEffect) {
        grenadePayloads.push(this.createGrenadePayload(proj));
        this.deps.release(proj);
        return false;
      }
      proj.bounceProcessedThisStep = false;
      proj.velocityAfterFirstBounce = undefined;
      this.deps.advanceCarrier?.(proj);
      proj.lastX = proj.physics.sprite.x;
      proj.lastY = proj.physics.sprite.y;
      return true;
    }

    const awaitingContinuation = proj.pendingExplosion
      && (proj.interaction.multiExplosionsRemaining ?? 0) > 0;
    if (awaitingContinuation) {
      this.deps.advanceCarrier?.(proj);
      proj.lastX = proj.physics.sprite.x;
      proj.lastY = proj.physics.sprite.y;
      return true;
    }

    if (proj.miniRocket.deferredExplosion) {
      if ((proj.simulatedAgeMs ?? 0) >= (proj.miniRocket.nextExplosionAtAgeMs ?? 0)) {
        this.queueExplosion(
          proj,
          true,
          proj.miniRocket.deferredExplosionStopsAtObstacle ?? false,
        );
      }
      this.deps.advanceCarrier?.(proj);
      proj.lastX = proj.physics.sprite.x;
      proj.lastY = proj.physics.sprite.y;
      return true;
    }

    if (coreStage.miniRocketSafetyExpiredIds.has(proj.id)) {
      this.deps.release(proj);
      return false;
    }

    if (coreStage.lifetimeExpiredIds.has(proj.id) && proj.interaction.explosion) {
      projectileExplosions.push(this.createExplosionRequest(proj));
      this.deps.release(proj);
      return false;
    }

    if (coreStage.lifetimeExpiredIds.has(proj.id) && proj.spec.interaction.impactCloud) {
      this.deps.onImpact(proj, proj.physics.sprite.x, proj.physics.sprite.y);
      this.deps.release(proj);
      return false;
    }

    if (this.deps.shouldSweepRocks(proj)) {
      this.deps.sweepRocks(proj);
      if (proj.pendingDestroy) {
        this.deps.release(proj);
        return false;
      }
    }

    if (coreStage.rangeDepletedIds.has(proj.id)
      && proj.spec.flight.miniRocket.stageRangePx !== undefined
      && proj.interaction.explosion) {
      this.queueExplosion(proj, true);
      return true;
    }

    const dead = !awaitingContinuation
      && (coreStage.lifetimeExpiredIds.has(proj.id)
        || coreStage.rangeDepletedIds.has(proj.id)
        || coreStage.bounceLimitReachedIds.has(proj.id));
    if (dead) {
      if (proj.spec.flight.isFlame && coreStage.lifetimeExpiredIds.has(proj.id)) {
        this.deps.onNaturalFlameExpiry(proj);
      }
      if (proj.miniRocket.spent && coreStage.rangeDepletedIds.has(proj.id)) {
        this.emitSpentMiniRocketDestruction(proj);
      }
      this.deps.release(proj);
    } else if (proj.spec.flight.homing && proj.spec.flight.miniRocket.stageRangePx === undefined) {
      const simulatedAge = proj.simulatedAgeMs ?? 0;
      this.deps.advanceCarrier?.(proj);
      this.deps.updateHoming(proj, simulatedAge);
    }

    const proximityPulse = proj.spec.interaction.proximityPulse;
    if (proximityPulse && proximityPulse.radius > 0 && proximityPulse.damage > 0) {
      const interval = Math.max(50, proximityPulse.scanIntervalMs);
      const simulatedAge = proj.simulatedAgeMs ?? 0;
      if (proj.interaction.lastProximityPulseAt === undefined || simulatedAge - proj.interaction.lastProximityPulseAt >= interval) {
        proj.interaction.lastProximityPulseAt = simulatedAge;
        this.deps.onProximityPulse(proj);
      }
    }

    this.deps.advanceCarrier?.(proj);
    proj.lastX = proj.physics.sprite.x;
    proj.lastY = proj.physics.sprite.y;
    proj.bounceProcessedThisStep = false;
    proj.velocityAfterFirstBounce = undefined;
    return !dead;
  }

  private emitSpentMiniRocketDestruction(proj: ProjectileRuntimeRecord): void {
    if (proj.miniRocket.destructionFxEmitted) return;
    proj.miniRocket.destructionFxEmitted = true;
    this.deps.onSpentDestruction(proj);
  }

  private queueSpentMiniRocketDestruction(proj: ProjectileRuntimeRecord): void {
    if (proj.pendingDestroy) return;
    this.emitSpentMiniRocketDestruction(proj);
    this.deps.queueDestroy(proj);
  }

}
