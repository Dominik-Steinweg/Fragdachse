import type { BurnOnHitConfig, GroundFireCellEffect, ProjectilePathEffectKind } from '../types';
import type { ProjectileId } from './ProjectileSpawnPort';
import type { ProjectileProvenance } from './ProjectileSpawnRequest';

/** Authored fire effect emitted by a projectile along its travelled path. */
export interface ProjectileFireTrailCapability {
  readonly effect: GroundFireCellEffect;
  readonly halfWidthCells: number;
  /** Stable grid identity used by the path owner for local emission dedupe. */
  readonly cellKey: string;
}

/** AWP-style corridor rules evaluated against one travelled segment. */
export interface ProjectileAwpCorridorCapability {
  readonly halfWidth: number;
  readonly damage: number;
  readonly dotDurationMs?: number;
  readonly dotTickIntervalMs?: number;
  readonly knockback?: number;
  readonly knockbackDurationMs?: number;
}

/** Semantic travel capabilities; presentation styles are deliberately absent. */
export interface ProjectileTravelCapabilities {
  readonly canReceiveFireImbue: boolean;
  readonly pathEffect?: {
    readonly kind?: ProjectilePathEffectKind;
    readonly fireTrail?: ProjectileFireTrailCapability;
    readonly awpCorridor?: ProjectileAwpCorridorCapability;
  };
}

/** World-local movement view consumed by travel/environment systems. */
export interface ProjectileTravelSample {
  readonly projectileId: ProjectileId;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly provenance: ProjectileProvenance;
  readonly capabilities: ProjectileTravelCapabilities;
}

export interface ProjectileTravelReadPort {
  getTravelSamples(): readonly ProjectileTravelSample[];
}

/** An interaction property acquired while travelling, owned by Projectile Runtime. */
export interface ProjectileBurnAugment {
  readonly burn: BurnOnHitConfig;
  readonly provenance: ProjectileProvenance;
}

/** Reserved for future non-burn imbues in the same augment family. */
export interface ProjectileImbueAugment {
  readonly sourceId: string;
  readonly provenance: ProjectileProvenance;
}

export type ProjectileInteractionAugment = ProjectileBurnAugment | ProjectileImbueAugment;

/** Environment owner asks Projectile Runtime to apply a travel-acquired burn. */
export interface ProjectileEnvironmentInteractionPort {
  addBurnAugment(projectileId: ProjectileId, augment: ProjectileBurnAugment): boolean;
}
