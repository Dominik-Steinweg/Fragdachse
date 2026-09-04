import type {
  DetonableConfig,
  DetonatorConfig,
  LoadoutSlot,
} from '../types';
import type { ProjectileId } from './ProjectileSpawnPort';

/** Geometrische Suchanfrage der ASMD-/Detonator-Mechanik. */
export interface ProjectileDetonationSearchRequest {
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
  readonly shooterId: string;
  readonly detonator: DetonatorConfig;
}

/** Opaque, semantische Sicht eines detonierbaren Projectiles. */
export interface ProjectileDetonationTarget {
  readonly id: ProjectileId;
  readonly x: number;
  readonly y: number;
  readonly projectileOwnerId: string;
  readonly effect: DetonableConfig;
  readonly sourceId: string;
  readonly sourceSlot?: LoadoutSlot;
}

/** Bestätigtes Ergebnis einer autoritativen externen Detonation. */
export interface ProjectileDetonationOutcome extends ProjectileDetonationTarget {
  readonly detonatorOwnerId: string;
}

/** Schmale Runtime-Capability für externe Detonation/Consume-Interaktionen. */
export interface ProjectileExternalInteractionPort {
  searchDetonableProjectiles(
    request: ProjectileDetonationSearchRequest,
  ): readonly ProjectileDetonationTarget[];
  detonateProjectile(
    projectileId: ProjectileId,
    detonatorOwnerId: string,
  ): ProjectileDetonationOutcome | null;
  detonateOverlappingProjectiles(): readonly ProjectileDetonationOutcome[];
}

/** Schmale Puck-Capability für Player- und Enemy-Translocatoren. */
export interface TranslocatorPuckSpawnRequest {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly ownerId: string;
  readonly speed: number;
  readonly size: number;
  readonly color: number;
  readonly ownerColor?: number;
  readonly lifetimeMs: number;
  readonly maxBounces: number;
  readonly sourceId?: string;
  readonly frictionDelayMs?: number;
  readonly airFrictionDecayPerSec?: number;
  readonly bounceFrictionMultiplier?: number;
  readonly stopSpeedThreshold?: number;
}

export interface TranslocatorProjectilePort {
  spawnPuck(request: TranslocatorPuckSpawnRequest): ProjectileId;
  getPuckPosition(id: ProjectileId): { x: number; y: number } | null;
  consumePuck(id: ProjectileId): boolean;
}

/** Interne Brücke vom world-owned Owner in die noch bestehende Phaser-Simulation. */
export interface LegacyProjectileExternalInteractionAccess {
  searchDetonableProjectiles(
    detonableIds: ReadonlySet<ProjectileId>,
    request: ProjectileDetonationSearchRequest,
  ): readonly ProjectileDetonationTarget[];
  detonateProjectile(
    projectileId: ProjectileId,
    detonatorOwnerId: string,
  ): ProjectileDetonationOutcome | null;
  detonateOverlappingProjectiles(
    detonatorIds: ReadonlySet<ProjectileId>,
    detonableIds: ReadonlySet<ProjectileId>,
  ): readonly ProjectileDetonationOutcome[];
}
