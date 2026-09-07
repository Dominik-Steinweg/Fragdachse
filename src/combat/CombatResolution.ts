import type { CombatRelationshipResult, CombatTargetSnapshot } from './CombatCapabilities';
import type {
  CombatDamageRequest, CombatDamageMutationOutcome, CombatResolvedDamage,
  CombatSourceFactor, CombatSupportRequest, CombatSupportMutationOutcome,
  TargetDamageMutationPort, TargetSupportMutationPort, TargetMutationRejected,
  TargetMutationNoEffect, TargetMutationRejectionReason,
} from './CombatMutation';
import { freezeTargetMutationOutcome } from './CombatMutation';
import type { CombatSource, CombatTargetRef } from './CombatScope';
import { isSameCombatTargetInstance } from './CombatScope';

export interface CombatResolutionTarget {
  readonly snapshot: CombatTargetSnapshot;
  readonly relationship: CombatRelationshipResult;
  readonly burrowed?: boolean;
}

/** Host inputs belong to the calling stage, not a hidden clock or global RNG in a rule. */
export interface CombatResolutionContext {
  readonly nowMs: number;
  readonly random: () => number;
  readonly authorized: boolean;
  readonly acceptsScope: (target: CombatTargetRef) => boolean;
  readonly resolveTarget: (target: CombatTargetRef, source: CombatSource) => CombatResolutionTarget | null;
  /** Entry-specific, still pending source factors. DoTs/objects do not get implicit runtime P. */
  readonly sourceFactors?: readonly CombatSourceFactor[];
  readonly resolveOutgoing?: (
    request: CombatDamageRequest, amount: number, allowCritical: boolean,
    nowMs: number, random: () => number,
  ) => { readonly amount: number; readonly isCritical: boolean };
  readonly incomingMultiplier?: (target: CombatTargetRef, nowMs: number) => number;
  /** Direction/category shield is before M/T; the World-space projectile barrier is not here. */
  readonly blockBeforeModifiers?: (request: CombatDamageRequest, amount: number, nowMs: number) => boolean;
  /** Target-area protection receives post-M/T damage, before Player reduction. */
  readonly blockAtTarget?: (request: CombatDamageRequest, amount: number, nowMs: number) => boolean;
  readonly damageReduction?: (target: CombatTargetRef, nowMs: number) => number;
}

export function resolveCombatDamage(
  request: CombatDamageRequest,
  context: CombatResolutionContext,
): CombatResolvedDamage | TargetMutationRejected | TargetMutationNoEffect {
  const reject = (reason: TargetMutationRejectionReason) => rejected(request, reason);
  if (!context.authorized) return reject('not-eligible');
  if (!context.acceptsScope(request.target)) return reject('stale-scope');
  if (request.source.origin !== request.damageKind) return reject('not-eligible');
  if (!validAmount(request.basis.amount) || !Number.isFinite(context.nowMs)) return reject('invalid-value');
  if (request.basis.kind === 'derived-outcome'
    && (!validAmount(request.basis.parentActualDamage) || !validAmount(request.basis.fraction)
      || request.basis.amount !== request.basis.parentActualDamage * request.basis.fraction)) return reject('invalid-value');
  const target = context.resolveTarget(request.target, request.source);
  if (!target) return reject('target-missing');
  if (!isSameCombatTargetInstance(target.snapshot.target, request.target)) return reject('stale-target');
  const state = target.snapshot.state;
  if (state.kind === 'combatant' ? !state.alive : state.destroyed) return reject('target-dead');
  if (!target.relationship.canDamage || (target.burrowed && !request.burrowException)) return reject('not-eligible');
  if (target.snapshot.position
    && (!Number.isFinite(target.snapshot.position.x) || !Number.isFinite(target.snapshot.position.y))) return reject('invalid-value');

  const noEffect = (reason: TargetMutationNoEffect['reason']): TargetMutationNoEffect => freezeTargetMutationOutcome({
    kind: 'accepted-no-effect', outcomeId: request.outcomeId, target: request.target,
    source: request.source, resultingState: state, reason,
  });
  const sourceFactors: CombatSourceFactor[] = request.basis.kind === 'source-resolved'
    ? [...request.basis.sourceFactors] : [];
  if (sourceFactors.some(factor => !validAmount(factor.multiplier))) return reject('invalid-value');
  const derived = request.entry === 'derived-reaction';
  const newSource = !derived || request.newSourceModifiers === true;
  let amount = request.basis.amount;
  for (const factor of newSource ? context.sourceFactors ?? [] : []) {
    if (!validAmount(factor.multiplier)) return reject('invalid-value');
    // A factor's semantic kind marks its ownership, not its numeric value.
    if (sourceFactors.some(applied => applied.kind === factor.kind)) continue;
    amount *= factor.multiplier;
    sourceFactors.push(factor);
  }
  if (!validAmount(amount)) return reject('invalid-value');
  if (amount === 0) return noEffect('zero-effect');
  if (context.blockBeforeModifiers?.(request, amount, context.nowMs)) return noEffect('blocked');
  const modified = resolveCombatDamageModifiers({
    amount, sourceFactors, allowCritical: request.allowCritical, nowMs: context.nowMs, random: context.random,
    outgoing: newSource && context.resolveOutgoing
      ? (value, allowCritical, nowMs, random) => context.resolveOutgoing!(request, value, allowCritical, nowMs, random)
      : undefined,
    incoming: nowMs => context.incomingMultiplier?.(request.target, nowMs) ?? 1,
  });
  if (!modified) return reject('invalid-value');
  amount = modified.amount;
  if (amount > 0 && context.blockAtTarget?.(request, amount, context.nowMs)) return noEffect('blocked');
  const reduction = context.damageReduction?.(request.target, context.nowMs) ?? 0;
  if (!Number.isFinite(reduction)) return reject('invalid-value');
  const reductionFactor = 1 - Math.max(0, Math.min(1, reduction));
  return {
    amount: amount * reductionFactor, damageKind: request.damageKind, basis: request.basis,
    sourceFactors: modified.sourceFactors,
    targetFactors: [
      { kind: 'incoming-modifier', multiplier: modified.incomingMultiplier, resolvedAt: 'commit' },
      { kind: 'damage-reduction', multiplier: reductionFactor, resolvedAt: 'commit' },
    ],
    isCritical: modified.isCritical,
  };
}

