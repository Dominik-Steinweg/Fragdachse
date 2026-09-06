import {
  PROJECTILE_NET_LONG_LIVED_AGE_MS,
  PROJECTILE_NET_REFRESH_CYCLE_TICKS,
  PROJECTILE_NET_STATIC_RESEND_TICKS,
} from '../config';
import { encodeProjectileDynamic, encodeProjectileStatic } from '../network/projectileSnapshotCodec';
import type {
  ProjectileBouncePresentation,
  SyncedProjectileDynamic,
  SyncedProjectileSnapshot,
  SyncedProjectileStatic,
} from '../types';

const BOUNCE_TOMBSTONE_TICKS = 4;
const MAX_RETAINED_BOUNCE_OUTCOMES = 32;

interface BounceRetention {
  record: ProjectileReplicationRecord;
  outcomes: ProjectileBouncePresentation[];
  expiresAtSnapshot?: number;
}

/** Client-relevante Projektion eines aktiven Projectiles für den Host-Netzwerkadapter. */
export interface ProjectileReplicationRecord {
  readonly id: number;
  readonly static: SyncedProjectileStatic;
  readonly dynamic: SyncedProjectileDynamic;
  /** Nur für den rollierenden Static-Refresh; niemals Bestandteil des Wire-Formats. */
  readonly createdAt: number;
}

/** Read-only Quelle für die Replication-Projektion; Runtime-Records bleiben privat. */
export interface ProjectileReplicationReadPort {
  readProjectileReplication(sink: (record: ProjectileReplicationRecord) => void): void;
}

/**
 * Host-Adapter für die bestehende Projectile-Wire-Semantik.
 *
 * Resend-, Refresh-, Full-Snapshot- und Seen-ID-Zustand lebt bewusst hier und nicht in der
 * autoritativen Simulation. Der Adapter liest nur die schmale Client-Projektion und ruft den
 * bestehenden Codec auf.
 */
export class ProjectileReplicationAdapter {
  private readonly staticResendLeft = new Map<number, number>();
  private readonly previousStatic = new Map<number, SyncedProjectileStatic>();
  private readonly seenIds = new Set<number>();
  private readonly bounceRetentions = new Map<number, BounceRetention>();
  private refreshCursor = 0;
  private forceFullSnapshot = false;
  private snapshotSerial = 0;

  constructor(private readonly source: ProjectileReplicationReadPort) {}

  requestFullSnapshot(): void {
    this.forceFullSnapshot = true;
  }

  /**
   * Retains a presentation outcome independently of the gameplay record. The latest complete
   * projection is kept briefly after despawn so unreliable snapshots can still carry the impact.
   */
  recordBouncePresentation(record: ProjectileReplicationRecord): void {
    const bounce = record.dynamic.bounce;
    if (!bounce) return;
    const existing = this.bounceRetentions.get(record.id);
    const outcomes = existing?.outcomes ?? [];
    const duplicateIndex = outcomes.findIndex((outcome) => outcome.sequence === bounce.sequence);
    if (duplicateIndex >= 0) outcomes[duplicateIndex] = bounce;
    else outcomes.push(bounce);
    if (outcomes.length > MAX_RETAINED_BOUNCE_OUTCOMES) {
      outcomes.splice(0, outcomes.length - MAX_RETAINED_BOUNCE_OUTCOMES);
    }
    this.bounceRetentions.set(record.id, {
      record,
      outcomes,
    });
  }

  reset(): void {
    this.staticResendLeft.clear();
    this.previousStatic.clear();
    this.seenIds.clear();
    this.bounceRetentions.clear();
    this.refreshCursor = 0;
    this.forceFullSnapshot = false;
    this.snapshotSerial = 0;
  }

