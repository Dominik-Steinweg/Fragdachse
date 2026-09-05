import type { ProjectileRuntimeRecord } from '../types';
import type { ProjectileMiniRocketCollectedOutcome } from './ProjectileGameplayPort';

/** Domain-facing hooks for the local Mini-Rocket state machine. */
export interface ProjectileMiniRocketStatePort {
  getOwnerPosition(ownerId: string): { x: number; y: number } | null;
  onOutcome(outcome: ProjectileMiniRocketCollectedOutcome): void;
}

export interface ProjectileMiniRocketProcessorDependencies {
  getOwnerPosition(ownerId: string): { x: number; y: number } | null;
  updateHoming(projectile: ProjectileRuntimeRecord, simulatedAgeMs: number, forceSearch?: boolean): boolean;
  resetHoming(projectile: ProjectileRuntimeRecord): void;
  onCollected(projectile: ProjectileRuntimeRecord, x: number, y: number): void;
}

/**
 * Local multi-frame state machine for Mini Rocket.
 *
 * The processor owns only the sparse state transitions. Projectile identity, spawning,
 * collision candidates and domain outcomes remain with the surrounding Projectile owner.
 */
export class ProjectileMiniRocketProcessor {
  constructor(private readonly deps: ProjectileMiniRocketProcessorDependencies) {}

  update(projectile: ProjectileRuntimeRecord, simulatedAgeMs: number): boolean {
    if (!projectile.homing || projectile.miniRocketStageRangePx === undefined) return false;

    if (projectile.miniRocketSpent && projectile.miniRocketPhase !== 'return') {
      this.enterReturn(projectile);
    }

    if (projectile.miniRocketPhase === 'coast') {
      if (simulatedAgeMs < (projectile.miniRocketCoastUntilAgeMs ?? 0)) return false;
      projectile.miniRocketPhase = 'attack';
      projectile.multiExplosionExcludedTargetKeys?.clear();
      this.deps.resetHoming(projectile);
      const foundTarget = this.deps.updateHoming(projectile, simulatedAgeMs, true);
      if (!foundTarget && projectile.miniRocketReturnEnabled && projectile.miniRocketHasExploded) {
        this.enterReturn(projectile);
      }
      return false;
    }

    if (projectile.miniRocketPhase === 'return') {
      if (projectile.miniRocketSpent) {
        const owner = this.deps.getOwnerPosition(projectile.ownerId);
        if (!owner) return false;
        const distance = Math.hypot(projectile.sprite.x - owner.x, projectile.sprite.y - owner.y);
        if (distance <= Math.max(1, projectile.miniRocketPickupRadius ?? 32)) {
          this.deps.onCollected(projectile, owner.x, owner.y);
          return true;
        }
        const steerInterval = Math.max(1, projectile.homing.retargetIntervalMs);
        if (projectile.lastHomingSearchAt === undefined
          || simulatedAgeMs - projectile.lastHomingSearchAt >= steerInterval) {
          projectile.lastHomingSearchAt = simulatedAgeMs;
          this.steerTowards(projectile, owner.x, owner.y);
        }
        return false;
      }

      const previousSearchAt = projectile.lastHomingSearchAt;
      const foundTarget = this.deps.updateHoming(projectile, simulatedAgeMs);
      if (foundTarget) {
        projectile.miniRocketPhase = 'attack';
        return false;
      }
      const owner = this.deps.getOwnerPosition(projectile.ownerId);
      if (!owner) return false;
      const distance = Math.hypot(projectile.sprite.x - owner.x, projectile.sprite.y - owner.y);
      if (distance <= Math.max(1, projectile.miniRocketPickupRadius ?? 32)) {
        this.deps.onCollected(projectile, owner.x, owner.y);
        return true;
      }
      if (projectile.lastHomingSearchAt !== previousSearchAt) {
        this.steerTowards(projectile, owner.x, owner.y);
      }
      return false;
    }

    const foundTarget = this.deps.updateHoming(projectile, simulatedAgeMs);
    if (foundTarget || !projectile.miniRocketReturnEnabled) return false;
    const mayReturn = projectile.miniRocketHasExploded
      || (projectile.remainingRangePx ?? Number.POSITIVE_INFINITY) <= Math.max(1, projectile.homing.searchRadius);
    if (mayReturn) this.enterReturn(projectile);
    return false;
  }

