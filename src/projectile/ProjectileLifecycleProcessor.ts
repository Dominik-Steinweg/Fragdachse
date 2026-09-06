import type { ProjectileRuntimeRecord } from '../types';
import type { ProjectileCoreStageResult } from './ProjectileFlightProcessor';
import type { ProjectileExplosionRequest, ProjectileGrenadePayloadRequest } from './ProjectileExplosionPort';
import type { ProjectileHostStageResult } from './WorldProjectileRuntime';
import { getMiniRocketCascadeMultiplier } from '../utils/miniRocketCascade';
import { projectExplosionCascadeAppearance } from './ProjectileExplosionProjection';

/** Private collaborators of the one World owner; none owns a registry or a domain writer. */
export interface ProjectileLifecycleDependencies {
  queueDestroy(projectile: ProjectileRuntimeRecord): void;
  release(projectile: ProjectileRuntimeRecord): void;
  dropStepEntryAt(index: number): void;
  shouldSweepRocks(projectile: ProjectileRuntimeRecord): boolean;
  sweepRocks(projectile: ProjectileRuntimeRecord): void;
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
  private readonly pendingProjectileExplosions: ProjectileExplosionRequest[] = [];
  constructor(private readonly deps: ProjectileLifecycleDependencies) {}

  reset(): void { this.pendingProjectileExplosions.length = 0; }

  triggerExplosion(projectile: ProjectileRuntimeRecord, impactTargetKey?: string): boolean {
    if (!projectile.explosion) return false;
    // Only the direct trigger target is excluded during coast, not every AoE recipient.
    projectile.multiExplosionExcludedTargetKeys?.clear();
    if (impactTargetKey) projectile.multiExplosionExcludedTargetKeys?.add(impactTargetKey);
    this.queueExplosion(projectile, true);
    return true;
  }

  triggerEnemyImpactExplosion(projectile: ProjectileRuntimeRecord): boolean {
    if (!projectile.enemyHitExplosion || projectile.pendingExplosion) return false;
    projectile.pendingExplosion = true;
    this.pendingProjectileExplosions.push(this.createExplosionRequest(projectile, projectile.enemyHitExplosion));
    this.deps.queueDestroy(projectile);
    return true;
  }