  /**
   * Baut einen Snapshot nur für einen tatsächlichen Network-Tick.
   * `u` bleibt vollständig; gewöhnliches Despawn läuft über Abwesenheit, ein Bounce-Tombstone
   * bleibt nur für die kurze, begrenzte Heilungsfrist im Strom.
   */
  getSnapshot(nowMs: number): SyncedProjectileSnapshot | null {
    const snapshotSerial = ++this.snapshotSerial;
    const full = this.forceFullSnapshot;
    this.forceFullSnapshot = false;
    const refreshIds = full ? null : this.collectStaticRefreshIds(nowMs);
    const s: Array<number | string> = [];
    const u: Array<number | string> = [];
    this.seenIds.clear();

    this.source.readProjectileReplication((record) => {
      this.seenIds.add(record.id);
      // Keep the adapter correct even for a projection source that only exposes the sticky latest
      // outcome; the World runtime additionally calls recordBouncePresentation for every outcome.
      if (record.dynamic.bounce) this.recordBouncePresentation(record);
      const retention = this.bounceRetentions.get(record.id);
      if (retention) {
        retention.record = record;
        retention.expiresAtSnapshot = undefined;
      }
      const previous = this.previousStatic.get(record.id);
      const changed = previous !== undefined && staticProjectionChanged(previous, record.static);
      this.previousStatic.set(record.id, record.static);
      const resendLeft = changed ? undefined : this.staticResendLeft.get(record.id);
      if (resendLeft === undefined) {
        this.staticResendLeft.set(record.id, PROJECTILE_NET_STATIC_RESEND_TICKS - 1);
        encodeProjectileStatic(s, record.static);
      } else if (resendLeft > 0) {
        this.staticResendLeft.set(record.id, resendLeft - 1);
        encodeProjectileStatic(s, record.static);
      } else if (full || refreshIds?.has(record.id)) {
        encodeProjectileStatic(s, record.static);
      }
      encodeProjectileDynamic(u, projectDynamicWithBounceOutcomes(record.dynamic, retention?.outcomes));
    });

    for (const [id, retention] of this.bounceRetentions) {
      if (this.seenIds.has(id)) continue;
      retention.expiresAtSnapshot ??= snapshotSerial + BOUNCE_TOMBSTONE_TICKS - 1;
      if (snapshotSerial > retention.expiresAtSnapshot) {
        this.bounceRetentions.delete(id);
        this.staticResendLeft.delete(id);
        this.previousStatic.delete(id);
        continue;
      }
      this.seenIds.add(id);
      // A tombstone may be the first packet this peer receives for a very short-lived projectile.
      encodeProjectileStatic(s, retention.record.static);
      encodeProjectileDynamic(u, projectDynamicWithBounceOutcomes(
        retention.record.dynamic,
        retention.outcomes,
      ));
    }

    for (const id of this.staticResendLeft.keys()) {
      if (!this.seenIds.has(id)) {
        this.staticResendLeft.delete(id);
        this.previousStatic.delete(id);
      }
    }

    if (u.length === 0 && !full) return null;
    return full ? { s, u, f: 1 } : { s, u };
  }

  private collectStaticRefreshIds(nowMs: number): Set<number> | null {
    const candidates: number[] = [];
    this.source.readProjectileReplication((record) => {
      if (nowMs - record.createdAt >= PROJECTILE_NET_LONG_LIVED_AGE_MS) {
        candidates.push(record.id);
      }
    });
    if (candidates.length === 0) {
      this.refreshCursor = 0;
      return null;
    }

    const perTick = Math.ceil(candidates.length / PROJECTILE_NET_REFRESH_CYCLE_TICKS);
    const ids = new Set<number>();
    for (let i = 0; i < perTick; i++) {
      ids.add(candidates[(this.refreshCursor + i) % candidates.length]);
    }
    this.refreshCursor = (this.refreshCursor + perTick) % candidates.length;
    return ids;
  }
}

/** A stable projectile ID can change allegiance/presentation after a redirect. */
function staticProjectionChanged(previous: SyncedProjectileStatic, next: SyncedProjectileStatic): boolean {
  return (Object.keys(previous) as Array<keyof SyncedProjectileStatic>).some(key => previous[key] !== next[key])
    || (Object.keys(next) as Array<keyof SyncedProjectileStatic>).some(key => previous[key] !== next[key]);
}

function projectDynamicWithBounceOutcomes(
  dynamic: SyncedProjectileDynamic,
  outcomes: readonly ProjectileBouncePresentation[] | undefined,
): SyncedProjectileDynamic {
  if (!outcomes || outcomes.length === 0) return dynamic;
  if (outcomes.length === 1) {
    return { ...dynamic, bounce: outcomes[0], bounceOutcomes: undefined };
  }
  return { ...dynamic, bounce: undefined, bounceOutcomes: outcomes };
}
