import type { SyncedEnemySnapshot } from '../types';
import type { KrakenState } from '../systems/KrakenState';
import { readEnemyAreaClawEvent, type EnemyAreaClawEvent, type EnemyAreaClawImpact } from '../systems/EnemyClawAttack';
import type { CombatPartHitReceipt } from '../combat/CombatPartContact';
import { decodeEnemyUpserts, encodeEnemyUpsert, enemyNumToId } from './enemySnapshotCodec';
import { decodeKrakenSnapshot, sameKrakenBoss } from './krakenSnapshotCodec';

function slotKey(e: Pick<EnemyAreaClawEvent, 'enemyId' | 'entityGeneration' | 'slot'>): string {
  const s = e.slot;
  return JSON.stringify([e.enemyId, e.entityGeneration, s.kind,
    ...(s.kind === 'part' ? [s.partId, s.partGeneration, s.cycleId] : [])]);
}
function partEvent(s: KrakenState, t: KrakenState['tentacles'][number]): EnemyAreaClawEvent {
  const p = t.contact.identity;
  return { worldRevision: s.boss.scope.worldRevision, activityRevision: s.boss.instance.activityRevision,
    enemyId: s.boss.id, entityGeneration: s.boss.instance.entityGeneration,
    slot: { kind: 'part', partId: p.partId, partGeneration: p.partGeneration, cycleId: p.cycleId }, state: t.claw };
}

/** Activity-scoped transport reconciliation only. Never schedules an impact or a hatch.
 * Pending starts/clears are released only after their exact entity/part baseline exists.
 */
export class KrakenSnapshotReceiver {
  private worldRevision: number | null = null;
  private activityRevision: number | null = null;
  private sequence = -1;
  private state: KrakenState | null = null;
  private readonly entities = new Map<string, number>();
  private readonly generations = new Map<string, number>();
  private readonly slots = new Map<string, EnemyAreaClawEvent>();
  private readonly pending = new Set<string>();
  private readonly retired = new Set<string>();
  private readonly impacts = new Set<string>();
  private readonly receipts = new Set<string>();

  constructor(private readonly deliver: (event: EnemyAreaClawEvent) => void = () => {}) {}

  reset(worldRevision: number | null, activityRevision: number | null): void {
    this.worldRevision = worldRevision; this.activityRevision = activityRevision;
    this.sequence = -1; this.state = null;
    this.entities.clear(); this.generations.clear(); this.slots.clear(); this.pending.clear();
    this.retired.clear(); this.impacts.clear(); this.receipts.clear();
  }

  setScope(worldRevision: number | null, activityRevision: number | null): void {
    if (this.worldRevision !== worldRevision || this.activityRevision !== activityRevision) {
      this.reset(worldRevision, activityRevision);
    }
  }

  getState(): KrakenState | null {
    const s = this.state;
    if (!s) return null;
    // Intro has no entity yet; terminal presentation outlives combat removal.
    return ['waiting', 'intro', 'dying', 'removed'].includes(s.phase.kind)
      || this.entities.get(s.boss.id) === s.boss.instance.entityGeneration ? s : null;
  }

  applySnapshot(raw: unknown): void {
    if (raw === undefined) return;
    const packet = decodeKrakenSnapshot(raw);
    if (!packet || packet.worldRevision !== this.worldRevision || packet.activityRevision !== this.activityRevision
      || packet.sequence <= this.sequence) return;
    const next = packet.kraken, previous = this.state;
    if (next && next.boss.instance.entityGeneration < (this.generations.get(next.boss.id) ?? 0)) return;
    if (next && previous && next.boss.id === previous.boss.id
      && (next.boss.instance.entityGeneration < previous.boss.instance.entityGeneration
        || next.boss.scope.runtimeGeneration < previous.boss.scope.runtimeGeneration)) return;
    if (next && previous && sameKrakenBoss(next, previous)
      && (next.revision < previous.revision || next.cycleId < previous.cycleId
        || next.bodyTargetability.revision < previous.bodyTargetability.revision)) return;
    this.sequence = packet.sequence;
    const nextKeys = new Set(next?.tentacles.map(t => slotKey(partEvent(next, t))));
    for (const t of previous?.tentacles ?? []) {
      const key = slotKey(partEvent(previous!, t));
      if (!nextKeys.has(key)) { this.retired.add(key); this.pending.delete(key); this.slots.delete(key); }
    }
    this.state = next;
    if (!next) {
      for (const [key, event] of this.slots) {
        if (event.slot.kind === 'part') { this.retired.add(key); this.slots.delete(key); this.pending.delete(key); }
      }
      return;
    }
    for (const t of next.tentacles) {
      const event = partEvent(next, t), key = slotKey(event), recent = this.slots.get(key);
      // A removed part cannot be revived by delayed events; a new generation has a new key.
      if (this.retired.has(key)) { t.claw = { revision: t.claw.revision, attack: null }; continue; }
      if (recent && recent.state.revision > t.claw.revision) t.claw = recent.state;
      else this.slots.set(key, event);
    }
    this.flushPending();
  }