  run(projectiles: readonly ProjectileRuntimeRecord[], coreStage: ProjectileCoreStageResult): ProjectileHostStageResult {
    // Requests queued by the preceding interaction stage resolve now. Requests raised during
    // finalization retain their established next-host-stage timing.
    const projectileExplosions = this.pendingProjectileExplosions.splice(0);
    const grenadePayloads: ProjectileGrenadePayloadRequest[] = [];
    for (const projectile of projectiles) {
      if ((projectile.isFlame || projectile.leafBlowerMinKnockback !== undefined
        || projectile.leafBlowerMaxKnockback !== undefined || projectile.leafBlowerDeflectsProjectiles === true)
        && projectile.hitboxSize !== undefined
        && Math.abs(projectile.sprite.displayWidth - projectile.hitboxSize) > 0.0001) {
        projectile.sprite.setDisplaySize(projectile.hitboxSize, projectile.hitboxSize);
      }
    }
    // A fixed reverse start index excludes new spawns during finalization.
    for (let index = projectiles.length - 1; index >= 0; index -= 1) {
      if (!this.stepProjectileEffects(projectiles[index], coreStage, projectileExplosions, grenadePayloads)) {
        this.deps.dropStepEntryAt(index);
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
    if (!proj.explosion) {
      if (proj.miniRocketSpent) this.queueSpentMiniRocketDestruction(proj);
      return;
    }
    const simulatedAge = proj.simulatedAgeMs ?? 0;
    const nextExplosionAt = proj.miniRocketNextExplosionAtAgeMs ?? 0;
    if (proj.miniRocketStageRangePx !== undefined && simulatedAge < nextExplosionAt) {
      const velocityLength = proj.body.velocity.length();
      if (velocityLength > 0.001) {
        proj.miniRocketContinuationVx = proj.body.velocity.x;
        proj.miniRocketContinuationVy = proj.body.velocity.y;
      }
      proj.miniRocketDeferredExplosion = true;
      proj.miniRocketDeferredExplosionStopsAtObstacle =
        (proj.miniRocketDeferredExplosionStopsAtObstacle ?? false) || stopMultiContinuationAtObstacle;
      proj.body.setVelocity(0, 0);
      proj.body.enable = false;
      return;
    }
    proj.miniRocketDeferredExplosion = false;
    const stopsAtObstacle = (proj.miniRocketDeferredExplosionStopsAtObstacle ?? false)
      || stopMultiContinuationAtObstacle;
    proj.miniRocketDeferredExplosionStopsAtObstacle = false;
    const remaining = Math.max(1, proj.multiExplosionsRemaining ?? 1);
    const explosionIndex = Math.max(0, proj.miniRocketExplosionIndex ?? 0);
    const cascadeMultiplier = getMiniRocketCascadeMultiplier(
      explosionIndex,
      proj.miniRocketCascadeDamageBonusPerExplosion ?? 0,
    );
    const resolvedEffect = cascadeMultiplier > 1.0001
      ? {
          ...proj.explosion,
          radius: proj.explosion.radius * cascadeMultiplier,
          maxDamage: proj.explosion.maxDamage * cascadeMultiplier,
          minDamage: proj.explosion.minDamage === undefined
            ? undefined
            : proj.explosion.minDamage * cascadeMultiplier,
          ...projectExplosionCascadeAppearance(proj.explosion, explosionIndex),
        }
      : proj.explosion;
    if (proj.miniRocketStageRangePx !== undefined) {
      proj.miniRocketExplosionIndex = explosionIndex + 1;
    }
    const isExtendedMiniRocket = proj.miniRocketStageRangePx !== undefined;
    const continuesChainAfterExplosion = !stopsAtObstacle
      && (allowMultiContinue || isExtendedMiniRocket)
      && remaining > 1;
    const returnsSpentAfterExplosion = isExtendedMiniRocket
      && proj.miniRocketReturnEnabled === true
      && !continuesChainAfterExplosion;
    const resumesAfterExplosion = continuesChainAfterExplosion || returnsSpentAfterExplosion;
    if (resumesAfterExplosion && isExtendedMiniRocket) {
      const velocityLength = proj.body.velocity.length();
      if (velocityLength > 0.001) {
        proj.miniRocketContinuationVx = proj.body.velocity.x;
        proj.miniRocketContinuationVy = proj.body.velocity.y;
      } else {
        const dx = proj.sprite.x - proj.lastX;
        const dy = proj.sprite.y - proj.lastY;
        const distance = Math.hypot(dx, dy);
        const fallbackSpeed = Math.max(1, (proj.initialSpeed ?? 1) * (proj.timeBubbleFactor ?? 1));
        if (distance > 0.001) {
          proj.miniRocketContinuationVx = (dx / distance) * fallbackSpeed;
          proj.miniRocketContinuationVy = (dy / distance) * fallbackSpeed;
        }
      }
    }
    proj.multiExplosionsRemaining = returnsSpentAfterExplosion ? 0 : remaining - 1;
    proj.miniRocketSpent = returnsSpentAfterExplosion;
    proj.pendingExplosion = true;
    this.pendingProjectileExplosions.push(this.createExplosionRequest(proj, resolvedEffect, resumesAfterExplosion));
    if (resumesAfterExplosion) {
      proj.body.setVelocity(0, 0);
      proj.body.enable = false;
    } else {
      this.deps.queueDestroy(proj);
    }
  }

  private createExplosionRequest(
    proj: ProjectileRuntimeRecord,
    effect: ProjectileRuntimeRecord['explosion'] = proj.explosion,
    continuesAfterExplosion = false,
  ): ProjectileExplosionRequest {
    if (!effect) throw new Error(`[ProjectileLifecycleProcessor] explosion request without effect for ${proj.id}`);
    const excludedTargetKey = proj.multiExplosionExcludedTargetKeys?.values().next().value as string | undefined;
    return {
      x: proj.sprite.x,
      y: proj.sprite.y,
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

    if (proj.isGrenade) {
      if (coreStage.grenadeExpiredIds.has(proj.id) && proj.grenadeEffect) {
        grenadePayloads.push({
          x: proj.sprite.x,
          y: proj.sprite.y,
          projectileId: proj.id,
          provenance: proj.provenance,
          effect: proj.grenadeEffect,
        });
        this.deps.release(proj);
        return false;
      }
      proj.bounceProcessedThisStep = false;
      proj.velocityAfterFirstBounce = undefined;
      return true;
    }

    const awaitingContinuation = proj.pendingExplosion
      && (proj.multiExplosionsRemaining ?? 0) > 0;
    if (awaitingContinuation) {
      proj.lastX = proj.sprite.x;
      proj.lastY = proj.sprite.y;
      return true;
    }

    if (proj.miniRocketDeferredExplosion) {
      if ((proj.simulatedAgeMs ?? 0) >= (proj.miniRocketNextExplosionAtAgeMs ?? 0)) {
        this.queueExplosion(
          proj,
          true,
          proj.miniRocketDeferredExplosionStopsAtObstacle ?? false,
        );
      }
      proj.lastX = proj.sprite.x;
      proj.lastY = proj.sprite.y;
      return true;
    }

    if (coreStage.miniRocketSafetyExpiredIds.has(proj.id)) {
      this.deps.release(proj);
      return false;
    }

    if (coreStage.lifetimeExpiredIds.has(proj.id) && proj.explosion) {
      projectileExplosions.push(this.createExplosionRequest(proj));
      this.deps.release(proj);
      return false;
    }

    if (coreStage.lifetimeExpiredIds.has(proj.id) && proj.impactCloud) {
      this.deps.onImpact(proj, proj.sprite.x, proj.sprite.y);
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
      && proj.miniRocketStageRangePx !== undefined
      && proj.explosion) {
      this.queueExplosion(proj, true);
      return true;
    }

    const dead = !awaitingContinuation
      && (coreStage.lifetimeExpiredIds.has(proj.id)
        || coreStage.rangeDepletedIds.has(proj.id)
        || coreStage.bounceLimitReachedIds.has(proj.id));
    if (dead) {
      if (proj.isFlame && coreStage.lifetimeExpiredIds.has(proj.id)) {
        this.deps.onNaturalFlameExpiry(proj);
      }
      if (proj.miniRocketSpent && coreStage.rangeDepletedIds.has(proj.id)) {
        this.emitSpentMiniRocketDestruction(proj);
      }
      this.deps.release(proj);
    } else if (proj.homing && proj.miniRocketStageRangePx === undefined) {
      const simulatedAge = proj.simulatedAgeMs ?? 0;
      this.deps.updateHoming(proj, simulatedAge);
    }

    const proximityPulse = proj.proximityPulse;
    if (proximityPulse && proximityPulse.radius > 0 && proximityPulse.damage > 0) {
      const interval = Math.max(50, proximityPulse.scanIntervalMs);
      const simulatedAge = proj.simulatedAgeMs ?? 0;
      if (proj.lastProximityPulseAt === undefined || simulatedAge - proj.lastProximityPulseAt >= interval) {
        proj.lastProximityPulseAt = simulatedAge;
        this.deps.onProximityPulse(proj);
      }
    }

    proj.lastX = proj.sprite.x;
    proj.lastY = proj.sprite.y;
    proj.bounceProcessedThisStep = false;
    proj.velocityAfterFirstBounce = undefined;
    return !dead;
  }

  private emitSpentMiniRocketDestruction(proj: ProjectileRuntimeRecord): void {
    if (proj.miniRocketDestructionFxEmitted) return;
    proj.miniRocketDestructionFxEmitted = true;
    this.deps.onSpentDestruction(proj);
  }

  private queueSpentMiniRocketDestruction(proj: ProjectileRuntimeRecord): void {
    if (proj.pendingDestroy) return;
    this.emitSpentMiniRocketDestruction(proj);
    this.deps.queueDestroy(proj);
  }

}