  completeExplosion(projectile: ProjectileRuntimeRecord): void {
    projectile.miniRocketHasExploded = true;
    if (projectile.miniRocketSpent) {
      projectile.explosion = undefined;
      projectile.multiExplosionExcludedTargetKeys?.clear();
      projectile.body.enable = true;
      const vx = projectile.miniRocketContinuationVx ?? projectile.body.velocity.x;
      const vy = projectile.miniRocketContinuationVy ?? projectile.body.velocity.y;
      this.setVelocityFromDirection(projectile, vx, vy);
      this.enterReturn(projectile);
      return;
    }
    projectile.miniRocketPhase = 'coast';
    projectile.miniRocketCoastUntilAgeMs = (projectile.simulatedAgeMs ?? 0)
      + Math.max(0, projectile.multiExplosionCoastMs ?? 0);
    projectile.miniRocketNextExplosionAtAgeMs = projectile.miniRocketCoastUntilAgeMs;
    projectile.miniRocketReturnReserveGranted = false;
    projectile.remainingRangePx = projectile.miniRocketStageRangePx;
    projectile.lastX = projectile.sprite.x;
    projectile.lastY = projectile.sprite.y;
    const vx = projectile.miniRocketContinuationVx ?? projectile.body.velocity.x;
    const vy = projectile.miniRocketContinuationVy ?? projectile.body.velocity.y;
    if (Math.hypot(vx, vy) > 0.001) {
      projectile.body.enable = true;
      this.setVelocityFromDirection(projectile, vx, vy);
    }
  }

  private enterReturn(projectile: ProjectileRuntimeRecord): void {
    const owner = this.deps.getOwnerPosition(projectile.ownerId);
    if (!owner) return;
    projectile.miniRocketPhase = 'return';
    this.deps.resetHoming(projectile);
    if (!projectile.miniRocketReturnReserveGranted) {
      const ownerDistance = Math.hypot(projectile.sprite.x - owner.x, projectile.sprite.y - owner.y);
      const buffer = Math.max(0, projectile.miniRocketReturnRangeBuffer ?? 0.5);
      projectile.remainingRangePx = Math.max(projectile.remainingRangePx ?? 0, ownerDistance * (1 + buffer));
      projectile.miniRocketReturnReserveGranted = true;
    }
    this.steerTowards(projectile, owner.x, owner.y);
  }

  private steerTowards(projectile: ProjectileRuntimeRecord, targetX: number, targetY: number): void {
    const velocitySpeed = projectile.body.velocity.length();
    const normalFlightSpeed = this.getFlightSpeed(projectile);
    const currentSpeed = normalFlightSpeed > 0.001 ? normalFlightSpeed : velocitySpeed;
    if (currentSpeed <= 0.001) return;
    const targetAngle = Math.atan2(targetY - projectile.sprite.y, targetX - projectile.sprite.x);
    const currentAngle = velocitySpeed > 0.001
      ? Math.atan2(projectile.body.velocity.y, projectile.body.velocity.x)
      : targetAngle;
    const maxTurn = (projectile.homing?.maxTurnDegreesPerStep ?? 0) * Math.PI / 180;
    const angleDelta = wrapAngle(targetAngle - currentAngle);
    const nextAngle = currentAngle + Math.max(-maxTurn, Math.min(maxTurn, angleDelta));
    projectile.body.setVelocity(Math.cos(nextAngle) * currentSpeed, Math.sin(nextAngle) * currentSpeed);
  }

  private getFlightSpeed(projectile: ProjectileRuntimeRecord): number {
    const completedExplosions = Math.max(0, projectile.miniRocketExplosionIndex ?? 0);
    const explosionSpeedFactor = Math.max(0.1, 1 - completedExplosions * 0.2);
    return (projectile.initialSpeed ?? 0) * (projectile.timeBubbleFactor ?? 1) * explosionSpeedFactor;
  }

  private setVelocityFromDirection(projectile: ProjectileRuntimeRecord, vx: number, vy: number): void {
    const directionLength = Math.hypot(vx, vy);
    const speed = this.getFlightSpeed(projectile);
    if (directionLength <= 0.001 || speed <= 0.001) return;
    projectile.body.setVelocity((vx / directionLength) * speed, (vy / directionLength) * speed);
  }
}

function wrapAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}
