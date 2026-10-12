import * as v from 'valibot';
import { BossTargetRefSchema, CombatPartContactSchema, type BossTargetRef } from '../combat/CombatPartContact';
import { CombatAreaPoseSchema } from '../combat/CombatAreaAttack';
import { EnemyAreaClawStateSchema } from './EnemyClawAttack';
import type { CombatTargetRef } from '../combat/CombatScope';
import type { CombatAreaPose } from '../combat/CombatAreaAttack';
import type { ProjectileGrenadePayloadRequest } from '../projectile/ProjectileExplosionPort';
import type { ProjectileSpawnPort } from '../projectile/ProjectileSpawnPort';

const id = v.pipe(v.string(), v.trim(), v.minLength(1));
const sequence = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const generation = v.pipe(sequence, v.minValue(1));
const time = v.pipe(v.number(), v.finite());
const pose = v.strictObject({ x: time, y: time, angle: time });

export type KrakenSpecialAction = 'kraken-ink' | 'kraken-eggs' | 'kraken-dive' | 'kraken-submerged'
  | 'kraken-surface' | 'kraken-ashore' | 'kraken-slam' | 'kraken-spines';

/** Absolute host anchors, never animation frame callbacks. Death is legal from EVERY phase.
 * phaseTwoPending never clamps HP. Finish diving, retract existing parts, surface, then exit.
 */
export const KrakenPhaseSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('waiting'), startsAt: time }),
  v.strictObject({ kind: v.literal('intro'), startedAt: time, emergeAt: time, cameraReturnedAt: time }),
  v.strictObject({ kind: v.literal('surfaced'), startedAt: time, nextDiveAt: time }),
  v.strictObject({ kind: v.literal('diving'), startedAt: time, submergedAt: time, endsAt: time }),
  v.strictObject({ kind: v.literal('submerged'), startedAt: time, stopSpawningAt: time }),
  v.strictObject({ kind: v.literal('surfacing'), startedAt: time, vulnerableAt: time, endsAt: time, recoveryEndsAt: time }),
  v.strictObject({ kind: v.literal('ashore'), corridorId: id, startedAt: time, moveAt: time, endsAt: time,
    recoveryEndsAt: time, gripAt: time, heaveAt: time, blocked: v.boolean() }),
  v.strictObject({ kind: v.literal('land'), startedAt: time }),
  v.strictObject({ kind: v.literal('dying'), startedAt: time, endsAt: time,
    terminalPose: pose, asset: v.picklist(['water', 'land']), submerged: v.boolean() }),
  v.strictObject({ kind: v.literal('removed'), removedAt: time }),
]);
export type KrakenPhase = v.InferOutput<typeof KrakenPhaseSchema>;

function orderedPhase(p: KrakenPhase): boolean {
  switch (p.kind) {
    case 'intro': return p.startedAt < p.emergeAt && p.emergeAt <= p.cameraReturnedAt;
    case 'surfaced': return p.startedAt <= p.nextDiveAt;
    case 'diving': return p.startedAt < p.submergedAt && p.submergedAt <= p.endsAt;
    case 'submerged': return p.startedAt < p.stopSpawningAt;
    case 'surfacing': return p.startedAt < p.vulnerableAt && p.vulnerableAt <= p.endsAt && p.endsAt <= p.recoveryEndsAt;
    case 'ashore': return p.startedAt < p.moveAt && p.moveAt <= p.gripAt && p.gripAt < p.heaveAt
      && p.heaveAt <= p.endsAt && p.endsAt <= p.recoveryEndsAt;
    case 'dying': return p.startedAt < p.endsAt;
    default: return true;
  }
}

export const KrakenEggCastSchema = v.pipe(v.strictObject({
  kind: v.literal('eggs'), castId: id, startedAt: time, releaseAt: time, endsAt: time,
}), v.check(a => a.startedAt < a.releaseAt && a.releaseAt < a.endsAt, 'Invalid egg release anchors'));
export type KrakenEggCast = v.InferOutput<typeof KrakenEggCastSchema>;
/** Six dorsal spines fire in ascending order; each leaves its socket exactly at its release anchor. */
export const KrakenSpineVolleySchema = v.pipe(v.strictObject({
  kind: v.literal('spines'), castId: id, startedAt: time, raiseAt: time,
  releaseAt: v.pipe(v.array(time), v.length(6)), endsAt: time,
}), v.check(a => a.startedAt < a.raiseAt && a.raiseAt <= a.releaseAt[0]!
  && a.releaseAt.every((t, i) => i === 0 || a.releaseAt[i - 1]! < t) && a.releaseAt[5]! < a.endsAt, 'Invalid spine volley anchors'));
