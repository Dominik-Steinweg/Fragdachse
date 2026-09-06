import type { CombatDamageKind } from '../types';
import type { CombatAllegianceRef, CombatSource, CombatTargetRef } from './CombatScope';

export type CombatOutcomeId = string;

export interface CombatantVitalsSnapshot {
  readonly kind: 'combatant';
  readonly hp: number;
  readonly maxHp: number;
  readonly armor: number;
  readonly maxArmor: number;
  readonly alive: boolean;
}

export interface CombatIntegritySnapshot {
  readonly kind: 'integrity';
  readonly integrity: number;
  readonly maxIntegrity: number;
  readonly destroyed: boolean;
}

export type CombatTargetStateSnapshot = CombatantVitalsSnapshot | CombatIntegritySnapshot;

export type CombatSourceFactorKind =
  | 'runtime-power'
  | 'loadout-slot'
  | 'automated-source'
  | 'outgoing-modifier'
  | 'critical'
  | 'falloff'
  | 'self-damage'
  | 'object-damage';

export interface CombatSourceFactor {
  readonly kind: CombatSourceFactorKind;
  readonly multiplier: number;
  readonly resolvedAt: 'execution' | 'impact' | 'commit';
}

export type CombatTargetFactorKind =
  | 'incoming-modifier'
  | 'defense'
  | 'damage-reduction'
  | 'armor';

export interface CombatTargetFactor {
  readonly kind: CombatTargetFactorKind;
  readonly multiplier: number;
  readonly resolvedAt: 'commit';
}

/** Authored payload whose source-side runtime factors have not been applied yet. */
export interface AuthoredDamageBasis {
  readonly kind: 'authored';
  readonly amount: number;
}

/** Payload that already includes the listed source-side factors. */
export interface SourceResolvedDamageBasis {
  readonly kind: 'source-resolved';
  readonly amount: number;
  readonly sourceFactors: readonly CombatSourceFactor[];
}

/** Child damage derived from confirmed parent damage, never from requested damage or later HP. */
export interface DerivedDamageBasis {
  readonly kind: 'derived-outcome';
  readonly amount: number;
  readonly parentOutcomeId: CombatOutcomeId;
  readonly parentActualDamage: number;
  readonly fraction: number;
}

export type CombatDamageBasis =
  | AuthoredDamageBasis
  | SourceResolvedDamageBasis
  | DerivedDamageBasis;

export interface CombatResolvedDamage {
  readonly amount: number;
  readonly damageKind: CombatDamageKind;
  readonly basis: CombatDamageBasis;
  readonly sourceFactors: readonly CombatSourceFactor[];
  readonly targetFactors: readonly CombatTargetFactor[];
  readonly isCritical: boolean;
}

export type TargetMutationRejectionReason =
  | 'stale-scope'
  | 'stale-target'
  | 'target-missing'
  | 'target-dead'
  | 'not-eligible'
  | 'invalid-value';

export interface TargetMutationRejected {
  readonly kind: 'rejected';
  readonly outcomeId: CombatOutcomeId;
  readonly target: CombatTargetRef;
  readonly source: CombatSource;
  readonly reason: TargetMutationRejectionReason;
}

export interface TargetMutationNoEffect {
  readonly kind: 'accepted-no-effect';
  readonly outcomeId: CombatOutcomeId;
  readonly target: CombatTargetRef;
  readonly source: CombatSource;
  readonly reason: 'blocked' | 'immune' | 'zero-effect';
  readonly resultingState: CombatTargetStateSnapshot;
}

/** Minimal immutable facts captured before terminal target removal. */
export interface CombatTerminalFacts {
  readonly target: CombatTargetRef;
  readonly position: { readonly x: number; readonly y: number };
  readonly targetAllegiance?: CombatAllegianceRef;
  readonly targetCategory?: string;
  readonly rewardEligible?: boolean;
  readonly activeStatusSources?: readonly CombatSource[];
  readonly presentation?: Readonly<Record<string, unknown>>;
}

interface TargetDamageAppliedBase {
  readonly kind: 'damage-applied';
  readonly outcomeId: CombatOutcomeId;
  readonly target: CombatTargetRef;
  readonly source: CombatSource;
  readonly damage: CombatResolvedDamage;
  /** HP + armor, or integrity, actually consumed by this mutation; never overkill. */
  readonly actualDamage: number;
  readonly hpLost: number;
  readonly armorLost: number;
  readonly integrityLost: number;
  readonly resultingState: CombatTargetStateSnapshot;
}

export interface TargetDamageSurvivedOutcome extends TargetDamageAppliedBase {
  readonly transition: { readonly kind: 'none' };
  /** Healing committed by a lethal guard remains separate from the damage receipt. */
  readonly rescueHealing: number;
}

export interface TargetDamageTerminalOutcome extends TargetDamageAppliedBase {
  readonly transition: {
    readonly kind: 'dead' | 'destroyed';
    readonly facts: CombatTerminalFacts;
  };
  readonly rescueHealing?: never;
}

export type TargetDamageAppliedOutcome =
  | TargetDamageSurvivedOutcome
  | TargetDamageTerminalOutcome;

export type CombatSupportKind = 'heal' | 'armor' | 'repair' | 'cap-adjustment';

export interface TargetSupportAppliedOutcome {
  readonly kind: 'support-applied';
  readonly outcomeId: CombatOutcomeId;
  readonly target: CombatTargetRef;
  readonly source: CombatSource;
  readonly supportKind: CombatSupportKind;
  readonly actualAmount: number;
  readonly resultingState: CombatTargetStateSnapshot;
  /** Revive is a separate life transition and cannot be smuggled through Support. */
  readonly revived: false;
}

