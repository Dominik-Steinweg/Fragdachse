import * as Phaser from 'phaser';
import type { ProjectileHomingConfig, HomingTargetType, TrackedProjectile } from '../types';

/** Ein vom Host gemeldetes mögliches Ziel für ein zielsuchendes Projektil. */
export interface HomingTargetCandidate {
  id: string;
  type: HomingTargetType;
  x: number;
  y: number;
}

export type HomingTargetProvider = (config: ProjectileHomingConfig, ownerId: string) => HomingTargetCandidate[];
export type HomingLineOfSightChecker = (sx: number, sy: number, ex: number, ey: number) => boolean;

const DEFAULT_HOMING_TARGET_TYPES: readonly HomingTargetType[] = ['players'];

/**
 * Host-seitige Zielsuche und Lenkung für zielsuchende Projektile.
 * Hält die von der Szene injizierten Provider (Zielkandidaten + Line-of-Sight) und
 * dreht die Projektil-Velocity pro Schritt Richtung des gewählten Ziels.
 */
export class ProjectileHomingController {
  private targetProvider: HomingTargetProvider | null = null;
  private lineOfSightChecker: HomingLineOfSightChecker | null = null;

  setTargetProvider(provider: HomingTargetProvider | null): void {
    this.targetProvider = provider;
  }

  setLineOfSightChecker(checker: HomingLineOfSightChecker | null): void {
    this.lineOfSightChecker = checker;
  }

  /** Lenkt ein zielsuchendes Projektil pro Host-Schritt Richtung seines (ggf. neu gewählten) Ziels. */
  update(proj: TrackedProjectile, simulatedAgeMs: number): void {
    const homing = proj.homing;
    if (!homing || !this.targetProvider) return;
    if (simulatedAgeMs < homing.acquireDelayMs) return;

    const lastSearchAt = proj.lastHomingSearchAt ?? 0;
    if (lastSearchAt > 0 && simulatedAgeMs - lastSearchAt < homing.retargetIntervalMs) return;
    proj.lastHomingSearchAt = simulatedAgeMs;

    const target = this.selectTarget(proj, homing);
    if (!target) {
      proj.lockedTargetId = null;
      proj.lockedTargetType = undefined;
      return;
    }

    proj.lockedTargetId = target.id;
    proj.lockedTargetType = target.type;

    const currentSpeed = proj.body.velocity.length();
    if (currentSpeed <= 0.001) return;

    const currentAngle = Math.atan2(proj.body.velocity.y, proj.body.velocity.x);
    const targetAngle = Phaser.Math.Angle.Between(proj.sprite.x, proj.sprite.y, target.x, target.y);
    const maxTurn = Phaser.Math.DegToRad(homing.maxTurnDegreesPerStep);
    const angleDelta = Phaser.Math.Angle.Wrap(targetAngle - currentAngle);
    const nextAngle = currentAngle + Phaser.Math.Clamp(angleDelta, -maxTurn, maxTurn);

    proj.body.setVelocity(
      Math.cos(nextAngle) * currentSpeed,
      Math.sin(nextAngle) * currentSpeed,
    );
  }

  private selectTarget(proj: TrackedProjectile, homing: ProjectileHomingConfig): HomingTargetCandidate | null {
    if (!this.targetProvider) return null;

    const targetTypes = homing.targetTypes ?? DEFAULT_HOMING_TARGET_TYPES;
    const requireLineOfSight = homing.requireLineOfSight === true;
    const excludeOwner = homing.excludeOwner !== false;
    const searchRadius = Math.max(1, homing.searchRadius);
    const distanceWeight = Math.max(0, homing.distanceWeight ?? 1);
    const forwardWeight = Math.max(0, homing.forwardWeight ?? 1);
    const velocity = proj.body.velocity;
    const speed = velocity.length();
    const dirX = speed > 0.001 ? velocity.x / speed : 0;
    const dirY = speed > 0.001 ? velocity.y / speed : 0;

    const candidates = this.targetProvider(homing, proj.ownerId).filter(candidate => {
      if (!targetTypes.includes(candidate.type)) return false;
      if (excludeOwner && candidate.id === proj.ownerId) return false;

      const distance = Phaser.Math.Distance.Between(proj.sprite.x, proj.sprite.y, candidate.x, candidate.y);
      if (distance > searchRadius) return false;
      if (requireLineOfSight && this.lineOfSightChecker) {
        return this.lineOfSightChecker(proj.sprite.x, proj.sprite.y, candidate.x, candidate.y);
      }
      return true;
    });

    if (candidates.length === 0) return null;

    if (proj.lockedTargetId) {
      const locked = candidates.find(candidate => candidate.id === proj.lockedTargetId && candidate.type === proj.lockedTargetType);
      if (locked) return locked;
    }

    let bestTarget: HomingTargetCandidate | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidates) {
      const distance = Phaser.Math.Distance.Between(proj.sprite.x, proj.sprite.y, candidate.x, candidate.y);
      const distanceScore = 1 - Phaser.Math.Clamp(distance / searchRadius, 0, 1);
      let forwardScore = 0.5;

      if (speed > 0.001) {
        const toTargetX = (candidate.x - proj.sprite.x) / distance;
        const toTargetY = (candidate.y - proj.sprite.y) / distance;
        forwardScore = Phaser.Math.Clamp((dirX * toTargetX + dirY * toTargetY + 1) * 0.5, 0, 1);
      }

      const score = distanceScore * distanceWeight + forwardScore * forwardWeight;
      if (score > bestScore) {
        bestScore = score;
        bestTarget = candidate;
      }
    }

    return bestTarget;
  }
}
