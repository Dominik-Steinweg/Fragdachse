import { ADRENALINE_ESSENCE_CONFIG, type AdrenalineEssenceConfig } from './AdrenalineEssenceConfig';
import {
  hasEssenceAccess,
  type AdrenalineEssencePorts,
  type EssenceAttributionDiagnostics,
  type EssenceCancelReason,
  type EssenceClusterSnapshot,
  type EssenceDiagnostics,
  type EssencePlayerSnapshot,
  type EssencePoint,
  type EssenceReward,
  type EssenceScope,
  type EssenceState,
  type EssenceTransferReceipt,
  type EssenceTransferSnapshot,
} from './AdrenalineEssenceTypes';

type Mutable<T> = { -readonly [P in keyof T]: T[P] };

interface Contribution {
  readonly id: string;
  readonly creatorId: string;
  readonly diagnosticKey: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  value: number;
}

interface Cluster {
  readonly anchor: Omit<EssenceClusterSnapshot, 'value' | 'expiresAt' | 'lastExpiresAt' | 'state' | 'lastMergeAt'>;
  state: 'ejecting' | 'grounded';
  lastMergeAt?: number;
  contributions: Contribution[];
}

interface Transfer {
  readonly snapshot: EssenceTransferSnapshot;
  readonly source: Cluster['anchor'];
  readonly contributions: Contribution[];
}

/** A compact spatial index for fixed anchors and the small per-tick player projection. */
class PointGrid<T extends EssencePoint> {
  private readonly cells = new Map<string, Set<T>>();
  constructor(private readonly size: number) {}
  add(point: T): void {
    const key = this.key(point.x, point.y);
    let cell = this.cells.get(key);
    if (!cell) this.cells.set(key, cell = new Set());
    cell.add(point);
  }
  delete(point: T): void {
    const key = this.key(point.x, point.y);
    const cell = this.cells.get(key);
    cell?.delete(point);
    if (cell?.size === 0) this.cells.delete(key);
  }
  nearby(x: number, y: number, radius: number): T[] {
    const result: T[] = [];
    for (let cy = Math.floor((y - radius) / this.size); cy <= Math.floor((y + radius) / this.size); cy++) {
      for (let cx = Math.floor((x - radius) / this.size); cx <= Math.floor((x + radius) / this.size); cx++) {
        const cell = this.cells.get(`${cx},${cy}`);
        if (cell) for (const point of cell) result.push(point);
      }
    }
    return result;
  }
  clear(): void { this.cells.clear(); }
  private key(x: number, y: number): string { return `${Math.floor(x / this.size)},${Math.floor(y / this.size)}`; }
}

const sumValue = (contributions: readonly Contribution[]): number => contributions.reduce((sum, part) => sum + part.value, 0);
const compareContributions = (left: Contribution, right: Contribution): number => left.expiresAt - right.expiresAt || left.id.localeCompare(right.id);
const finitePoint = (point: EssencePoint): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);
const distanceSquared = (left: EssencePoint, right: EssencePoint): number => (left.x - right.x) ** 2 + (left.y - right.y) ** 2;

/**
 * Host-owned essence domain with an explicit Activity or Lobby World lifetime.
 * No entity, renderer, network or resource state is owned here.
 * At a timestamp: observed lifecycle invalidation wins, then arrivals in stable order,
 * then landing/expiry and finally new reservations. Resource commits are never rolled back.
 */
