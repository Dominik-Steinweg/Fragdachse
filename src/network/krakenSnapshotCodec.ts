import * as v from 'valibot';
import { KrakenStateSchema, type KrakenState } from '../systems/KrakenState';
import { EnemyAreaClawStateSchema, readEnemyAreaClawEvent, type EnemyAreaClawImpact } from '../systems/EnemyClawAttack';
import { CombatPartIdentitySchema, type CombatPartHitReceipt } from '../combat/CombatPartContact';

const sequence = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const id = v.pipe(v.string(), v.minLength(1));
const finite = v.pipe(v.number(), v.finite());
const PacketSchema = v.strictObject({
  worldRevision: sequence, activityRevision: v.nullable(sequence), sequence,
  kraken: v.nullable(KrakenStateSchema),
});
export type KrakenSnapshotPacket = v.InferOutput<typeof PacketSchema>;

/** Lossless projection: host timestamps, poses and identities must not be quantized.
 * The transport sequence also fences null clears against older fast/baseline packets.
 */
export function encodeKrakenSnapshot(packet: KrakenSnapshotPacket): KrakenSnapshotPacket {
  const parsed = decodeKrakenSnapshot(packet);
  if (!parsed) throw new Error('Invalid Kraken snapshot');
  return parsed;
}

export function decodeKrakenSnapshot(raw: unknown): KrakenSnapshotPacket | undefined {
  const result = v.safeParse(PacketSchema, raw);
  if (!result.success) return undefined;
  const p = result.output, s = p.kraken;
  if (s && (s.boss.scope.worldRevision !== p.worldRevision
    || s.boss.instance.activityRevision !== p.activityRevision)) return undefined;
  return p;
}

export function readAreaClawState(raw: unknown) {
  const result = v.safeParse(EnemyAreaClawStateSchema, raw);
  return result.success ? result.output : undefined;
}

export function readAreaClawImpact(raw: unknown): EnemyAreaClawImpact | undefined {
  if (!raw || typeof raw !== 'object' || 'state' in raw) return undefined;
  const { revision, attack, ...address } = raw as EnemyAreaClawImpact;
  const event = readEnemyAreaClawEvent({ ...address, state: { revision, attack } });
  if (!event?.state.attack) return undefined;
  const { state, ...validated } = event;
  return { ...validated, revision: state.revision, attack: state.attack! };
}

const ReceiptSchema = v.strictObject({
  event: v.strictObject({ scope: v.strictObject({ worldRevision: sequence,
    runtimeGeneration: v.pipe(sequence, v.minValue(1)) }), activityRevision: sequence, eventId: id }),
  part: CombatPartIdentitySchema, contactId: id, attackId: v.optional(id),
  x: finite, y: finite, outcomeId: id,
});
export function readKrakenPartHit(raw: unknown): CombatPartHitReceipt | undefined {
  const result = v.safeParse(ReceiptSchema, raw);
  if (!result.success) return undefined;
  const r = result.output;
  return r.event.scope.worldRevision === r.part.boss.scope.worldRevision
    && r.event.scope.runtimeGeneration === r.part.boss.scope.runtimeGeneration
    && r.event.activityRevision === r.part.boss.instance.activityRevision ? r : undefined;
}

export function sameKrakenBoss(a: Pick<KrakenState, 'boss'>, b: Pick<KrakenState, 'boss'>): boolean {
  return a.boss.id === b.boss.id && a.boss.scope.worldRevision === b.boss.scope.worldRevision
    && a.boss.scope.runtimeGeneration === b.boss.scope.runtimeGeneration
    && a.boss.instance.activityRevision === b.boss.instance.activityRevision
    && a.boss.instance.entityGeneration === b.boss.instance.entityGeneration;
}
