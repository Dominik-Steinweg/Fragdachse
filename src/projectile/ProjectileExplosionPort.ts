import type { GrenadeEffectConfig, ProjectileExplosionConfig } from '../types';
import type { ProjectileId } from './ProjectileSpawnPort';
import type { ProjectileProvenance } from './ProjectileSpawnRequest';

/**
 * Small, named continuation contract for multi-stage projectile explosions.
 * The domain resolver reports the targets it actually damaged; the projectile
 * owner decides whether and how the projectile continues afterwards.
 */
export interface ProjectileExplosionContinuation {
  readonly projectileId: ProjectileId;
  readonly excludedTargetKey?: string;
}

/** Typed domain request emitted by projectile simulation at a terminal explosion. */
export interface ProjectileExplosionRequest {
  readonly projectileId?: ProjectileId;
  readonly x: number;
  readonly y: number;
  readonly provenance: ProjectileProvenance;
  readonly effect: ProjectileExplosionConfig;
  readonly continuation?: ProjectileExplosionContinuation;
}

/** Typed terminal payload emitted by grenade flight/fuse resolution. */
export interface ProjectileGrenadePayloadRequest {
  readonly projectileId: ProjectileId;
  readonly x: number;
  readonly y: number;
  readonly provenance: ProjectileProvenance;
  readonly effect: GrenadeEffectConfig;
}

/** Authoritative combat/domain result needed by projectile continuation. */
export interface ProjectileExplosionOutcome {
  readonly damagedTargetKeys: readonly string[];
}

/** Same-frame feedback boundary from the domain resolver to projectile continuation state. */
export interface ProjectileExplosionContinuationPort {
  completeProjectileExplosion(
    projectileId: ProjectileId,
    outcome: ProjectileExplosionOutcome,
  ): void;
}

/** Combat-only portion of projectile explosion resolution. */
export interface ProjectileCombatExplosionRequest {
  readonly projectileId?: ProjectileId;
  readonly x: number;
  readonly y: number;
  readonly provenance: ProjectileProvenance;
  readonly effect: ProjectileExplosionConfig;
}

export interface ProjectileCombatExplosionOutcome {
  readonly damagedTargetKeys: readonly string[];
}

/**
 * Domain orchestration boundary for projectile-owned explosions.
 * Environment, world effects and presentation remain with their canonical owners.
 */
export interface ProjectileExplosionResolutionPort {
  resolveProjectileExplosion(request: ProjectileExplosionRequest): ProjectileExplosionOutcome;
}