export type KrakenSpineVolley = v.InferOutput<typeof KrakenSpineVolleySchema>;
/** A spine that left its socket: absent until regrowStartsAt, then grows back until readyAt. Present spines are not listed. */
export const KrakenSpineStateSchema = v.pipe(v.strictObject({
  index: v.pipe(sequence, v.maxValue(5)), castId: id, firedAt: time, regrowStartsAt: time, readyAt: time,
}), v.check(s => s.firedAt <= s.regrowStartsAt && s.regrowStartsAt < s.readyAt, 'Invalid spine regrowth anchors'));
export type KrakenSpineState = v.InferOutput<typeof KrakenSpineStateSchema>;
export const KrakenBodyActionSchema = v.variant('kind', [
  KrakenEggCastSchema, KrakenSpineVolleySchema,
  v.strictObject({ kind: v.literal('ink'), attackId: id, startedAt: time, chargeAt: time, spitAt: time, endsAt: time }),
  v.strictObject({ kind: v.literal('slam'), attackId: id }),
]);
export type KrakenBodyAction = v.InferOutput<typeof KrakenBodyActionSchema>;

export const KrakenInkCloudSchema = v.pipe(v.strictObject({
  attackId: id, pose: CombatAreaPoseSchema, spitAt: time, cloudEndsAt: time,
}), v.check(c => c.pose.geometry.kind === 'sector' && c.spitAt < c.cloudEndsAt, 'Invalid ink afterglow'));
export type KrakenInkCloud = v.InferOutput<typeof KrakenInkCloudSchema>;

export const KrakenTentacleStateSchema = v.pipe(v.strictObject({
  contact: CombatPartContactSchema, revision: sequence,
  phase: v.picklist(['rise', 'hover', 'slam', 'retract']),
  startedAt: time, hoverAt: time, retractAt: time, endsAt: time,
  claw: EnemyAreaClawStateSchema,
}), v.check(t => t.startedAt < t.hoverAt && t.hoverAt < t.retractAt && t.retractAt < t.endsAt
  && t.contact.targetableFrom >= t.startedAt && t.contact.targetableUntil <= t.endsAt,
'Invalid tentacle lifetime'), v.check(t => t.claw.attack === null || (t.claw.attack.presentation === 'tentacle'
  && t.claw.attack.startedAt >= t.startedAt && t.claw.attack.endsAt <= t.retractAt), 'Invalid part claw'));
export type KrakenTentacleState = v.InferOutput<typeof KrakenTentacleStateSchema>;

/** HP remains exclusively in the egg Enemy entity. Selection is a registry ID, not copied config. */
export const KrakenEggStateSchema = v.pipe(v.strictObject({
  eggId: id, entityGeneration: generation, bossId: id, bossGeneration: generation,
  castId: id, originId: id, broodTableId: id, enemyKind: id,
  landedAt: time, hatchStartedAt: time, spawnAt: time, endsAt: time,
  status: v.picklist(['incubating', 'hatching', 'terminal']),
}), v.check(e => e.landedAt < e.hatchStartedAt && e.hatchStartedAt <= e.spawnAt && e.spawnAt < e.endsAt,
'Invalid incubation/hatch anchors'));
export type KrakenEggState = v.InferOutput<typeof KrakenEggStateSchema>;

/** Reliable revisioned projection. Full arrays replace parts/brood; they are never indexed slots.
 * Enemy-State owns live pose/HP and bodyClaw; Projectile-State owns flights. No copied HP here.
 */
