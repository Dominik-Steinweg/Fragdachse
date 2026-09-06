import type { ProjectileRuntimeRecord } from './ProjectileRuntimeRecord';
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
    if (!projectile.spec.flight.homing || projectile.spec.flight.miniRocket.stageRangePx === undefined) return false;

    if (projectile.miniRocket.spent && projectile.miniRocket.phase !== 'return') {
      this.enterReturn(projectile);
    }

    if (projectile.miniRocket.phase === 'coast') {
      if (simulatedAgeMs < (projectile.miniRocket.coastUntilAgeMs ?? 0)) return false;
      projectile.miniRocket.phase = 'attack';
      projectile.interaction.multiExplosionExcludedTargetKeys?.clear();
      this.deps.resetHoming(projectile);
      const foundTarget = this.deps.updateHoming(projectile, simulatedAgeMs, true);
      if (!foundTarget && projectile.spec.flight.miniRocket.returnEnabled && projectile.miniRocket.hasExploded) {
        this.enterReturn(projectile);
      }
      return false;
    }

    if (projectile.miniRocket.phase === 'return') {
      if (projectile.miniRocket.spent) {
        const owner = this.deps.getOwnerPosition(projectile.provenance.allegiance.ownerId);
        if (!owner) return false;
        const distance = Math.hypot(projectile.physics.sprite.x - owner.x, projectile.physics.sprite.y - owner.y);
        if (distance <= Math.max(1, projectile.spec.flight.miniRocket.pickupRadius ?? 32)) {
          this.deps.onCollected(projectile, owner.x, owner.y);
          return true;
        }
        const steerInterval = Math.max(1, projectile.spec.flight.homing.retargetIntervalMs);
        if (projectile.interaction.guidance!.state.lastSearchAtSimulatedMs === undefined
          || simulatedAgeMs - projectile.interaction.guidance!.state.lastSearchAtSimulatedMs >= steerInterval) {
          projectile.interaction.guidance!.state.lastSearchAtSimulatedMs = simulatedAgeMs;
          this.steerTowards(projectile, owner.x, owner.y);
        }
        return false;
      }

      const previousSearchAt = projectile.interaction.guidance!.state.lastSearchAtSimulatedMs;
      const foundTarget = this.deps.updateHoming(projectile, simulatedAgeMs);
      if (foundTarget) {
        projectile.miniRocket.phase = 'attack';
        return false;
      }
      const owner = this.deps.getOwnerPosition(projectile.provenance.allegiance.ownerId);
      if (!owner) return false;
      const distance = Math.hypot(projectile.physics.sprite.x - owner.x, projectile.physics.sprite.y - owner.y);
      if (distance <= Math.max(1, projectile.spec.flight.miniRocket.pickupRadius ?? 32)) {
        this.deps.onCollected(projectile, owner.x, owner.y);
        return true;
      }
      if (projectile.interaction.guidance!.state.lastSearchAtSimulatedMs !== previousSearchAt) {
        this.steerTowards(projectile, owner.x, owner.y);
      }
      return false;
    }

    const foundTarget = this.deps.updateHoming(projectile, simulatedAgeMs);
    if (foundTarget || !projectile.spec.flight.miniRocket.returnEnabled) return false;
    const mayReturn = projectile.miniRocket.hasExploded
      || (projectile.remainingRangePx ?? Number.POSITIVE_INFINITY) <= Math.max(1, projectile.spec.flight.homing.searchRadius);
    if (mayReturn) this.enterReturn(projectile);
    return false;
  }

  completeExplosion(projectile: ProjectileRuntimeRecord): void {
    projectile.miniRocket.hasExploded = true;
    if (projectile.miniRocket.spent) {
      projectile.interaction.explosion = undefined;
      projectile.interaction.multiExplosionExcludedTargetKeys?.clear();
      projectile.physics.body.enable = true;
      const vx = projectile.miniRocket.continuationVx ?? projectile.physics.body.velocity.x;
      const vy = projectile.miniRocket.continuationVy ?? projectile.physics.body.velocity.y;
      this.setVelocityFromDirection(projectile, vx, vy);
      this.enterReturn(projectile);
      return;
    }
    projectile.miniRocket.phase = 'coast';
    projectile.miniRocket.coastUntilAgeMs = (projectile.simulatedAgeMs ?? 0)
      + Math.max(0, projectile.spec.interaction.multiExplosionCoastMs ?? 0);
    projectile.miniRocket.nextExplosionAtAgeMs = projectile.miniRocket.coastUntilAgeMs;
    projectile.miniRocket.returnReserveGranted = false;
    projectile.remainingRangePx = projectile.spec.flight.miniRocket.stageRangePx;
    projectile.lastX = projectile.physics.sprite.x;
    projectile.lastY = projectile.physics.sprite.y;
    const vx = projectile.miniRocket.continuationVx ?? projectile.physics.body.velocity.x;
    const vy = projectile.miniRocket.continuationVy ?? projectile.physics.body.velocity.y;
    if (Math.hypot(vx, vy) > 0.001) {
      projectile.physics.body.enable = true;
      this.setVelocityFromDirection(projectile, vx, vy);
    }
  }

  private enterReturn(projectile: ProjectileRuntimeRecord): void {
    const owner = this.deps.getOwnerPosition(projectile.provenance.allegiance.ownerId);
    if (!owner) return;
    projectile.miniRocket.phase = 'return';
    this.deps.resetHoming(projectile);
    if (!projectile.miniRocket.returnReserveGranted) {
      const ownerDistance = Math.hypot(projectile.physics.sprite.x - owner.x, projectile.physics.sprite.y - owner.y);
      const buffer = Math.max(0, projectile.spec.flight.miniRocket.returnRangeBuffer ?? 0.5);
      projectile.remainingRangePx = Math.max(projectile.remainingRangePx ?? 0, ownerDistance * (1 + buffer));
      projectile.miniRocket.returnReserveGranted = true;
    }
    this.steerTowards(projectile, owner.x, owner.y);
  }

  private steerTowards(projectile: ProjectileRuntimeRecord, targetX: number, targetY: number): void {
    const velocitySpeed = projectile.physics.body.velocity.length();
    const normalFlightSpeed = this.getFlightSpeed(projectile);
    const currentSpeed = normalFlightSpeed > 0.001 ? normalFlightSpeed : velocitySpeed;
    if (currentSpeed <= 0.001) return;
    const targetAngle = Math.atan2(targetY - projectile.physics.sprite.y, targetX - projectile.physics.sprite.x);
    const currentAngle = velocitySpeed > 0.001
      ? Math.atan2(projectile.physics.body.velocity.y, projectile.physics.body.velocity.x)
      : targetAngle;
    const maxTurn = (projectile.spec.flight.homing?.maxTurnDegreesPerStep ?? 0) * Math.PI / 180;
    const angleDelta = wrapAngle(targetAngle - currentAngle);
    const nextAngle = currentAngle + Math.max(-maxTurn, Math.min(maxTurn, angleDelta));
    projectile.physics.body.setVelocity(Math.cos(nextAngle) * currentSpeed, Math.sin(nextAngle) * currentSpeed);
  }

  private getFlightSpeed(projectile: ProjectileRuntimeRecord): number {
    const completedExplosions = Math.max(0, projectile.miniRocket.explosionIndex ?? 0);
    const explosionSpeedFactor = Math.max(0.1, 1 - completedExplosions * 0.2);
    return (projectile.spec.flight.speed ?? 0) * (projectile.timeBubbleFactor ?? 1) * explosionSpeedFactor;
  }

  private setVelocityFromDirection(projectile: ProjectileRuntimeRecord, vx: number, vy: number): void {
    const directionLength = Math.hypot(vx, vy);
    const speed = this.getFlightSpeed(projectile);
    if (directionLength <= 0.001 || speed <= 0.001) return;
    projectile.physics.body.setVelocity((vx / directionLength) * speed, (vy / directionLength) * speed);
  }
}

function wrapAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}