  /** Returns the same enemy contract with body slots protected against older baselines. */
  applyEnemies(snapshot: SyncedEnemySnapshot | null): SyncedEnemySnapshot | null {
    if (!snapshot) return snapshot;
    const entries = decodeEnemyUpserts(snapshot.u);
    let changed = false;
    const previousIds = new Set(this.entities.keys());
    if (snapshot.a) {
      const active = new Set(snapshot.a.map(enemyNumToId));
      for (const id of this.entities.keys()) if (!active.has(id)) this.entities.delete(id);
    }
    for (const id of snapshot.r) this.entities.delete(enemyNumToId(id));
    for (const entry of entries) {
      if (entry.entityGeneration !== undefined) {
        const latest = this.generations.get(entry.id) ?? 0;
        if (entry.entityGeneration < latest) continue;
        this.entities.set(entry.id, entry.entityGeneration);
        this.generations.set(entry.id, entry.entityGeneration);
      }
      const generation = this.entities.get(entry.id);
      if (generation === undefined || this.activityRevision === null || this.worldRevision === null) continue;
      const event: EnemyAreaClawEvent = { worldRevision: this.worldRevision, activityRevision: this.activityRevision,
        enemyId: entry.id, entityGeneration: generation, slot: { kind: 'body' },
        state: entry.areaClaw ?? { revision: 0, attack: null } };
      const key = slotKey(event), recent = this.slots.get(key);
      if (recent && (!entry.areaClaw || recent.state.revision > entry.areaClaw.revision)) {
        entry.areaClaw = recent.state;
        changed = true;
      }
      else if (entry.areaClaw) this.slots.set(key, event);
    }
    for (const [key, event] of this.slots) {
      if ((previousIds.has(event.enemyId) && !this.entities.has(event.enemyId))
        || event.entityGeneration < (this.generations.get(event.enemyId) ?? 0)) {
        this.retired.add(key); this.pending.delete(key); this.slots.delete(key);
      }
    }
    this.flushPending();
    if (!changed) return snapshot;
    const u: Array<number | string> = [];
    for (const entry of entries) encodeEnemyUpsert(u, entry);
    return { ...snapshot, u };
  }

  receiveEvent(raw: unknown): void {
    const event = readEnemyAreaClawEvent(raw);
    if (!event || event.worldRevision !== this.worldRevision || event.activityRevision !== this.activityRevision
      || event.entityGeneration < (this.generations.get(event.enemyId) ?? 0)) return;
    const key = slotKey(event), previous = this.slots.get(key);
    if (this.retired.has(key) || (previous && event.state.revision <= previous.state.revision)) return;
    // Unknown future slots are bounded; no old entry is silently made current by eviction.
    if (!this.isReady(event) && this.pending.size >= 256 && !this.pending.has(key)) return;
    this.slots.set(key, event);
    this.pending.add(key);
    this.flushPending();
  }

  private isReady(event: EnemyAreaClawEvent): boolean {
    if (this.entities.get(event.enemyId) !== event.entityGeneration) return false;
    if (event.slot.kind === 'body') return true;
    const s = this.getState();
    return !!s && s.tentacles.some(t => slotKey(partEvent(s, t)) === slotKey(event));
  }

  private flushPending(): void {
    for (const key of this.pending) {
      const event = this.slots.get(key);
      if (!event || !this.isReady(event)) continue;
      this.pending.delete(key);
      const s = this.state;
      if (s && event.slot.kind === 'part') {
        const part = s.tentacles.find(t => slotKey(partEvent(s, t)) === key);
        if (part) part.claw = event.state;
      }
      this.deliver(event);
    }
  }

  acceptImpact(impact: EnemyAreaClawImpact): boolean {
    const event = { ...impact, state: { revision: impact.revision, attack: impact.attack } };
    if (impact.worldRevision !== this.worldRevision || impact.activityRevision !== this.activityRevision
      || !this.isReady(event)) return false;
    const slot = this.slots.get(slotKey(event));
    if (!slot?.state.attack || slot.state.revision !== impact.revision
      || slot.state.attack.attackId !== impact.attack.attackId) return false;
    const key = JSON.stringify([slotKey(event), impact.revision, impact.attack.attackId]);
    if (this.impacts.has(key)) return false;
    this.impacts.add(key);
    return true;
  }

  acceptPartHit(receipt: CombatPartHitReceipt): boolean {
    const s = this.getState(), p = receipt.part;
    if (!s || s.phase.kind !== 'submerged' || !sameKrakenBoss(s, { boss: p.boss })) return false;
    if (!s.tentacles.some(t => t.contact.contactId === receipt.contactId
      && t.contact.identity.partId === p.partId && t.contact.identity.partGeneration === p.partGeneration
      && t.contact.identity.cycleId === p.cycleId)) return false;
    const key = JSON.stringify([receipt.event, receipt.outcomeId]);
    if (this.receipts.has(key)) return false;
    this.receipts.add(key);
    return true;
  }
}
