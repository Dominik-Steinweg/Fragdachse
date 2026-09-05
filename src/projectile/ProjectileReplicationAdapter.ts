import {
  PROJECTILE_NET_LONG_LIVED_AGE_MS,
  PROJECTILE_NET_REFRESH_CYCLE_TICKS,
  PROJECTILE_NET_STATIC_RESEND_TICKS,
} from '../config';
import { encodeProjectileDynamic, encodeProjectileStatic } from '../network/projectileSnapshotCodec';
import type {
  SyncedProjectileDynamic,
  SyncedProjectileSnapshot,
  SyncedProjectileStatic,
} from '../types';

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
  private readonly seenIds = new Set<number>();
  private refreshCursor = 0;
  private forceFullSnapshot = false;

  constructor(private readonly source: ProjectileReplicationReadPort) {}

  requestFullSnapshot(): void {
    this.forceFullSnapshot = true;
  }

  reset(): void {
    this.staticResendLeft.clear();
    this.seenIds.clear();
    this.refreshCursor = 0;
    this.forceFullSnapshot = false;
  }

  /**
   * Baut einen Snapshot nur für einen tatsächlichen Network-Tick.
   * `u` bleibt vollständig und Despawn läuft unverändert über Abwesenheit.
   */
  getSnapshot(nowMs = Date.now()): SyncedProjectileSnapshot | null {
    const full = this.forceFullSnapshot;
    this.forceFullSnapshot = false;
    const refreshIds = full ? null : this.collectStaticRefreshIds(nowMs);
    const s: Array<number | string> = [];
    const u: Array<number | string> = [];
    this.seenIds.clear();

    this.source.readProjectileReplication((record) => {
      this.seenIds.add(record.id);
      const resendLeft = this.staticResendLeft.get(record.id);
      if (resendLeft === undefined) {
        this.staticResendLeft.set(record.id, PROJECTILE_NET_STATIC_RESEND_TICKS - 1);
        encodeProjectileStatic(s, record.static);
      } else if (resendLeft > 0) {
        this.staticResendLeft.set(record.id, resendLeft - 1);
        encodeProjectileStatic(s, record.static);
      } else if (full || refreshIds?.has(record.id)) {
        encodeProjectileStatic(s, record.static);
      }
      encodeProjectileDynamic(u, record.dynamic);
    });

    for (const id of this.staticResendLeft.keys()) {
      if (!this.seenIds.has(id)) this.staticResendLeft.delete(id);
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