export const KrakenStateSchema = v.pipe(v.strictObject({
  boss: BossTargetRefSchema, revision: sequence, cycleId: generation, habitatId: id,
  phase: KrakenPhaseSchema, phaseTwoPending: v.boolean(),
  bodyTargetability: v.strictObject({ revision: sequence, effectiveAt: time,
    mode: v.picklist(['exposed', 'hidden', 'protected']) }),
  movement: v.picklist(['water-anchored', 'water-approach', 'ashore', 'land', 'locked']),
  bodyAction: v.nullable(KrakenBodyActionSchema),
  inkClouds: v.array(KrakenInkCloudSchema), tentacles: v.array(KrakenTentacleStateSchema), eggs: v.array(KrakenEggStateSchema),
  spines: v.array(KrakenSpineStateSchema),
}), v.check(s => orderedPhase(s.phase), 'Invalid phase anchors'), v.check(s => {
  if (new Set(s.spines.map(p => p.index)).size !== s.spines.length) return false;
  if (s.bodyAction?.kind === 'spines' && s.phase.kind !== 'surfaced' && s.phase.kind !== 'land') return false;
  const parts = new Set<string>();
  const contacts = new Set<string>();
  const attacks = new Set<string>();
  for (const t of s.tentacles) {
    const p = t.contact.identity;
    if (parts.has(p.partId) || contacts.has(t.contact.contactId) || p.cycleId !== s.cycleId
      || p.boss.id !== s.boss.id || p.boss.instance.entityGeneration !== s.boss.instance.entityGeneration
      || p.boss.instance.activityRevision !== s.boss.instance.activityRevision
      || p.boss.scope.worldRevision !== s.boss.scope.worldRevision
      || p.boss.scope.runtimeGeneration !== s.boss.scope.runtimeGeneration) return false;
    parts.add(p.partId); contacts.add(t.contact.contactId);
    if (t.claw.attack) {
      if (attacks.has(t.claw.attack.attackId)) return false;
      attacks.add(t.claw.attack.attackId);
    }
  }
  const eggs = new Set<string>();
  for (const e of s.eggs) {
    if (eggs.has(e.eggId) || e.bossId !== s.boss.id || e.bossGeneration !== s.boss.instance.entityGeneration) return false;
    eggs.add(e.eggId);
  }
  if (s.phase.kind === 'submerged' && (s.bodyTargetability.mode !== 'hidden' || s.bodyAction !== null)) return false;
  if (s.phase.kind === 'ashore' && (s.bodyTargetability.mode !== 'protected' || s.bodyAction !== null)) return false;
  if (s.bodyAction !== null && !['surfaced', 'land'].includes(s.phase.kind)) return false;
  if (s.bodyAction?.kind === 'slam' && s.phase.kind !== 'land') return false;
  if (s.phase.kind === 'surfacing' && s.bodyTargetability.mode === 'exposed'
    && s.bodyTargetability.effectiveAt < s.phase.vulnerableAt) return false;
  if (s.phase.kind === 'diving' && s.bodyTargetability.mode === 'hidden'
    && s.bodyTargetability.effectiveAt < s.phase.submergedAt) return false;
  if (s.tentacles.length && !['submerged', 'dying'].includes(s.phase.kind)) return false;
  if (s.phase.kind === 'dying' && s.tentacles.some(t => t.phase !== 'retract' || t.claw.attack !== null)) return false;
  if (['dying', 'removed'].includes(s.phase.kind) && s.bodyAction !== null) return false;
  if (s.phase.kind === 'removed' && (s.tentacles.length || s.eggs.length || s.inkClouds.length)) return false;
  if (new Set(s.inkClouds.map(c => c.attackId)).size !== s.inkClouds.length) return false;
  const action = s.bodyAction;
  return action?.kind !== 'ink' || (action.startedAt < action.chargeAt && action.chargeAt < action.spitAt && action.spitAt < action.endsAt);
}, 'Inconsistent kraken ownership/phase'));
export type KrakenState = v.InferOutput<typeof KrakenStateSchema>;

/** Missing slice = unchanged, null = clear, [] inside a present slice = empty collection. */
export interface KrakenSnapshotPatch { readonly kraken?: KrakenState | null }
export interface KrakenStateReadPort { getState(): KrakenState | null }
export interface KrakenStatePublishPort { publish(state: KrakenState | null): void }

export const KrakenEggLandEffectSchema = v.strictObject({
  type: v.literal('kraken_egg_land'), boss: BossTargetRefSchema, castId: id, eggId: id,
  broodTableId: id, originId: id,
});
export type KrakenEggLandEffect = v.InferOutput<typeof KrakenEggLandEffectSchema>;
export type KrakenEggLandingRequest = Omit<ProjectileGrenadePayloadRequest, 'effect'> & {
  readonly effect: KrakenEggLandEffect;
  readonly landedAt: number;
};
export interface KrakenBroodPort {
  /** Validate the actual terminal point; invalid landings break, never relocate. Exactly once. */
  landEgg(request: KrakenEggLandingRequest): 'incubating' | 'broken' | 'stale';
  /** Cancel pending/released flights without land reaction and remove unhatched eggs. */
  clearBoss(boss: BossTargetRef): void;
}

/** Marker side effects use host guards set BEFORE reentrant callbacks, never replica state. */
export interface KrakenHostActionProgress {
  readonly actionId: string;
  released: boolean;
  impacted: boolean;
}
export type KrakenProjectileSpawnPort = ProjectileSpawnPort;

