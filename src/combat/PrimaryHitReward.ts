import type { CombatSource, CombatTargetRef } from './CombatScope';
import type { LoadoutSlot } from '../types';

/** Resource-owned source modifier, captured once at activation or ownership transfer. */
export interface AdrenalineGainBasis {
  readonly playerId: string;
  readonly multiplier: number;
}

export interface PrimaryHitRewardScope {
  readonly worldRevision: number;
  readonly runtimeGeneration: number;
  /** null identifies an explicitly bound World practice reward lifetime. */
  readonly activityRevision: number | null;
}

export interface PrimaryHitRewardScopeReadPort {
  getPrimaryHitRewardScope(): PrimaryHitRewardScope | null;
}

export interface PrimaryHitRewardComponent {
  readonly kind: 'weapon-hit' | 'melee-hit-bonus';
  /** Weapon/build and split modifiers are already applied; general gain is still pending. */
  readonly amount: number;
  readonly appliedModifiers: readonly ('weapon-build' | 'split')[];
}

/** Explicit eligibility; neither DamageKind nor sourceSlot may manufacture this intent. */
export interface PrimaryHitAdrenalineRewardIntent {
  readonly branchId: string;
  readonly components: readonly PrimaryHitRewardComponent[];
  readonly gainBasis: AdrenalineGainBasis;
  /** Reward attribution only; must not alter the canonical damage modifier context. */
  readonly sourceSlot?: LoadoutSlot;
  /** Canonical source position captured with activation/ownership transfer, never a render muzzle. */
  readonly sourcePosition?: { readonly x: number; readonly y: number };
  /** undefined before spawn capture, null when no reward lifetime was bound at activation. */
  readonly scope?: PrimaryHitRewardScope | null;
}

/** Neutral post-commit receipt. Combat owns no materialized reward state. */
export interface PrimaryHitAdrenalineRewardFact extends PrimaryHitRewardScope {
  readonly id: string;
  readonly outcomeId: string;
  readonly source: CombatSource;
  readonly target: CombatTargetRef;
  readonly creatorId: string;
  readonly intent: PrimaryHitAdrenalineRewardIntent;
  readonly authoredValue: number;
  readonly resolvedValue: number;
  readonly origin: { readonly x: number; readonly y: number };
  readonly createdAt: number;
  readonly distance?: number;
  readonly seed: number;
}

export function createPrimaryHitRewardIntent(
  branchId: string,
  gainBasis: AdrenalineGainBasis | null | undefined,
  weaponAmount: number,
  meleeBonus = 0,
  scope?: PrimaryHitRewardScope | null,
  sourcePosition?: { readonly x: number; readonly y: number },
  sourceSlot?: LoadoutSlot,
): PrimaryHitAdrenalineRewardIntent | undefined {
  if (!gainBasis) return undefined;
  const components: PrimaryHitRewardComponent[] = [];
  if (Number.isFinite(weaponAmount) && weaponAmount > 0) {
    components.push(Object.freeze({ kind: 'weapon-hit', amount: weaponAmount, appliedModifiers: Object.freeze(['weapon-build'] as const) }));
  }
  if (Number.isFinite(meleeBonus) && meleeBonus > 0) {
    components.push(Object.freeze({ kind: 'melee-hit-bonus', amount: meleeBonus, appliedModifiers: Object.freeze(['weapon-build'] as const) }));
  }
  return components.length ? Object.freeze({ branchId, gainBasis, scope, sourceSlot, sourcePosition: sourcePosition ? Object.freeze({ ...sourcePosition }) : undefined, components: Object.freeze(components) }) : undefined;
}

export function scalePrimaryHitRewardIntent(
  intent: PrimaryHitAdrenalineRewardIntent | undefined,
  factor: number,
): PrimaryHitAdrenalineRewardIntent | undefined {
  if (!intent) return undefined;
  return Object.freeze({ ...intent, components: Object.freeze(intent.components.map(component => Object.freeze({
    ...component, amount: component.amount * factor,
    appliedModifiers: Object.freeze([...component.appliedModifiers, 'split' as const]),
  }))) });
}