export class AdrenalineEssenceRuntime {
  private readonly config: AdrenalineEssenceConfig;
  private readonly clusters = new Map<string, Cluster>();
  private readonly transfers = new Map<string, Transfer>();
  private readonly mergeGrid: PointGrid<Cluster['anchor']>;
  private readonly seenRewards = new Set<string>();
  private readonly rewardRetention: { readonly id: string; readonly acceptedAt: number }[] = [];
  private rewardRetentionCursor = 0;
  private readonly receipts: EssenceTransferReceipt[] = [];
  private readonly attribution = new Map<string, Mutable<EssenceAttributionDiagnostics>>();
  private readonly cancellations: Record<EssenceCancelReason, number> = {
    death: 0, life: 0, burrow: 0, underground: 0, participation: 0, access: 0, disconnect: 0, teardown: 0,
  };
  private revision = 0;
  private snapshotCache: EssenceState | null = null;
  private sequence = 0;
  private now = 0;
  private destroyed = false;
  /** Resource observers run after the resource write; they cannot cancel that winning commit. */
  private committing: Transfer | null = null;
  private materializedValue = 0;
  private authoredValue = 0;
  private committedValue = 0;
  private expiredValue = 0;
  private placementFailedValue = 0;
  private lifecycleDiscardedValue = 0;
  private returnedValue = 0;
  private expiredReturnValue = 0;
  private rewardCount = 0;
  private duplicateRewardCount = 0;
  private staleRewardCount = 0;
  private invalidRewardCount = 0;
  private placementFailureCount = 0;
  private mergeCount = 0;
  private peakClusterCount = 0;
  private peakTransferCount = 0;
  private candidateChecks = 0;
  private lineOfSightChecks = 0;
  private landingDelayTotal = 0;
  private transferStartDelayTotal = 0;
  private transferDurationTotal = 0;
  private startedTransferCount = 0;
  private completedTransferCount = 0;
  private readonly cpuMs = { materialize: 0, transfers: 0, landingMergeExpiry: 0, candidates: 0 };

