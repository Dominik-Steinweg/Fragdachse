import {
  getBridgeChargePoint,
  getBridgeDeckWorldRect,
  type BridgeWorldOrigin,
  type BridgeWorldRect,
} from '../arena/BridgeGeometry';
import { BRIDGE_DEMOLITION_RULES } from '../config/bridges';
import type { ArenaBridge, SyncedBridgeState } from '../types';
import type { WorldScopedBinding } from './WorldRuntime';

export type BridgePhase = 'standing' | 'charged' | 'collapsed';

export interface BridgeRuntimeState {
  readonly phase: BridgePhase;
  /** Host-synchronized time of the collapse; set while charged. */
  readonly detonatesAt?: number;
  /** Player credited with the collapse; host-only provenance, not replicated. */
  readonly plantedBy?: string | null;
}

/** World geometry projection of bridge state; the owner pushes, the binding never decides. */
export interface WorldBridgeGeometryPort {
  setCollapsedBridges(ids: ReadonlySet<string>): void;
}

/** Bodies whose centre lies on a deck when it collapses. */
export interface BridgeDeckVictims {
  readonly players: readonly string[];
  readonly enemies: readonly string[];
  /** Bosses and other bodies too large to fall; they take a share of their HP instead. */
  readonly bosses: readonly string[];
}

/** Host-only consequences of a collapse, implemented at the composition boundary. */
export interface WorldBridgeHostPort {
  readonly now: () => number;
  /** Fuses burn only while the Activity runs; a finished round never collapses a bridge. */
  readonly isFuseClockRunning: () => boolean;
  readonly listDeckVictims: (deck: BridgeWorldRect) => BridgeDeckVictims;
  readonly killPlayer: (playerId: string) => void;
  readonly killEnemy: (enemyId: string, creditTo: string | null, x: number, y: number) => void;
  readonly damageBoss: (enemyId: string, fraction: number, creditTo: string | null, x: number, y: number) => void;
  /** Enemy-only blast, impulse and explosion effect around the charge point. */
  readonly detonate: (x: number, y: number, creditTo: string | null) => void;
  /** Ground items lying on the deck move to the nearest dry land. */
  readonly relocateGroundItems: (deck: BridgeWorldRect) => void;
}

export interface WorldBridgeRuntimeOptions {
  readonly bridges: readonly ArenaBridge[];
  readonly origin: BridgeWorldOrigin;
  readonly geometry: WorldBridgeGeometryPort;
  /** Present on the host only; clients project the replicated slice. */
  readonly host?: WorldBridgeHostPort;
  readonly onDestroy?: (runtime: WorldBridgeRuntime) => void;
}

export type BridgeChargeResult = 'charged' | 'unknown' | 'charged-already' | 'collapsed';

/**
 * World owner of authored bridges and their demolition state.
 *
 * The host is the only writer: it charges, burns the fuse and resolves the collapse in an
 * explicit order (victims first, then geometry, then kills, blast and item relocation). Clients
 * apply the replicated slice and project the same geometry. A new World starts with every bridge
 * standing, so no reset exists.
 */
export class WorldBridgeRuntime implements WorldScopedBinding {
  private readonly states = new Map<string, BridgeRuntimeState>();
  private readonly byId = new Map<string, ArenaBridge>();
  private destroyed = false;

  constructor(private readonly options: WorldBridgeRuntimeOptions) {
    for (const bridge of options.bridges) {
      this.byId.set(bridge.id, bridge);
      this.states.set(bridge.id, { phase: 'standing' });
    }
  }

  get isHost(): boolean { return this.options.host !== undefined; }

  getBridges(): readonly ArenaBridge[] { return this.options.bridges; }

  getBridge(id: string): ArenaBridge | null { return this.byId.get(id) ?? null; }

  getState(id: string): BridgeRuntimeState | null { return this.states.get(id) ?? null; }

  isStanding(id: string): boolean { return this.states.get(id)?.phase === 'standing'; }

  getDeckRect(id: string): BridgeWorldRect | null {
    const bridge = this.byId.get(id);
    return bridge ? getBridgeDeckWorldRect(bridge, this.options.origin) : null;
  }

  getCollapsedIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const [id, state] of this.states) if (state.phase === 'collapsed') ids.add(id);
    return ids;
  }

  /** Replicated slice: bridges that left `standing`, in authored order. */
  getSnapshot(): SyncedBridgeState[] {
    const snapshot: SyncedBridgeState[] = [];
    for (const bridge of this.options.bridges) {
      const state = this.states.get(bridge.id)!;
      if (state.phase === 'charged') snapshot.push({ id: bridge.id, phase: 'charged', detonatesAt: state.detonatesAt });
      else if (state.phase === 'collapsed') snapshot.push({ id: bridge.id, phase: 'collapsed' });
    }
    return snapshot;
  }

  /** Host: plant a charge. Validation of the planter happens at the composition boundary. */
  charge(id: string, plantedBy: string | null): BridgeChargeResult {
    const host = this.options.host;
    if (this.destroyed || !host) return 'unknown';
    const state = this.states.get(id);
    if (!state) return 'unknown';
    if (state.phase === 'charged') return 'charged-already';
    if (state.phase === 'collapsed') return 'collapsed';
    this.states.set(id, { phase: 'charged', detonatesAt: host.now() + BRIDGE_DEMOLITION_RULES.fuseMs, plantedBy });
    return 'charged';
  }

  /**
   * Host frame step: burn fuses and collapse every bridge whose fuse ran out. Called by the host
   * coordinator inside its simulation step (not a WorldScopedBinding update).
   */
  hostStep(): void {
    const host = this.options.host;
    if (this.destroyed || !host || !host.isFuseClockRunning()) return;
    const now = host.now();
    for (const bridge of this.options.bridges) {
      const state = this.states.get(bridge.id)!;
      if (state.phase === 'charged' && state.detonatesAt !== undefined && now >= state.detonatesAt) {
        this.collapse(bridge.id);
      }
    }
  }

  /** Host: resolve a collapse now (fuse end, or a dev scenario). Idempotent. */
  collapse(id: string): boolean {
    const host = this.options.host;
    const bridge = this.byId.get(id);
    const state = this.states.get(id);
    if (this.destroyed || !host || !bridge || !state || state.phase === 'collapsed') return false;
    const deck = getBridgeDeckWorldRect(bridge, this.options.origin);
    const charge = getBridgeChargePoint(bridge, this.options.origin);
    const creditTo = state.plantedBy ?? null;
    // Victims are read on the standing deck, before the geometry pushes anybody to a bank.
    const victims = host.listDeckVictims(deck);
    this.states.set(id, { phase: 'collapsed' });
    this.options.geometry.setCollapsedBridges(this.getCollapsedIds());
    for (const playerId of victims.players) host.killPlayer(playerId);
    for (const enemyId of victims.enemies) host.killEnemy(enemyId, creditTo, charge.x, charge.y);
    for (const enemyId of victims.bosses) {
      host.damageBoss(enemyId, BRIDGE_DEMOLITION_RULES.bossDamageFraction, creditTo, charge.x, charge.y);
    }
    host.detonate(charge.x, charge.y, creditTo);
    host.relocateGroundItems(deck);
    return true;
  }

  /** Client: project the replicated slice. Unknown ids are ignored; listed-then-missing never revives. */
  applySnapshot(snapshot: readonly SyncedBridgeState[]): void {
    if (this.destroyed || this.options.host) return;
    const listed = new Map(snapshot.map((entry) => [entry.id, entry]));
    let collapsedChanged = false;
    for (const bridge of this.options.bridges) {
      const previous = this.states.get(bridge.id)!;
      const entry = listed.get(bridge.id);
      // A collapsed bridge never stands again within one World.
      if (previous.phase === 'collapsed') continue;
      if (entry?.phase === 'collapsed') {
        this.states.set(bridge.id, { phase: 'collapsed' });
        collapsedChanged = true;
      } else if (entry?.phase === 'charged') {
        this.states.set(bridge.id, { phase: 'charged', detonatesAt: entry.detonatesAt });
      } else if (previous.phase === 'charged') {
        // Charged and then absent: only possible on a malformed slice; keep the fuse visible.
        continue;
      }
    }
    if (collapsedChanged) this.options.geometry.setCollapsedBridges(this.getCollapsedIds());
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.options.onDestroy?.(this);
  }
}
