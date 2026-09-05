import type {
  EnergyBallVariant,
  ProjectileEnergyInjectorPayload,
  ProjectileHomingConfig,
  ProjectileStyle,
  TracerConfig,
} from '../types';
import type { ProjectileDirectHitSpec } from './ProjectileSpawnRequest';
import type { ProjectileInteractionAugment } from './ProjectileTravelPort';
import type { ProjectileId } from './ProjectileSpawnPort';
import type { ProjectileAllegianceRef, ProjectileProvenance } from './ProjectileSpawnRequest';
import type { ProjectileDefenseResolution } from './ProjectileInteractionPorts';
import type { ProjectileTargetRef } from './ProjectileTargetPort';
import type {
  ProjectileCombatExplosionOutcome,
  ProjectileCombatExplosionRequest,
} from './ProjectileExplosionPort';

/** Combat targets are a strict subset of the world collision target space. */
export type ProjectileCombatTargetRef = Extract<
  ProjectileTargetRef,
  { readonly kind: 'player' | 'enemy' | 'decoy' }
>;

/** Semantic support augment consumed by the direct-impact adapter without leaking a record. */
export interface ProjectileEnergyInjectorAugment {
  readonly kind: 'energy-injector';
  readonly payload: ProjectileEnergyInjectorPayload;
  readonly provenance: ProjectileProvenance;
}

/** Hit/reaction data needed by the AK47 behavior owner. */
export interface ProjectileAk47HitContext {
  readonly ownerId: string;
  readonly shotId: number;
  readonly fireSuperiorityShot: boolean;
}

/** Result of the strategic-target reaction; Combat applies the authoritative damage. */
export interface ProjectileAk47DirectImpact {
  readonly damageMultiplier: number;
  readonly explosionRadius?: number;
  readonly explosionDamageFraction?: number;
}

/** Semantic reaction data consumed by the Projectile owner for a Plasma swarm spawn. */
export interface ProjectilePlasmaSwarmImpact {
  readonly ownerId: string;
  readonly enemyId: string;
  readonly x: number;
  readonly y: number;
  readonly projectileCount: number;
  readonly normalDamage: number;
  readonly normalSize: number;
  readonly normalSpeed: number;
  readonly normalRange: number;
  readonly explosionRadius: number;
  readonly explosionDamage: number;
  readonly explosionSlowFraction: number;
  readonly color: number;
  readonly ownerColor?: number;
  readonly sourceId: string;
  readonly sourceSlot?: import('../types').LoadoutSlot;
  readonly homing?: ProjectileHomingConfig;
  readonly projectileStyle?: ProjectileStyle;
  readonly energyBallVariant?: EnergyBallVariant;
  readonly tracerConfig?: TracerConfig;
  readonly allowTeamDamage?: boolean;
  readonly baseDamageMult?: number;
}

/** Passive metadata emitted with an authoritative direct-impact result. */
export interface ProjectileReactionMetadata {
  readonly adrenalineGain?: number;
  readonly ak47?: ProjectileAk47HitContext;
  readonly plasmaSwarm?: ProjectilePlasmaSwarmImpact;
}

/** Direct combat request; collision geometry and contact/lifecycle policy stay in Projectile. */
export interface ProjectileDirectImpactRequest {
  readonly projectileId: ProjectileId;
  readonly target: ProjectileCombatTargetRef;
  readonly impact: { readonly x: number; readonly y: number };
  readonly velocity: { readonly x: number; readonly y: number };
  readonly provenance: ProjectileProvenance;
  readonly directHit: ProjectileDirectHitSpec;
  readonly augments: readonly (ProjectileInteractionAugment | ProjectileEnergyInjectorAugment)[];
}

/** Authoritative result of Combat-owned target mutation. */
export interface ProjectileDirectImpactOutcome {
  readonly accepted: boolean;
  readonly blocked?: boolean;
  readonly actualDamage?: number;
  readonly becameDead?: boolean;
  readonly defense?: ProjectileDefenseResolution;
  readonly reaction?: ProjectileReactionMetadata;
}

/** Stable projectile-to-combat boundary for direct target effects. */
export interface ProjectileCombatPort {
  resolveDirectImpact(request: ProjectileDirectImpactRequest): ProjectileDirectImpactOutcome;
  /** Resolves only the Combat/AoE part; Environment and World Effects stay outside Combat. */
  resolveExplosionCombat(request: ProjectileCombatExplosionRequest): ProjectileCombatExplosionOutcome;
  /** Host frame time is supplied by the Runtime; the port must not read a wall clock. */
  setHostFrameTime?(nowMs: number): void;
}

/** Compact payload used by the current support reaction callback. */
export interface ProjectileEnergyInjectorImpact {
  readonly projectileId: ProjectileId;
  readonly ownerId: string;
  readonly provenance: ProjectileProvenance;
  readonly payload: ProjectileEnergyInjectorPayload;
  readonly targetType: 'player' | 'enemy';
  readonly targetId: string;
  readonly x: number;
  readonly y: number;
}

/** Helper kept at the boundary so callers cannot accidentally treat world targets as combat. */
export function asProjectileCombatTarget(target: ProjectileTargetRef): ProjectileCombatTargetRef | null {
  return target.kind === 'player' || target.kind === 'enemy' || target.kind === 'decoy'
    ? target
    : null;
}

/** Allegiance is deliberately carried separately from the source/attribution dimensions. */
export function projectileCombatOwner(provenance: ProjectileProvenance): ProjectileAllegianceRef {
  return provenance.allegiance;
}