export interface KrakenEntityPort {
  readBoss(boss: BossTargetRef): { readonly x: number; readonly y: number; readonly angle: number;
    readonly hp: number; readonly maxHp: number; readonly alive: boolean; readonly stunned: boolean } | null;
  /** Body-only targetability: never use global boss invulnerability to block part transfers. */
  setBodyTargetability(boss: BossTargetRef, state: KrakenState['bodyTargetability']): void;
  /** Applied before ordinary movement/separation/impulses. Water approach is explicit host movement. */
  setMovement(boss: BossTargetRef, mode: KrakenState['movement'], destination: { readonly x: number; readonly y: number } | null): void;
  setFacing(boss: BossTargetRef, angle: number): void;
}
export interface KrakenIntentReadPort {
  readTarget(boss: BossTargetRef): { readonly target: CombatTargetRef; readonly x: number; readonly y: number } | null;
  /** Explicit secondary selection from the SAME targetability catalogue. */
  readSecondaryTargets(boss: BossTargetRef): readonly { readonly target: CombatTargetRef; readonly x: number; readonly y: number }[];
}

/** Host-only permit produced/revalidated by habitat rules; topology and scope changes revoke it.
 * Full body coverage, blockers and a land navigation connection are required, not just dry cells.
 */
export interface KrakenHabitatReservation {
  readonly worldRevision: number;
  readonly activityRevision: number;
  readonly topologyRevision: number;
  readonly reservationId: string;
  readonly habitatId: string;
  readonly waterAnchorId: string;
  readonly bodyRadiusPx: number;
  readonly x: number;
  readonly y: number;
}
export type KrakenHabitatResult<T> = { readonly status: 'valid'; readonly value: T }
  | { readonly status: 'pending' | 'blocked' | 'invalid'; readonly reason: string };
export interface KrakenHabitatPort {
  reserveWaterSpawn(habitatId: string, bodyRadiusPx: number): KrakenHabitatResult<KrakenHabitatReservation>;
  revalidate(reservation: KrakenHabitatReservation): boolean;
  reserveTentacles(boss: BossTargetRef, habitatId: string, targets: readonly { readonly x: number; readonly y: number }[],
    maxCount: number, avoid?: readonly { x: number; y: number }[], origin?: { readonly x: number; readonly y: number }): readonly KrakenLaneReservation[];
  /** Strike heading towards a target if it is reachable from this base inside the arm's arc; never commits. */
  tentacleAim(reservation: KrakenLaneReservation, target: { x: number; y: number }): number | null;
  aimTentacle(reservation: KrakenLaneReservation, target: { x: number; y: number }): KrakenLaneReservation['pose'] | null;
  wanderPoint(from: { x: number; y: number }, random: number): { x: number; y: number } | null;
  canWander(from: { x: number; y: number }, to: { x: number; y: number }): boolean;
  divePoint(from: { x: number; y: number }): { x: number; y: number } | null;
  isDiveInterior(point: { x: number; y: number }): boolean;
  recoverLand(from: { x: number; y: number }, distance: number): { x: number; y: number } | null;
  reserveExit(boss: BossTargetRef, habitatId: string): KrakenHabitatResult<KrakenExitReservation>;
  revalidateLane(reservation: KrakenLaneReservation): boolean;
  revalidateExit(reservation: KrakenExitReservation): KrakenHabitatResult<KrakenExitReservation>;
  release(reservationId: string): void;
}
export interface KrakenLaneReservation {
  readonly reservationId: string;
  readonly topologyRevision: number;
  readonly shoreId: string;
  readonly waterEntry: { readonly x: number; readonly y: number };
  /** Direction from the submerged kraken through the base: the arm comes out of the pond along it. */
  readonly radialAngle: number;
  readonly pose: CombatAreaPose & { readonly geometry: Extract<CombatAreaPose['geometry'], { kind: 'lane' }> };
}
export interface KrakenExitReservation {
  readonly reservationId: string;
  readonly topologyRevision: number;
  readonly corridorId: string;
  readonly path: readonly { readonly x: number; readonly y: number }[];
  readonly widthPx: number;
}
export interface KrakenBossSpawnPort {
  /** Only this validated water path may bypass ordinary EnemyManager dry projection. */
  spawnAtHabitat(enemyKind: string, reservation: KrakenHabitatReservation): BossTargetRef | null;
}

export function readKrakenState(raw: unknown): KrakenState | null {
  const result = v.safeParse(KrakenStateSchema, raw);
  return result.success ? result.output : null;
}
export function readKrakenEggLandEffect(raw: unknown): KrakenEggLandEffect | null {
  const result = v.safeParse(KrakenEggLandEffectSchema, raw);
  return result.success ? result.output : null;
}
