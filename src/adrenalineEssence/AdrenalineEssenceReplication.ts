import type { EssenceClusterSnapshot, EssenceScope, EssenceState, EssenceTransferReceipt, EssenceTransferSnapshot } from './AdrenalineEssenceTypes';
import { getEssenceWireByteLength } from './AdrenalineEssenceWireCodec';

/** Independent delta stream inside the existing World snapshot channel. */
export interface EssenceSnapshot extends EssenceScope {
  readonly full: boolean;
  readonly revision: number;
  readonly baseRevision: number;
  readonly stateRevision: number;
  readonly sentAt: number;
  readonly clusters: readonly EssenceClusterSnapshot[];
  readonly clusterRemovals: readonly string[];
  readonly transfers: readonly EssenceTransferSnapshot[];
  readonly transferRemovals: readonly string[];
  readonly receipts: readonly EssenceTransferReceipt[];
}

const FULL_INTERVAL_MS = 1_000;
const RECEIPT_RETENTION_MS = 1_500;
export const ESSENCE_RECEIPT_REPEAT_MS = 200;

export class AdrenalineEssenceReplication {
  private revision = 0;
  private lastFullAt = Number.NEGATIVE_INFINITY;
  private clusters = new Map<string, string>();
  private transfers = new Map<string, string>();
  private readonly receipts = new Map<string, { readonly receipt: EssenceTransferReceipt; lastSentAt: number | null }>();
  private bytes = 0;
  private snapshots = 0;
  private lastFullBytes = 0;
  private upserts = 0;

  addReceipts(receipts: readonly EssenceTransferReceipt[]): void {
    for (const receipt of receipts) if (!this.receipts.has(receipt.id)) this.receipts.set(receipt.id, { receipt, lastSentAt: null });
  }

  build(state: EssenceState, now: number, forceFull = false): EssenceSnapshot | null {
    for (const [id, entry] of this.receipts) if (entry.receipt.completedAt + RECEIPT_RETENTION_MS <= now) this.receipts.delete(id);
    const full = forceFull || now - this.lastFullAt >= FULL_INTERVAL_MS;
    const readyReceipts = full ? [] : [...this.receipts.values()]
      .filter(entry => entry.lastSentAt === null || now - entry.lastSentAt >= ESSENCE_RECEIPT_REPEAT_MS)
      .map(entry => entry.receipt);
    const nextClusters = new Map<string, string>();
    const nextTransfers = new Map<string, string>();
    const clusters = state.clusters.filter(cluster => {
      const signature = JSON.stringify(cluster);
      nextClusters.set(cluster.id, signature);
      return full || this.clusters.get(cluster.id) !== signature;
    });
    const transfers = state.transfers.filter(transfer => {
      const signature = JSON.stringify(transfer);
      nextTransfers.set(transfer.id, signature);
      return full || this.transfers.get(transfer.id) !== signature;
    });
    const clusterRemovals = full ? [] : [...this.clusters.keys()].filter(id => !nextClusters.has(id));
    const transferRemovals = full ? [] : [...this.transfers.keys()].filter(id => !nextTransfers.has(id));
    if (!full && !clusters.length && !transfers.length && !clusterRemovals.length && !transferRemovals.length && !readyReceipts.length) return null;
    const baseRevision = this.revision;
    const snapshot: EssenceSnapshot = {
      worldRevision: state.worldRevision, activityRevision: state.activityRevision,
      full, revision: ++this.revision, baseRevision, stateRevision: state.revision, sentAt: now,
      clusters, clusterRemovals, transfers, transferRemovals,
      // Bootstrap is current state, never a replay of historical arrival effects.
      receipts: readyReceipts,
    };
    this.clusters = nextClusters;
    this.transfers = nextTransfers;
    if (full) this.lastFullAt = now;
    // Full snapshots intentionally contain no terminal history and never consume a first send.
    for (const receipt of readyReceipts) this.receipts.get(receipt.id)!.lastSentAt = now;
    const bytes = getEssenceWireByteLength(snapshot);
    this.bytes += bytes;
    this.snapshots++;
    this.upserts += clusters.length + transfers.length;
    if (full) this.lastFullBytes = bytes;
    return snapshot;
  }

  getDiagnostics() { return { bytes: this.bytes, snapshots: this.snapshots, upserts: this.upserts, lastFullBytes: this.lastFullBytes }; }
}

/** Passive replica. A delta gap waits for the periodic full, never guesses missing mutations. */
export class AdrenalineEssenceClientReplica {
  private revision = -1;
  private stateRevision = 0;
  private gap = false;
  private terminalBaseline = Number.NEGATIVE_INFINITY;
  private clusters = new Map<string, EssenceClusterSnapshot>();
  private transfers = new Map<string, EssenceTransferSnapshot>();
  private seenReceipts = new Map<string, number>();
  private receipts: EssenceTransferReceipt[] = [];
  private snapshot: EssenceState;

  constructor(private readonly scope: EssenceScope) {
    this.snapshot = { ...scope, revision: 0, clusters: [], transfers: [] };
  }

  apply(snapshot: EssenceSnapshot | null | undefined): boolean {
    if (!snapshot || snapshot.worldRevision !== this.scope.worldRevision || snapshot.activityRevision !== this.scope.activityRevision) return false;
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision <= this.revision) return false;
    if (!snapshot.full && (this.gap || this.revision < 0 || snapshot.baseRevision !== this.revision)) { this.gap = true; return false; }
    if (snapshot.full) {
      this.clusters.clear(); this.transfers.clear(); this.gap = false;
      if (this.revision < 0) this.terminalBaseline = snapshot.sentAt;
    }
    for (const id of snapshot.clusterRemovals) this.clusters.delete(id);
    for (const id of snapshot.transferRemovals) this.transfers.delete(id);
    for (const cluster of snapshot.clusters) this.clusters.set(cluster.id, cluster);
    for (const transfer of snapshot.transfers) this.transfers.set(transfer.id, transfer);
    this.revision = snapshot.revision;
    this.stateRevision = snapshot.stateRevision;
    for (const [id, until] of this.seenReceipts) if (until <= snapshot.sentAt) this.seenReceipts.delete(id);
    if (!snapshot.full) for (const receipt of snapshot.receipts) {
      if (receipt.worldRevision !== this.scope.worldRevision || receipt.activityRevision !== this.scope.activityRevision || this.seenReceipts.has(receipt.id)) continue;
      // Repeated terminal envelopes heal loss, but do not replay old celebrations after reconnect.
      if (receipt.completedAt <= this.terminalBaseline || receipt.completedAt + RECEIPT_RETENTION_MS <= snapshot.sentAt) continue;
      this.seenReceipts.set(receipt.id, snapshot.sentAt + RECEIPT_RETENTION_MS * 2);
      this.receipts.push(receipt);
    }
    this.snapshot = { ...this.scope, revision: this.stateRevision, clusters: [...this.clusters.values()], transfers: [...this.transfers.values()] };
    return true;
  }

  getState(): EssenceState { return this.snapshot; }
  drainReceipts(): EssenceTransferReceipt[] { const receipts = this.receipts; this.receipts = []; return receipts; }
  isAwaitingFull(): boolean { return this.gap || this.revision < 0; }
  clear(): void {
    this.clusters.clear(); this.transfers.clear(); this.seenReceipts.clear(); this.receipts = [];
    this.revision = -1; this.gap = false;
    this.terminalBaseline = Number.NEGATIVE_INFINITY;
    this.snapshot = { ...this.scope, revision: 0, clusters: [], transfers: [] };
  }
}