  constructor(
    readonly scope: EssenceScope,
    private readonly ports: AdrenalineEssencePorts,
    config: Partial<AdrenalineEssenceConfig> = {},
  ) {
    if (!Number.isSafeInteger(scope.worldRevision) || scope.worldRevision <= 0
      || (scope.activityRevision !== null && (!Number.isSafeInteger(scope.activityRevision) || scope.activityRevision <= 0))) {
      throw new RangeError('Essence scope needs a positive World revision and a positive or explicitly absent Activity revision');
    }
    this.scope = Object.freeze({ ...scope });
    this.config = Object.freeze({ ...ADRENALINE_ESSENCE_CONFIG, ...config });
    for (const [key, value] of Object.entries(this.config)) {
      if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid essence config ${key}`);
    }
    if (this.config.magnetRadius <= 0 || this.config.mergeRadius <= 0 || this.config.dedupeRetentionMs <= 0
      || this.config.landingMaxMs < this.config.landingMinMs || this.config.transferMaxMs < this.config.transferMinMs
      || this.config.scatterMaxRadius < this.config.scatterMinRadius) {
      throw new Error('Invalid essence timing or radius range');
    }
    if (!Number.isSafeInteger(this.config.fragmentsPerReward) || this.config.fragmentsPerReward < 1
      || this.config.scatterAngleJitterDegrees > 180 / this.config.fragmentsPerReward) {
      throw new Error('Invalid essence fragment count or angular jitter');
    }
    this.mergeGrid = new PointGrid(this.config.mergeRadius);
  }

  materialize(reward: EssenceReward): boolean {
    if (this.destroyed || reward.worldRevision !== this.scope.worldRevision || reward.activityRevision !== this.scope.activityRevision
      || reward.createdAt < this.now - this.config.dedupeRetentionMs) {
      this.staleRewardCount++;
      return false;
    }
    if (!reward.id || !reward.creatorId || !Number.isFinite(reward.resolvedValue) || reward.resolvedValue <= 0
      || !Number.isFinite(reward.authoredValue) || reward.authoredValue < 0 || !Number.isFinite(reward.createdAt)
      || !Number.isFinite(reward.seed) || !finitePoint(reward.origin)) {
      this.invalidRewardCount++;
      return false;
    }
    if (this.seenRewards.has(reward.id)) {
      this.duplicateRewardCount++;
      return false;
    }
    this.now = Math.max(this.now, reward.createdAt);
    this.pruneRetention();
    this.seenRewards.add(reward.id);
    this.rewardRetention.push({ id: reward.id, acceptedAt: this.now });
    this.materializedValue += reward.resolvedValue;
    this.authoredValue += reward.authoredValue;
    this.rewardCount++;
    const cpuStarted = performance.now();
    const diagnosticKey = this.recordAttribution(reward);
    const grounds: { point: EssencePoint; seed: number }[] = [];
    let randomState = reward.seed | 0;
    const random = () => ((randomState = (Math.imul(randomState, 1664525) + 1013904223) | 0) >>> 0) / 0x1_0000_0000;
    const rotation = random() * Math.PI * 2;
    const angularJitter = this.config.scatterAngleJitterDegrees * Math.PI / 180;
    for (let fragment = 0; fragment < this.config.fragmentsPerReward; fragment++) {
      const angle = rotation + fragment * Math.PI * 2 / this.config.fragmentsPerReward + (random() * 2 - 1) * angularJitter;
      const radius = this.config.scatterMinRadius + random() * (this.config.scatterMaxRadius - this.config.scatterMinRadius);
      const point = this.ports.resolveGroundPoint({
        x: reward.origin.x + Math.cos(angle) * radius,
        y: reward.origin.y + Math.sin(angle) * radius,
      }, randomState);
      // Fallback geometry may collapse several directions to the same reachable point.
      // Split only after placement, so every surviving position receives its share of the full reward.
      if (point && finitePoint(point) && !grounds.some(ground => ground.point.x === point.x && ground.point.y === point.y)) {
        grounds.push({ point: { x: point.x, y: point.y }, seed: randomState });
      }
    }
    if (!grounds.length) {
      this.placementFailedValue += reward.resolvedValue;
      this.placementFailureCount++;
      this.ports.onPlacementFailure?.(reward);
      this.cpuMs.materialize += performance.now() - cpuStarted;
      return true;
    }
    const share = reward.resolvedValue / grounds.length;
    let allocated = 0;
    let landingDelaySum = 0;
    let spawnedCount = 0;
    for (let fragment = 0; fragment < grounds.length; fragment++) {
      const ground = grounds[fragment];
      const remainder = reward.resolvedValue - allocated;
      const value = fragment === grounds.length - 1 ? remainder : Math.min(share, remainder);
      // A subnormal share may round to zero. The final representable remainder still survives.
      if (value <= 0) continue;
      allocated += value;
      const timingRandom = ((Math.imul(ground.seed, 1664525) + 1013904223) >>> 0) / 0x1_0000_0000;
      const landingDelay = this.config.landingMinMs + timingRandom * (this.config.landingMaxMs - this.config.landingMinMs);
      const landAt = reward.createdAt + landingDelay;
      const id = this.nextId('cluster');
      const cluster: Cluster = {
        anchor: {
          id, accessGroup: Object.freeze({ ...reward.accessGroup }),
          x: ground.point.x, y: ground.point.y, originX: reward.origin.x, originY: reward.origin.y,
          seed: ground.seed, createdAt: reward.createdAt, landAt,
        },
        state: 'ejecting',
        contributions: [{
          id: `${id}:contribution`, creatorId: reward.creatorId, diagnosticKey, createdAt: reward.createdAt,
          value, expiresAt: landAt + this.config.groundLifetimeMs,
        }],
      };
      this.clusters.set(id, cluster);
      landingDelaySum += landingDelay;
      spawnedCount++;
    }
    // This remains a per-reward diagnostic, independent of fragmentation.
    this.landingDelayTotal += landingDelaySum / spawnedCount;
    this.peakClusterCount = Math.max(this.peakClusterCount, this.clusters.size);
    this.revision++;
    this.cpuMs.materialize += performance.now() - cpuStarted;
    return true;
  }

  update(now: number): void {
    if (this.destroyed || !Number.isFinite(now) || now < this.now) return;
    this.now = now;
    this.pruneRetention();
    const transferCpuStarted = performance.now();
    const players = new Map(this.ports.getPlayers().map(player => [player.playerId, player]));
    const transfers = [...this.transfers.values()].sort((left, right) => (
      left.snapshot.arrivalAt - right.snapshot.arrivalAt || left.snapshot.id.localeCompare(right.snapshot.id)
    ));
    for (const transfer of transfers) {
      const reason = this.invalidCollectorReason(transfer, players.get(transfer.snapshot.playerId));
      if (reason) this.finishTransfer(transfer, 0, 0, reason);
    }
    for (const transfer of transfers) {
      if (!this.transfers.has(transfer.snapshot.id) || transfer.snapshot.arrivalAt > now) continue;
      // Resource observers may synchronously invalidate another collector during an earlier
      // commit. The final life/access check belongs immediately before this atomic commit.
      const currentPlayer = this.ports.getPlayers().find(player => player.playerId === transfer.snapshot.playerId);
      const reason = this.invalidCollectorReason(transfer, currentPlayer);
      if (reason) {
        this.finishTransfer(transfer, 0, 0, reason);
        continue;
      }
      this.committing = transfer;
      let result: ReturnType<AdrenalineEssencePorts['commitResolvedGain']>;
      try {
        result = this.ports.commitResolvedGain(transfer.snapshot.playerId, transfer.snapshot.value);
      } finally {
        this.committing = null;
      }
      // A broken resource adapter must never turn an invalid result into newly created value.
      const credited = Number.isFinite(result.creditedValue)
        ? Math.max(0, Math.min(transfer.snapshot.value, result.creditedValue)) : 0;
      if (this.destroyed) {
        // Teardown may run from a post-write resource observer. It already discarded the
        // reservation, so replace only the actually committed part in that accounting.
        this.lifecycleDiscardedValue -= credited;
        this.committedValue += credited;
        if (credited > 0) {
          this.cancellations.teardown--;
          this.completedTransferCount++;
          this.transferDurationTotal += this.now - transfer.snapshot.startedAt;
        }
        const fullyCredited = credited === transfer.snapshot.value;
        let remaining = credited;
        for (const part of transfer.contributions) {
          const value = fullyCredited ? part.value : Math.min(part.value, remaining);
          if (!fullyCredited) remaining -= value;
          this.recordCollectedValue(part, transfer.snapshot.playerId, value);
        }
        this.cpuMs.transfers += performance.now() - transferCpuStarted;
        return;
      }
      this.finishTransfer(transfer, credited, result.resourceRevision);
    }
    const landingCpuStarted = performance.now();
    this.cpuMs.transfers += landingCpuStarted - transferCpuStarted;
    this.landAndExpire();
    const candidatesCpuStarted = performance.now();
    this.cpuMs.landingMergeExpiry += candidatesCpuStarted - landingCpuStarted;
    this.reserveNearby();
    this.cpuMs.candidates += performance.now() - candidatesCpuStarted;
  }

  /** Immediate life/burrow hooks can cancel before an update's arrival phase. */
  cancelPlayer(playerId: string, reason: EssenceCancelReason, now = this.now): void {
    if (this.destroyed || !Number.isFinite(now)) return;
    this.now = Math.max(this.now, now);
    for (const transfer of [...this.transfers.values()]) {
      if (transfer !== this.committing && transfer.snapshot.playerId === playerId) this.finishTransfer(transfer, 0, 0, reason);
    }
  }

  getState(): EssenceState {
    if (this.snapshotCache?.revision === this.revision) return this.snapshotCache;
    this.snapshotCache = {
      ...this.scope, revision: this.revision,
      clusters: [...this.clusters.values()].map(cluster => ({
        ...cluster.anchor, state: cluster.state, value: sumValue(cluster.contributions),
        expiresAt: cluster.contributions[0].expiresAt,
        ...(cluster.contributions[cluster.contributions.length - 1].expiresAt > cluster.contributions[0].expiresAt
          ? { lastExpiresAt: cluster.contributions[cluster.contributions.length - 1].expiresAt } : {}),
        ...(cluster.lastMergeAt !== undefined ? { lastMergeAt: cluster.lastMergeAt } : {}),
      })),
      transfers: [...this.transfers.values()].map(transfer => ({ ...transfer.snapshot })),
    };
    return this.snapshotCache;
  }

  /** Delivery is separate from full state so JIP never replays a historical gain. */
  drainReceipts(): EssenceTransferReceipt[] { return this.receipts.splice(0); }

  getDiagnostics(): EssenceDiagnostics {
    let ejectingValue = 0;
    let groundedValue = 0;
    let reservedValue = 0;
    let contributionCount = 0;
    for (const cluster of this.clusters.values()) {
      const value = sumValue(cluster.contributions);
      if (cluster.state === 'ejecting') ejectingValue += value;
      else groundedValue += value;
      contributionCount += cluster.contributions.length;
    }
    for (const transfer of this.transfers.values()) {
      reservedValue += transfer.snapshot.value;
      contributionCount += transfer.contributions.length;
    }
    const activeValue = ejectingValue + groundedValue + reservedValue;
    return {
      materializedValue: this.materializedValue, authoredValue: this.authoredValue, committedValue: this.committedValue,
      expiredValue: this.expiredValue, placementFailedValue: this.placementFailedValue,
      lifecycleDiscardedValue: this.lifecycleDiscardedValue, returnedValue: this.returnedValue,
      expiredReturnValue: this.expiredReturnValue, ejectingValue, groundedValue, reservedValue, activeValue,
      conservationError: this.materializedValue - this.committedValue - this.expiredValue
        - this.placementFailedValue - this.lifecycleDiscardedValue - activeValue,
      rewardCount: this.rewardCount, duplicateRewardCount: this.duplicateRewardCount,
      staleRewardCount: this.staleRewardCount, invalidRewardCount: this.invalidRewardCount,
      placementFailureCount: this.placementFailureCount, mergeCount: this.mergeCount,
      clusterCount: this.clusters.size, contributionCount, transferCount: this.transfers.size,
      dedupeCount: this.seenRewards.size, peakClusterCount: this.peakClusterCount, peakTransferCount: this.peakTransferCount,
      candidateChecks: this.candidateChecks, lineOfSightChecks: this.lineOfSightChecks,
      meanLandingDelayMs: this.rewardCount ? this.landingDelayTotal / this.rewardCount : 0,
      meanTransferStartDelayMs: this.startedTransferCount ? this.transferStartDelayTotal / this.startedTransferCount : 0,
      meanTransferDurationMs: this.completedTransferCount ? this.transferDurationTotal / this.completedTransferCount : 0,
      cpuMs: { ...this.cpuMs },
      cancellations: { ...this.cancellations }, byAttribution: [...this.attribution.values()].map(entry => ({ ...entry })),
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.lifecycleDiscardedValue += this.getDiagnostics().activeValue;
    this.cancellations.teardown += this.transfers.size;
    this.clusters.clear();
    this.transfers.clear();
    this.mergeGrid.clear();
    this.seenRewards.clear();
    this.rewardRetention.length = 0;
    this.rewardRetentionCursor = 0;
    this.receipts.length = 0;
    this.snapshotCache = null;
    this.destroyed = true;
    this.revision++;
  }

  private landAndExpire(): void {
    const landing = [...this.clusters.values()].filter(cluster => cluster.state === 'ejecting' && cluster.anchor.landAt <= this.now)
      .sort((left, right) => left.anchor.landAt - right.anchor.landAt || left.anchor.id.localeCompare(right.anchor.id));
    for (const cluster of this.clusters.values()) {
      const retained: Contribution[] = [];
      for (const contribution of cluster.contributions) {
        if (contribution.expiresAt <= this.now) {
          this.expiredValue += contribution.value;
          this.revision++;
        } else retained.push(contribution);
      }
      cluster.contributions = retained;
      if (!retained.length) this.removeCluster(cluster);
    }
    for (const cluster of landing) {
      if (!this.clusters.has(cluster.anchor.id)) continue;
      const target = this.findMergeTarget(cluster);
      if (target) {
        target.contributions.push(...cluster.contributions);
        target.contributions.sort(compareContributions);
        target.lastMergeAt = this.now;
        this.removeCluster(cluster);
        this.mergeCount++;
      } else {
        cluster.state = 'grounded';
        this.mergeGrid.add(cluster.anchor);
      }
      this.revision++;
    }
  }

  private findMergeTarget(cluster: Cluster): Cluster | undefined {
    const anchor = cluster.anchor;
    const candidates = this.mergeGrid.nearby(anchor.x, anchor.y, this.config.mergeRadius)
      .filter(other => other.id !== anchor.id && hasEssenceAccess(other.accessGroup, anchor.accessGroup)
        && anchor.landAt >= other.landAt && anchor.landAt - other.landAt <= this.config.mergeWindowMs
        && distanceSquared(anchor, other) <= this.config.mergeRadius ** 2)
      .sort((left, right) => distanceSquared(anchor, left) - distanceSquared(anchor, right) || left.id.localeCompare(right.id));
    for (const candidate of candidates) {
      this.lineOfSightChecks++;
      if (this.ports.hasLineOfSight(anchor, candidate)) return this.clusters.get(candidate.id);
    }
    return undefined;
  }

  private reserveNearby(): void {
    // Read again after arrival commits; projected resource snapshots must not overbook new flights.
    const playerGrid = new PointGrid<EssencePlayerSnapshot>(this.config.magnetRadius);
    for (const player of this.ports.getPlayers()) {
      if (player.interactive && player.alive && player.collectible && player.accessGroup && finitePoint(player)) playerGrid.add(player);
    }
    const incoming = new Map<string, number>();
    for (const transfer of this.transfers.values()) {
      const { playerId, value } = transfer.snapshot;
      incoming.set(playerId, (incoming.get(playerId) ?? 0) + value);
    }
    const clusters = [...this.clusters.values()].filter(cluster => cluster.state === 'grounded')
      .sort((left, right) => left.anchor.landAt - right.anchor.landAt || left.anchor.id.localeCompare(right.anchor.id));
    for (const cluster of clusters) {
      const anchor = cluster.anchor;
      const candidates = playerGrid.nearby(anchor.x, anchor.y, this.config.magnetRadius)
        .filter(player => {
          this.candidateChecks++;
          return hasEssenceAccess(anchor.accessGroup, player.accessGroup)
            && distanceSquared(anchor, player) <= this.config.magnetRadius ** 2;
        })
        .sort((left, right) => distanceSquared(anchor, left) - distanceSquared(anchor, right) || left.playerId.localeCompare(right.playerId));
      for (const player of candidates) {
        if (!cluster.contributions.length) break;
        const capacity = player.maxAdrenaline - player.adrenaline - (incoming.get(player.playerId) ?? 0);
        if (!Number.isFinite(capacity) || capacity <= 0) continue;
        this.lineOfSightChecks++;
        if (!this.ports.hasLineOfSight(anchor, player)) continue;
        const contributions = this.takeContributions(cluster, capacity);
        const value = sumValue(contributions);
        if (value <= 0) continue;
        const distance = Math.sqrt(distanceSquared(anchor, player));
        const flightMs = this.config.transferMinMs + (this.config.transferMaxMs - this.config.transferMinMs)
          * Math.min(1, distance / this.config.magnetRadius);
        const transfer: Transfer = {
          source: anchor, contributions,
          snapshot: {
            id: this.nextId('transfer'), clusterId: anchor.id, accessGroup: anchor.accessGroup,
            playerId: player.playerId, lifeRevision: player.lifeRevision, participationRevision: player.participationRevision,
            sourceX: anchor.x, sourceY: anchor.y, targetX: player.x, targetY: player.y,
            value, startedAt: this.now, arrivalAt: this.now + flightMs, seed: anchor.seed,
          },
        };
        this.transfers.set(transfer.snapshot.id, transfer);
        incoming.set(player.playerId, (incoming.get(player.playerId) ?? 0) + value);
        this.startedTransferCount++;
        this.transferStartDelayTotal += this.now - anchor.landAt;
        this.peakTransferCount = Math.max(this.peakTransferCount, this.transfers.size);
        this.revision++;
      }
      if (!cluster.contributions.length) this.removeCluster(cluster);
    }
  }

  private takeContributions(cluster: Cluster, amount: number): Contribution[] {
    // Full acceptance moves the original fractions intact. Repeated subtraction from
    // their rounded aggregate would otherwise manufacture a residual on the last part.
    if (amount >= sumValue(cluster.contributions)) {
      const selected = cluster.contributions;
      cluster.contributions = [];
      return selected;
    }
    const selected: Contribution[] = [];
    while (amount > 0 && cluster.contributions.length) {
      const part = cluster.contributions[0];
      const value = Math.min(part.value, amount);
      selected.push({ ...part, value });
      part.value -= value;
      amount -= value;
      if (part.value === 0) cluster.contributions.shift();
    }
    return selected;
  }

  private invalidCollectorReason(transfer: Transfer, player: EssencePlayerSnapshot | undefined): EssenceCancelReason | undefined {
    if (!player) return 'disconnect';
    if (!player.interactive || player.participationRevision !== transfer.snapshot.participationRevision) return 'participation';
    if (!player.alive) return 'death';
    if (player.lifeRevision !== transfer.snapshot.lifeRevision) return 'life';
    if (!player.collectible) return player.blockedReason ?? 'underground';
    if (!hasEssenceAccess(transfer.snapshot.accessGroup, player.accessGroup)) return 'access';
    return undefined;
  }

  private finishTransfer(transfer: Transfer, credited: number, resourceRevision: number, reason?: EssenceCancelReason): void {
    if (!this.transfers.delete(transfer.snapshot.id)) return;
    const snapshot = transfer.snapshot;
    const fullyCredited = credited === snapshot.value;
    let remainingCredit = credited;
    let returned = 0;
    let expired = 0;
    const returning: Contribution[] = [];
    for (const contribution of transfer.contributions) {
      const contributionCredit = fullyCredited ? contribution.value : Math.min(contribution.value, remainingCredit);
      if (!fullyCredited) remainingCredit -= contributionCredit;
      this.recordCollectedValue(contribution, snapshot.playerId, contributionCredit);
      const rest = contribution.value - contributionCredit;
      if (rest > 0) {
        if (contribution.expiresAt > this.now) {
          returning.push({ ...contribution, value: rest });
          returned += rest;
        } else expired += rest;
      }
    }
    if (returning.length) {
      let source = this.clusters.get(snapshot.clusterId);
      if (!source) {
        source = { anchor: transfer.source, state: 'grounded', contributions: [] };
        this.clusters.set(source.anchor.id, source);
        this.mergeGrid.add(source.anchor);
      }
      for (const part of returning) {
        const existing = source.contributions.find(candidate => candidate.id === part.id);
        if (existing) existing.value += part.value;
        else source.contributions.push(part);
      }
      source.contributions.sort(compareContributions);
      this.peakClusterCount = Math.max(this.peakClusterCount, this.clusters.size);
    }
    this.committedValue += credited;
    this.returnedValue += returned;
    this.expiredValue += expired;
    this.expiredReturnValue += expired;
    this.completedTransferCount++;
    this.transferDurationTotal += this.now - snapshot.startedAt;
    if (reason) this.cancellations[reason]++;
    this.receipts.push({
      ...this.scope, id: snapshot.id, status: credited > 0 ? 'committed' : returned > 0 ? 'returned' : reason ? 'cancelled' : 'expired',
      ...(reason ? { reason } : {}), accessGroup: snapshot.accessGroup,
      playerId: snapshot.playerId, lifeRevision: snapshot.lifeRevision, participationRevision: snapshot.participationRevision,
      creditedValue: credited, returnedValue: returned, expiredValue: expired,
      resourceRevision, completedAt: this.now, sourceX: snapshot.sourceX, sourceY: snapshot.sourceY,
      targetX: snapshot.targetX, targetY: snapshot.targetY,
    });
    this.revision++;
  }

  private removeCluster(cluster: Cluster): void {
    this.clusters.delete(cluster.anchor.id);
    if (cluster.state === 'grounded') this.mergeGrid.delete(cluster.anchor);
    this.revision++;
  }

  private recordCollectedValue(contribution: Contribution, collectorId: string, value: number): void {
    const attribution = this.attribution.get(contribution.diagnosticKey)!;
    attribution.committedValue += value;
    if (collectorId === contribution.creatorId) attribution.creatorCollectedValue += value;
    else attribution.allyCollectedValue += value;
  }

  private recordAttribution(reward: EssenceReward): string {
    const distance = reward.distance ?? 0;
    const distanceBand = distance <= this.config.magnetRadius ? 'near' : distance <= this.config.magnetRadius * 3 ? 'mid' : 'far';
    const values = [reward.creatorId, reward.weaponId ?? 'unknown', reward.branchId ?? 'unknown', reward.targetKind ?? 'unknown', distanceBand];
    const key = JSON.stringify(values);
    let attribution = this.attribution.get(key);
    if (!attribution) {
      attribution = {
        creatorId: values[0], weaponId: values[1], branchId: values[2], targetKind: values[3], distanceBand,
        rewardCount: 0, authoredValue: 0, materializedValue: 0, committedValue: 0, creatorCollectedValue: 0, allyCollectedValue: 0,
      };
      this.attribution.set(key, attribution);
    }
    attribution.rewardCount++;
    attribution.authoredValue += reward.authoredValue;
    attribution.materializedValue += reward.resolvedValue;
    return key;
  }

  private nextId(kind: string): string {
    return `${this.scope.worldRevision}:${this.scope.activityRevision}:${kind}:${++this.sequence}`;
  }

  private pruneRetention(): void {
    const cutoff = this.now - this.config.dedupeRetentionMs;
    while (this.rewardRetentionCursor < this.rewardRetention.length
      && this.rewardRetention[this.rewardRetentionCursor].acceptedAt < cutoff) {
      this.seenRewards.delete(this.rewardRetention[this.rewardRetentionCursor++].id);
    }
    if (this.rewardRetentionCursor > 1024 && this.rewardRetentionCursor * 2 > this.rewardRetention.length) {
      this.rewardRetention.splice(0, this.rewardRetentionCursor);
      this.rewardRetentionCursor = 0;
    }
    while (this.receipts.length && this.receipts[0].completedAt < cutoff) this.receipts.shift();
  }
}
