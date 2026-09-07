import type { PrimaryHitAdrenalineRewardFact } from '../combat/PrimaryHitReward';
import { AdrenalineEssenceRuntime } from './AdrenalineEssenceRuntime';
import { ESSENCE_VISUAL } from './AdrenalineEssencePresentation';
import { AdrenalineEssenceClientReplica, AdrenalineEssenceReplication, type EssenceSnapshot } from './AdrenalineEssenceReplication';
import { hasEssenceAccess, type AdrenalineEssencePorts, type EssenceAccessGroup, type EssenceScope, type EssenceState, type EssenceTransferReceipt } from './AdrenalineEssenceTypes';

export interface EssenceBindingPresentation {
  getStats?(): object;
  sync(state: EssenceState, receipts: readonly EssenceTransferReceipt[], now: number, localPlayerId: string): void;
  clear(): void;
  destroy(): void;
}

export interface EssenceBindingPorts extends AdrenalineEssencePorts {
  readonly isHost: boolean;
  readonly now: () => number;
  readonly servicesReady: () => boolean;
  readonly bindRewardSink: (sink: (fact: PrimaryHitAdrenalineRewardFact) => void) => () => void;
  readonly observeBurrow: (observer: (playerId: string) => void) => () => void;
  readonly accessGroupFor: (playerId: string) => EssenceAccessGroup | null;
  readonly localPlayerId: () => string;
  readonly isLocallyVisible: () => boolean;
  readonly resourceRevisionFor: (playerId: string) => number;
  readonly createPresentation: () => EssenceBindingPresentation;
  readonly onDestroyed?: () => void;
}

/** Domain, replica and presentation share one explicit lease: a match Activity, or the Lobby World. */
export class AdrenalineEssenceBinding {
  readonly runtime: AdrenalineEssenceRuntime | null;
  private readonly replica: AdrenalineEssenceClientReplica;
  private readonly replication = new AdrenalineEssenceReplication();
  private presentation: EssenceBindingPresentation | null = null;
  private connected = false;
  private hostStepMs = 0;
  private maxHostStepMs = 0;
  private destroyed = false;
  private detachReward: (() => void) | null = null;
  private detachBurrow: (() => void) | null = null;
  private pendingPresentation: EssenceTransferReceipt[] = [];
  private filteredSource: EssenceState | null = null;
  private filteredGroup: string | null = null;
  private filtered: EssenceState | null = null;
  /** Last canonical group observed while the attributed player was still present. */
  private readonly creatorGroups = new Map<string, EssenceAccessGroup>();

  constructor(readonly scope: EssenceScope, private readonly ports: EssenceBindingPorts) {
    this.scope = Object.freeze({ worldRevision: scope.worldRevision, activityRevision: scope.activityRevision });
    this.runtime = ports.isHost ? new AdrenalineEssenceRuntime(this.scope, ports) : null;
    this.replica = new AdrenalineEssenceClientReplica(this.scope);
  }

  /** Activity startup may precede World services; connect as soon as composition is ready. */
  prepare(): void {
    if (this.destroyed || this.connected || !this.runtime || !this.ports.servicesReady()) return;
    this.detachReward = this.ports.bindRewardSink(fact => {
      if (this.destroyed || fact.worldRevision !== this.scope.worldRevision || fact.activityRevision !== this.scope.activityRevision) return;
      const accessGroup = this.ports.accessGroupFor(fact.creatorId) ?? this.creatorGroups.get(fact.creatorId);
      if (!accessGroup) return;
      this.runtime!.materialize({
        id: fact.id, worldRevision: fact.worldRevision, activityRevision: fact.activityRevision,
        creatorId: fact.creatorId, authoredValue: fact.authoredValue, resolvedValue: fact.resolvedValue,
        origin: fact.origin, createdAt: fact.createdAt, seed: fact.seed, accessGroup,
        weaponId: fact.source.authoredSourceId, branchId: fact.intent.branchId, targetKind: fact.target.kind, distance: fact.distance,
      });
    });
    this.detachBurrow = this.ports.observeBurrow(id => this.runtime?.cancelPlayer(id, 'burrow', this.ports.now()));
    this.connected = true;
  }