export type TargetMutationOutcome =
  | TargetMutationRejected
  | TargetMutationNoEffect
  | TargetDamageAppliedOutcome
  | TargetSupportAppliedOutcome;

export interface TargetDamageMutationRequest {
  readonly outcomeId: CombatOutcomeId;
  readonly target: CombatTargetRef;
  readonly source: CombatSource;
  readonly damage: CombatResolvedDamage;
}

export interface TargetSupportMutationRequest {
  readonly outcomeId: CombatOutcomeId;
  readonly target: CombatTargetRef;
  readonly source: CombatSource;
  readonly supportKind: CombatSupportKind;
  readonly amount: number;
}

export type CombatDamageMutationOutcome =
  | TargetMutationRejected
  | TargetMutationNoEffect
  | TargetDamageAppliedOutcome;

export type CombatSupportMutationOutcome =
  | TargetMutationRejected
  | TargetMutationNoEffect
  | TargetSupportAppliedOutcome;

export interface TargetDamageMutationPort {
  commitDamage(request: TargetDamageMutationRequest): CombatDamageMutationOutcome;
}

export interface TargetSupportMutationPort {
  commitSupport(request: TargetSupportMutationRequest): CombatSupportMutationOutcome;
}

interface CombatDamageRequestBase {
  readonly outcomeId: CombatOutcomeId;
  readonly target: CombatTargetRef;
  readonly source: CombatSource;
  /** Target-side modifiers and defense are unresolved until the canonical commit. */
  readonly targetScaling: 'pending';
  readonly allowCritical: boolean;
}

export interface DirectCombatDamageRequest extends CombatDamageRequestBase {
  readonly entry: 'projectile-direct' | 'hitscan' | 'melee';
  readonly damageKind: 'direct';
  readonly basis: AuthoredDamageBasis | SourceResolvedDamageBasis;
}

export interface AreaCombatDamageRequest extends CombatDamageRequestBase {
  readonly entry: 'combat-aoe' | 'projectile-explosion';
  readonly damageKind: 'explosion';
  /** Per-target falloff/self/runtime factors are already resolved before target commit. */
  readonly basis: SourceResolvedDamageBasis;
}

export interface DamageOverTimeRequest extends CombatDamageRequestBase {
  readonly entry: 'damage-over-time';
  readonly damageKind: 'burn' | 'ground';
  readonly basis: SourceResolvedDamageBasis;
}

export interface DerivedCombatDamageRequest extends CombatDamageRequestBase {
  readonly entry: 'derived-reaction';
  readonly damageKind: 'chain' | 'reflect';
  readonly basis: DerivedDamageBasis;
}

export interface BaseCombatDamageRequest extends CombatDamageRequestBase {
  readonly entry: 'base';
  readonly damageKind: CombatDamageKind;
  readonly basis: AuthoredDamageBasis | SourceResolvedDamageBasis;
}

export interface WorldObjectDamageRequest extends CombatDamageRequestBase {
  readonly entry: 'world-object';
  readonly damageKind: CombatDamageKind;
  /** Rock/Construction/Train callers provide their object factors and do not gain implicit P. */
  readonly basis: SourceResolvedDamageBasis;
}

export interface AutomatedCombatDamageRequest extends CombatDamageRequestBase {
  readonly entry: 'automated';
  readonly damageKind: CombatDamageKind;
  /** Frozen/read-at-execution owner factors are named in `sourceFactors`. */
  readonly basis: SourceResolvedDamageBasis;
}

export type CombatDamageRequest =
  | DirectCombatDamageRequest
  | AreaCombatDamageRequest
  | DamageOverTimeRequest
  | DerivedCombatDamageRequest
  | BaseCombatDamageRequest
  | WorldObjectDamageRequest
  | AutomatedCombatDamageRequest;

export interface CombatSupportRequest {
  readonly outcomeId: CombatOutcomeId;
  readonly target: CombatTargetRef;
  readonly source: CombatSource;
  readonly supportKind: CombatSupportKind;
  readonly amount: number;
}

export interface CombatDamagePort {
  applyDamage(request: CombatDamageRequest): CombatDamageMutationOutcome;
}

export interface CombatSupportPort {
  applySupport(request: CombatSupportRequest): CombatSupportMutationOutcome;
}

/** Adapter from resolved Damage capability input to the canonical target-writer contract. */
export function toTargetDamageMutation(
  request: CombatDamageRequest,
  damage: CombatResolvedDamage,
): TargetDamageMutationRequest {
  return {
    outcomeId: request.outcomeId,
    target: request.target,
    source: request.source,
    damage,
  };
}

/** Support remains a separate mutation family and is never encoded as signed Damage. */
export function toTargetSupportMutation(
  request: CombatSupportRequest,
): TargetSupportMutationRequest {
  return {
    outcomeId: request.outcomeId,
    target: request.target,
    source: request.source,
    supportKind: request.supportKind,
    amount: request.amount,
  };
}

export function createDerivedDamageBasis(
  parent: TargetDamageAppliedOutcome,
  fraction: number,
): DerivedDamageBasis {
  if (!Number.isFinite(fraction) || fraction < 0) {
    throw new RangeError('Derived damage fraction must be finite and non-negative');
  }
  return {
    kind: 'derived-outcome',
    amount: parent.actualDamage * fraction,
    parentOutcomeId: parent.outcomeId,
    parentActualDamage: parent.actualDamage,
    fraction,
  };
}
