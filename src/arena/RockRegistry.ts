import { ROCK_NET_FULL_SNAPSHOT_INTERVAL_TICKS } from '../config';
import type { ArenaLayout, RockNetState, SyncedRockSnapshot } from '../types';
import { RockHpRegistry } from './RockHpRegistry';

/**
 * RockRegistry – Host-seitiger HP-Zustand aller Felsen.
 * Nur auf dem Host instanziiert; Clients empfangen Snapshots via GameState.
 *
 * Der HP-Zustand selbst liegt in {@link RockHpRegistry} und ist netzfrei; diese Klasse
 * ergänzt ausschließlich die Delta-Snapshot-Schicht. Wer Fels-HP ohne Netzwerk braucht –
 * etwa die lokale Lobby-Inszenierung – benutzt die Basisklasse direkt statt eine zweite
 * HP-Verwaltung zu bauen.
 */
export class RockRegistry extends RockHpRegistry {
  private readonly netSnapshotCache = new Map<number, RockNetState>();
  private readonly pendingRemovalIds = new Set<number>();
  private ticksSinceFullNetSnapshot = ROCK_NET_FULL_SNAPSHOT_INTERVAL_TICKS;
  private forceFullNetSnapshot = false;

  reset(layout: ArenaLayout): void {
    super.reset(layout);
    this.netSnapshotCache.clear();
    this.pendingRemovalIds.clear();
    this.ticksSinceFullNetSnapshot = ROCK_NET_FULL_SNAPSHOT_INTERVAL_TICKS;
    this.forceFullNetSnapshot = false;
  }

  register(id: number, maxHp: number): void {
    super.register(id, maxHp);
    this.pendingRemovalIds.delete(id);
  }

  remove(id: number): boolean {
    if (!super.remove(id)) return false;
    this.netSnapshotCache.delete(id);
    this.pendingRemovalIds.add(id);
    return true;
  }

  /** Naechster Netzwerk-Snapshot enthaelt alle aktuellen Schadenswerte. */
  requestFullNetSnapshot(): void {
    this.forceFullNetSnapshot = true;
  }

  /**
   * Delta-Snapshot für Netzwerk-Sync: Nur Felsen mit HP < ROCK_HP_MAX enthalten.
   * Abwesende IDs gelten beim Client als vollständig (ROCK_HP_MAX).
   */
  getNetSnapshot(): SyncedRockSnapshot | null {
    const full = this.forceFullNetSnapshot
      || this.ticksSinceFullNetSnapshot >= ROCK_NET_FULL_SNAPSHOT_INTERVAL_TICKS;
    const currentIds = new Set<number>();
    const upserts: RockNetState[] = [];

    for (const [id, state] of this.hpMap) {
      if (state.hp >= state.maxHp) continue;

      const nextState = { id, hp: state.hp };
      currentIds.add(id);
      const previous = this.netSnapshotCache.get(id);
      if (full || !previous || previous.hp !== nextState.hp) {
        upserts.push(nextState);
        this.netSnapshotCache.set(id, nextState);
      }
    }

    const removals = [...this.pendingRemovalIds].sort((left, right) => left - right);

    if (full) {
      for (const id of [...this.netSnapshotCache.keys()]) {
        if (!currentIds.has(id)) this.netSnapshotCache.delete(id);
      }
      this.ticksSinceFullNetSnapshot = 0;
      this.forceFullNetSnapshot = false;
    } else {
      this.ticksSinceFullNetSnapshot += 1;
      for (const id of removals) {
        this.netSnapshotCache.delete(id);
      }
    }

    this.pendingRemovalIds.clear();

    if (!full && upserts.length === 0 && removals.length === 0) return null;

    return {
      full,
      count: currentIds.size,
      upserts,
      removals,
    };
  }
}
