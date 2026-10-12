import * as v from 'valibot';
import { CombatAreaPoseSchema, type CombatAreaPose } from '../combat/CombatAreaAttack';

/** Host-owned timing; presentation samples this timeline without deciding hits. */
export interface EnemyMeleeTiming {
  readonly hitDelayMs: number;
  readonly strikeMs: number;
  readonly recoveryMs: number;
}

export interface EnemyClawAttack {
  readonly attackId: string;
  readonly weaponId: string;
  readonly startedAt: number;
  readonly strikeAt: number;
  readonly hitAt: number;
  readonly endsAt: number;
  readonly angle: number;
  readonly range: number;
  readonly arcDegrees: number;
}

export interface EnemyClawState {
  readonly revision: number;
  readonly attack: EnemyClawAttack | null;
}

export interface EnemyClawEvent {
  readonly enemyId: string;
  readonly entityGeneration: number;
  readonly state: EnemyClawState;
}

export interface EnemyClawNetworkPort {
  broadcast(event: EnemyClawEvent): void;
  subscribe(handler: (event: EnemyClawEvent) => void): () => void;
}

const id = v.pipe(v.string(), v.trim(), v.minLength(1));
const revision = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const generation = v.pipe(revision, v.minValue(1));
const time = v.pipe(v.number(), v.finite());
export const EnemyClawSlotSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('body') }),
  v.strictObject({ kind: v.literal('part'), partId: id, partGeneration: generation, cycleId: generation }),
]);
export type EnemyClawSlot = v.InferOutput<typeof EnemyClawSlotSchema>;

/** Canonical area contract for new attacks. No duplicate sector fields on a lane.
 * Existing EnemyClawAttack/State are the pre-cutover sector wire contract; C/E migrate their
 * consumers explicitly. The adapter below is the only legacy -> area normalization boundary.
 */
export const EnemyAreaClawAttackSchema = v.pipe(v.strictObject({
  attackId: id, weaponId: id, pose: CombatAreaPoseSchema,
  presentation: v.picklist(['claw', 'ink', 'tentacle', 'slam']),
  startedAt: time, strikeAt: time, hitAt: time, endsAt: time,
}), v.check(a => a.startedAt < a.strikeAt && a.strikeAt < a.hitAt && a.hitAt < a.endsAt, 'Invalid claw timeline'),
v.check(a => (a.presentation !== 'ink' || a.pose.geometry.kind === 'sector')
  && (!['tentacle', 'slam'].includes(a.presentation) || a.pose.geometry.kind === 'lane'), 'Presentation/geometry mismatch'));
export type EnemyAreaClawAttack = v.InferOutput<typeof EnemyAreaClawAttackSchema>;
export const EnemyAreaClawStateSchema = v.strictObject({ revision, attack: v.nullable(EnemyAreaClawAttackSchema) });
export type EnemyAreaClawState = v.InferOutput<typeof EnemyAreaClawStateSchema>;
export const EnemyAreaClawEventSchema = v.pipe(v.strictObject({
  worldRevision: revision, activityRevision: generation, enemyId: id, entityGeneration: generation,
  slot: EnemyClawSlotSchema, state: EnemyAreaClawStateSchema,
}), v.check(e => e.state.attack === null || (e.state.attack.presentation === 'tentacle') === (e.slot.kind === 'part'),
'Tentacles require independent part slots'));
export type EnemyAreaClawEvent = v.InferOutput<typeof EnemyAreaClawEventSchema>;

/** A confirmation always names an actual attack; a clear event cannot masquerade as an impact. */
export interface EnemyAreaClawImpact extends Omit<EnemyAreaClawEvent, 'state'> {
  readonly revision: number;
  readonly attack: EnemyAreaClawAttack;
}

export interface EnemyAreaClawNetworkPort {
  broadcast(event: EnemyAreaClawEvent): void;
  subscribe(handler: (event: EnemyAreaClawEvent) => void): () => void;
}

export function readEnemyAreaClawEvent(raw: unknown): EnemyAreaClawEvent | null {
  const result = v.safeParse(EnemyAreaClawEventSchema, raw);
  return result.success ? result.output : null;
}

export function normalizeEnemyClawAttack(attack: EnemyClawAttack, origin: Pick<CombatAreaPose, 'originX' | 'originY'>): EnemyAreaClawAttack {
  const { range, arcDegrees, angle, ...timeline } = attack;
  return v.parse(EnemyAreaClawAttackSchema, { ...timeline, presentation: 'claw',
    pose: { ...origin, angle, geometry: { kind: 'sector', range, arcDegrees } } });
}

export const EMPTY_ENEMY_CLAW_STATE: EnemyClawState = Object.freeze({ revision: 0, attack: null });

export function isEnemyClawEvent(value: unknown): value is EnemyClawEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as EnemyClawEvent;
  return typeof event.enemyId === 'string' && Number.isSafeInteger(event.entityGeneration)
    && event.entityGeneration > 0 && isEnemyClawState(event.state);
}

export function isEnemyClawState(value: unknown): value is EnemyClawState {
  if (!value || typeof value !== 'object') return false;
  const { revision, attack } = value as EnemyClawState;
  if (!Number.isSafeInteger(revision) || revision < 0) return false;
  if (attack === null) return true;
  return !!attack && typeof attack.attackId === 'string' && attack.attackId.length > 0
    && typeof attack.weaponId === 'string'
    && [attack.startedAt, attack.strikeAt, attack.hitAt, attack.endsAt, attack.angle, attack.range, attack.arcDegrees].every(Number.isFinite)
    && attack.startedAt < attack.strikeAt && attack.strikeAt < attack.hitAt && attack.hitAt < attack.endsAt
    && attack.range > 0 && attack.arcDegrees > 0 && attack.arcDegrees <= 360;
}

/** Clip-local indices. The authored markers separate slow anticipation from the fast strike. */
export function clawFrameIndex(attack: EnemyClawAttack, now: number, count: number, markers: { strike: number; impact: number }): number {
  const [fromTime, toTime, fromFrame, toFrame] = now < attack.strikeAt
    ? [attack.startedAt, attack.strikeAt, 0, markers.strike]
    : now < attack.hitAt ? [attack.strikeAt, attack.hitAt, markers.strike, markers.impact]
      : [attack.hitAt, attack.endsAt, markers.impact, count - 1];
  const progress = Math.max(0, Math.min(1, (now - fromTime) / (toTime - fromTime)));
  return Math.min(count - 1, Math.floor(fromFrame + (toFrame - fromFrame) * progress));
}