  updateHost(now: number): void {
    if (this.destroyed || !this.runtime) return;
    const started = performance.now();
    this.prepare();
    for (const player of this.ports.getPlayers()) if (player.accessGroup) this.creatorGroups.set(player.playerId, player.accessGroup);
    this.runtime.update(now);
    if (this.destroyed) return;
    const receipts = this.runtime.drainReceipts();
    this.replication.addReceipts(receipts);
    this.pendingPresentation.push(...receipts);
    this.hostStepMs = performance.now() - started;
    this.maxHostStepMs = Math.max(this.maxHostStepMs, this.hostStepMs);
  }

  applySnapshot(snapshot: EssenceSnapshot | null | undefined): void {
    if (this.destroyed || this.runtime) return;
    if (this.replica.apply(snapshot)) this.pendingPresentation.push(...this.replica.drainReceipts());
  }

  getNetSnapshot(now: number, forceFull: boolean): EssenceSnapshot | null {
    return this.runtime && !this.destroyed ? this.replication.build(this.runtime.getState(), now, forceFull) : null;
  }

  render(now: number): void {
    if (this.destroyed) return;
    const localId = this.ports.localPlayerId();
    const group = this.ports.isLocallyVisible() ? this.ports.accessGroupFor(localId) : null;
    if (!group) {
      this.presentation?.clear(); this.pendingPresentation = [];
      this.filteredSource = null; this.filteredGroup = null; this.filtered = null;
      return;
    }
    const state = this.runtime?.getState() ?? this.replica.getState();
    const groupKey = JSON.stringify(group);
    // Losing access must remove old cosmetic tails and their lights immediately.
    if (this.filteredGroup !== null && groupKey !== this.filteredGroup) this.presentation?.clear();
    if (state !== this.filteredSource || groupKey !== this.filteredGroup) {
      this.filteredSource = state; this.filteredGroup = groupKey;
      this.filtered = { ...state, clusters: state.clusters.filter(c => hasEssenceAccess(c.accessGroup, group)), transfers: state.transfers.filter(t => hasEssenceAccess(t.accessGroup, group)) };
    }
    const ready: EssenceTransferReceipt[] = [];
    this.pendingPresentation = this.pendingPresentation.filter(receipt => {
      if (!hasEssenceAccess(receipt.accessGroup, group) || receipt.completedAt + ESSENCE_VISUAL.receiptMaxAgeMs < now) return false;
      // Resource is consumed independently. Only cosmetic confirmation waits for its revision.
      if (receipt.creditedValue > 0 && this.ports.resourceRevisionFor(receipt.playerId) < receipt.resourceRevision) return true;
      ready.push(receipt); return false;
    });
    if (!this.presentation && !this.filtered!.clusters.length && !this.filtered!.transfers.length && !ready.length) return;
    this.presentation ??= this.ports.createPresentation();
    this.presentation.sync(this.filtered!, ready, now, localId);
  }

  getDiagnostics() { return { gameplay: this.runtime?.getDiagnostics() ?? null, network: this.replication.getDiagnostics(), visuals: this.presentation?.getStats?.() ?? null, hostStepMs: this.hostStepMs, maxHostStepMs: this.maxHostStepMs, awaitingFull: this.runtime ? false : this.replica.isAwaitingFull() }; }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.detachReward?.(); this.detachBurrow?.();
    this.detachReward = null; this.detachBurrow = null;
    this.runtime?.destroy(); this.replica.clear();
    this.presentation?.destroy(); this.presentation = null;
    this.pendingPresentation = []; this.filtered = null; this.filteredSource = null;
    this.creatorGroups.clear();
    this.ports.onDestroyed?.();
  }
}
