import * as v from 'valibot';
import { combatTargetInstanceKey, type CombatScope, type CombatTargetRef } from './CombatScope';

const id = v.pipe(v.string(), v.trim(), v.minLength(1));
const revision = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const generation = v.pipe(revision, v.minValue(1));
const finite = v.pipe(v.number(), v.finite());
export const BossTargetRefSchema = v.strictObject({
  kind: v.literal('enemy'), id,
  scope: v.strictObject({ worldRevision: revision, runtimeGeneration: generation }),
  instance: v.strictObject({ entityGeneration: generation, activityRevision: generation }),
});
export type BossTargetRef = v.InferOutput<typeof BossTargetRefSchema>;

export const CombatPartIdentitySchema = v.strictObject({
  boss: BossTargetRefSchema, partId: id, partGeneration: generation, cycleId: generation,
});
export type CombatPartIdentity = v.InferOutput<typeof CombatPartIdentitySchema>;

/** Physical query identity; deliberately NOT a CombatTargetRef and never owns HP. */
export const CombatPartContactSchema = v.pipe(v.strictObject({
  identity: CombatPartIdentitySchema, contactId: id, hitboxProfileId: id,
  x: finite, y: finite, angle: finite,
  targetableFrom: finite, targetableUntil: finite,
}), v.check(c => c.targetableFrom < c.targetableUntil, 'Empty contact lifetime'));
export type CombatPartContact = v.InferOutput<typeof CombatPartContactSchema>;

/** Local exposed geometry, independent of the outgoing damage lane and sprite bounds. */
export const CombatPartHitShapeSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('circle'), x: finite, y: finite,
    radius: v.pipe(finite, v.minValue(Number.MIN_VALUE)) }),
  v.strictObject({ kind: v.literal('capsule'), fromX: finite, fromY: finite, toX: finite, toY: finite,
    radius: v.pipe(finite, v.minValue(Number.MIN_VALUE)) }),
]);
export type CombatPartHitShape = v.InferOutput<typeof CombatPartHitShapeSchema>;

export interface CombatPartContactSnapshot {
  readonly contact: CombatPartContact;
  readonly shapes: readonly CombatPartHitShape[];
}

/** Host-only A -> B query boundary, shared by hitscan, sweeps, AoE, melee and auto targeting.
 * Revalidate scope, boss/part generation, cycle, lifetime, current boss life and contact blockers
 * at impact. A hidden body must not enter candidate lists or consume projectiles.
 */
export interface CombatPartContactReadPort {
  getContacts(nowMs: number): readonly CombatPartContactSnapshot[];
  resolveContact(identity: CombatPartIdentity, contactId: string, nowMs: number): CombatPartContactSnapshot | null;
}

export interface CombatPartStatusPort {
  /** Status (including stun) stays on this part. It never becomes a boss status. */
  applyPartStatus(identity: CombatPartIdentity, status: 'stun' | 'slow' | 'burn', untilMs: number): boolean;
}

export const CombatPartTransferPolicySchema = v.strictObject({
  damageMultiplier: v.pipe(finite, v.minValue(Number.MIN_VALUE)), ownHp: v.literal(false), severable: v.literal(false),
  deduplication: v.literal('event-boss-max'), status: v.literal('contact-only'),
  hiddenBodyDot: v.literal('suppress-ticks-keep-expiry'),
});
export type CombatPartTransferPolicy = v.InferOutput<typeof CombatPartTransferPolicySchema>;

/** One projectile/pellet or one continuous tick = one event; chain returns reuse their event.
 * Freeze valid contributions including contact-local falloff and choose the highest. Apply the
 * remaining shared source/boss factors once, preserving the damage-basis factor ledger, then
 * perform one canonical boss commit.
 * Preserve source/attribution/correlation; no recursive applyDamage and no client bypass flag.
 * Receipts retain the winning physical contact for FX; rewards/HP remain on the boss.
 */
export interface CombatDamageEventIdentity {
  readonly scope: CombatScope;
  readonly activityRevision: number;
  readonly eventId: string;
}

export function combatDamageEventTargetKey(event: CombatDamageEventIdentity, target: CombatTargetRef): string {
  return JSON.stringify([event.scope.worldRevision, event.scope.runtimeGeneration,
    event.activityRevision, event.eventId, combatTargetInstanceKey(target)]);
}

export interface CombatPartHitReceipt {
  readonly event: CombatDamageEventIdentity;
  readonly part: CombatPartIdentity;
  readonly contactId: string;
  readonly attackId?: string;
  readonly x: number;
  readonly y: number;
  readonly outcomeId: string;
}

export function readCombatPartContact(raw: unknown): CombatPartContact | null {
  const result = v.safeParse(CombatPartContactSchema, raw);
  return result.success ? result.output : null;
}
