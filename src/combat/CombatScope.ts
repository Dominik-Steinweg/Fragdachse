import type { CombatDamageKind, LoadoutSlot } from '../types';

/** Identity of one local Combat runtime. A rebuilt runtime gets a new generation. */
export interface CombatScope {
  readonly worldRevision: number;
  readonly runtimeGeneration: number;
}

export type CombatTargetIdentity =
  | { readonly kind: 'player'; readonly id: string }
  | { readonly kind: 'enemy'; readonly id: string }
  | { readonly kind: 'decoy'; readonly id: number }
  | { readonly kind: 'rock'; readonly id: number }
  | { readonly kind: 'base'; readonly id: string }
  | { readonly kind: 'train'; readonly id: string }
  | { readonly kind: 'construction'; readonly id: string | number };

/**
 * Identity below the World scope. Entity, Activity and Player-life generations stay separate:
 * the same authored/runtime id can name another target after any of these boundaries changes.
 */
export interface CombatTargetInstance {
  readonly entityGeneration: number;
  readonly activityRevision?: number;
  readonly lifeRevision?: number;
}

export type CombatTargetRef = CombatTargetIdentity & {
  readonly scope: CombatScope;
  readonly instance: CombatTargetInstance;
};

export type CombatSourceEntityRef =
  | { readonly kind: 'player'; readonly id: string }
  | { readonly kind: 'enemy'; readonly id: string }
  | { readonly kind: 'decoy'; readonly id: number }
  | { readonly kind: 'turret'; readonly id: string }
  | { readonly kind: 'base'; readonly id: string }
  | { readonly kind: 'world'; readonly id: string }
  | { readonly kind: 'environment'; readonly id: string };

/** Reward/stat attribution is intentionally independent from relationship allegiance. */
export type CombatAttributionRef =
  | { readonly kind: 'player'; readonly id: string }
  | { readonly kind: 'enemy'; readonly id: string }
  | { readonly kind: 'world'; readonly id: string };

/** Relationship input. `ownerId` is not an attribution fallback. */
export interface CombatAllegianceRef {
  readonly ownerId: string;
  readonly factionId?: string;
  readonly allowTeamDamage?: boolean;
}

export interface CombatSourceLineage {
  readonly parentEffectId?: string;
  readonly parentProjectileId?: number;
  readonly reflected?: boolean;
  readonly plasmaSwarmChild?: boolean;
  readonly plasmaSwarmOriginEnemyId?: string;
}

export interface CombatSourceCorrelation {
  readonly executionId?: string;
  readonly projectileId?: number;
  readonly shotId?: number;
}

/** Immutable source facts retained even when the originating entity has despawned. */
export interface CombatSource {
  readonly gameplaySource: CombatSourceEntityRef;
  readonly actor?: CombatSourceEntityRef;
  readonly attribution: CombatAttributionRef;
  readonly allegiance: CombatAllegianceRef;
  readonly authoredSourceId?: string;
  readonly sourceSlot?: LoadoutSlot;
  readonly origin: CombatDamageKind | 'support';
  readonly lineage?: CombatSourceLineage;
  readonly correlation?: CombatSourceCorrelation;
}

export function isSameCombatScope(left: CombatScope, right: CombatScope): boolean {
  return left.worldRevision === right.worldRevision
    && left.runtimeGeneration === right.runtimeGeneration;
}

export function isSameCombatTargetInstance(left: CombatTargetRef, right: CombatTargetRef): boolean {
  return left.kind === right.kind
    && left.id === right.id
    && isSameCombatScope(left.scope, right.scope)
    && left.instance.entityGeneration === right.instance.entityGeneration
    && left.instance.activityRevision === right.instance.activityRevision
    && left.instance.lifeRevision === right.instance.lifeRevision;
}

/** Stable only for this concrete target instance; not a wire key or global registry id. */
export function combatTargetInstanceKey(target: CombatTargetRef): string {
  return JSON.stringify([
    target.scope.worldRevision,
    target.scope.runtimeGeneration,
    target.kind,
    target.id,
    target.instance.entityGeneration,
    target.instance.activityRevision ?? null,
    target.instance.lifeRevision ?? null,
  ]);
}