/** Numeric M/T rule shared with the temporary World adapters until their P9 writer cutover. */
export function resolveCombatDamageModifiers(input: {
  readonly amount: number;
  readonly sourceFactors: readonly CombatSourceFactor[];
  readonly allowCritical: boolean;
  readonly nowMs: number;
  readonly random: () => number;
  readonly outgoing?: (amount: number, allowCritical: boolean, nowMs: number, random: () => number) => {
    readonly amount: number; readonly isCritical: boolean;
  };
  readonly incoming: (nowMs: number) => number;
}): { amount: number; isCritical: boolean; sourceFactors: CombatSourceFactor[]; incomingMultiplier: number } | null {
  if (!validAmount(input.amount) || !Number.isFinite(input.nowMs)) return null;
  const sourceFactors = [...input.sourceFactors];
  let amount = input.amount;
  let isCritical = sourceFactors.some(factor => factor.kind === 'critical');
  if (amount > 0 && !sourceFactors.some(factor => factor.kind === 'outgoing-modifier') && input.outgoing) {
    let randomValue: number | undefined;
    const randomOnce = () => randomValue ?? (randomValue = input.random());
    const outgoing = input.outgoing(amount, input.allowCritical && !isCritical, input.nowMs, randomOnce);
    if (!validAmount(outgoing.amount)) return null;
    sourceFactors.push({ kind: 'outgoing-modifier', multiplier: outgoing.amount / amount, resolvedAt: 'commit' });
    amount = outgoing.amount;
    isCritical ||= input.allowCritical && outgoing.isCritical;
  }
  const incoming = input.incoming(input.nowMs);
  if (!Number.isFinite(incoming)) return null;
  const incomingMultiplier = Math.max(0, incoming);
  amount *= incomingMultiplier;
  return validAmount(amount) ? { amount, isCritical, sourceFactors, incomingMultiplier } : null;
}

export function applyCombatDamage(
  request: CombatDamageRequest, context: CombatResolutionContext, mutation: TargetDamageMutationPort,
): CombatDamageMutationOutcome {
  const damage = resolveCombatDamage(request, context);
  if ('kind' in damage) return damage;
  return mutation.commitDamage({ outcomeId: request.outcomeId, target: request.target, source: request.source, damage });
}

export interface CombatSupportContext extends Pick<CombatResolutionContext,
  'nowMs' | 'authorized' | 'acceptsScope' | 'resolveTarget'> {
  readonly armorGainMultiplier?: (target: CombatTargetRef, nowMs: number) => number;
}

export function applyCombatSupport(
  request: CombatSupportRequest, context: CombatSupportContext, mutation: TargetSupportMutationPort,
): CombatSupportMutationOutcome {
  if (!context.authorized) return rejected(request, 'not-eligible');
  if (!context.acceptsScope(request.target)) return rejected(request, 'stale-scope');
  if (!validAmount(request.amount) || !Number.isFinite(context.nowMs)) return rejected(request, 'invalid-value');
  const target = context.resolveTarget(request.target, request.source);
  if (!target) return rejected(request, 'target-missing');
  if (!isSameCombatTargetInstance(target.snapshot.target, request.target)) return rejected(request, 'stale-target');
  const state = target.snapshot.state;
  if (state.kind === 'combatant' ? !state.alive : state.destroyed) return rejected(request, 'target-dead');
  if (!target.relationship.canSupport) return rejected(request, 'not-eligible');
  const multiplier = request.supportKind === 'armor' ? context.armorGainMultiplier?.(request.target, context.nowMs) ?? 1 : 1;
  if (!Number.isFinite(multiplier)) return rejected(request, 'invalid-value');
  const amount = request.amount * Math.max(0, multiplier);
  if (!validAmount(amount)) return rejected(request, 'invalid-value');
  return mutation.commitSupport({ ...request, amount });
}

function validAmount(amount: number): boolean { return Number.isFinite(amount) && amount >= 0; }

function rejected(
  request: CombatDamageRequest | CombatSupportRequest, reason: TargetMutationRejectionReason,
): TargetMutationRejected {
  return freezeTargetMutationOutcome({
    kind: 'rejected', outcomeId: request.outcomeId, target: request.target, source: request.source, reason,
  });
}
