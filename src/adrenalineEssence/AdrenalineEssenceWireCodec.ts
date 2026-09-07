import type { EssenceSnapshot } from './AdrenalineEssenceReplication';
import {
  essenceAccessGroupKey,
  type EssenceAccessGroup,
  type EssenceCancelReason,
  type EssenceClusterSnapshot,
  type EssenceScope,
  type EssenceTransferReceipt,
  type EssenceTransferSnapshot,
} from './AdrenalineEssenceTypes';

/** Versioned ae payload. Numbers are carried unchanged: no quantization or time subtraction. */
type WireId = string | number;
type WireGroup = [kind: 0] | [kind: 1 | 2, id: string];
type WireCluster = [
  id: WireId, group: number, state: 0 | 1,
  x: number, y: number, originX: number, originY: number, seed: number,
  value: number, createdAt: number, landAt: number, expiresAt: number, lastMergeAt?: number | null, lastExpiresAt?: number,
];
type WireTransfer = [
  id: WireId, clusterId: WireId, group: number, player: number,
  life: number, participation: number, sourceX: number, sourceY: number,
  targetX: number, targetY: number, value: number, startedAt: number, arrivalAt: number, seed: number,
];
type WireReceipt = [
  id: WireId, group: number, player: number, life: number, participation: number,
  status: number, reason: number, credited: number, returned: number, expired: number,
  resourceRevision: number, completedAt: number, sourceX: number, sourceY: number, targetX: number, targetY: number,
];

export type EssenceWireSnapshot = readonly [
  version: 2, worldRevision: number, activityRevision: number | null, full: 0 | 1,
  revision: number, baseRevision: number, stateRevision: number, sentAt: number,
  groups: readonly WireGroup[], players: readonly string[], clusters: readonly WireCluster[],
  clusterRemovals: readonly WireId[], transfers: readonly WireTransfer[],
  transferRemovals: readonly WireId[], receipts: readonly WireReceipt[],
];

const statuses = ['committed', 'returned', 'expired', 'cancelled'] as const;
const reasons: readonly (EssenceCancelReason | undefined)[] = [
  undefined, 'death', 'life', 'burrow', 'underground', 'participation', 'access', 'disconnect', 'teardown',
];
const encoded = new WeakMap<EssenceSnapshot, { readonly wire: EssenceWireSnapshot; bytes?: number }>();
const byteEncoder = new TextEncoder();

/** Scope and entity kind are already known at each tuple field, so canonical IDs need only their counter. */
function encodeId(id: string, scope: EssenceScope, kind: 'cluster' | 'transfer'): WireId {
  const prefix = `${scope.worldRevision}:${scope.activityRevision}:${kind}:`;
  if (!id.startsWith(prefix)) return id;
  const suffix = id.slice(prefix.length);
  const value = Number(suffix);
  return Number.isSafeInteger(value) && value >= 0 && String(value) === suffix ? value : id;
}

function decodeId(id: unknown, scope: EssenceScope, kind: 'cluster' | 'transfer'): string | null {
  if (typeof id === 'string' && id.length > 0) return id;
  return typeof id === 'number' && Number.isSafeInteger(id) && id >= 0
    ? `${scope.worldRevision}:${scope.activityRevision}:${kind}:${id}` : null;
}

/** Encoding is cached per immutable domain snapshot, shared by publication and byte diagnostics. */
export function encodeEssenceSnapshot(snapshot: EssenceSnapshot): EssenceWireSnapshot {
  const cached = encoded.get(snapshot);
  if (cached) return cached.wire;
  const groups: WireGroup[] = [];
  const groupIndices = new Map<string, number>();
  const players: string[] = [];
  const playerIndices = new Map<string, number>();
  const groupIndex = (group: EssenceAccessGroup): number => {
    const key = essenceAccessGroupKey(group);
    const existing = groupIndices.get(key);
    if (existing !== undefined) return existing;
    const index = groups.length;
    groups.push(group.kind === 'coop' ? [0] : group.kind === 'team' ? [1, group.teamId] : [2, group.playerId]);
    groupIndices.set(key, index);
    return index;
  };
  const playerIndex = (id: string): number => {
    const existing = playerIndices.get(id);
    if (existing !== undefined) return existing;
    const index = players.length;
    players.push(id);
    playerIndices.set(id, index);
    return index;
  };
  const clusters: WireCluster[] = snapshot.clusters.map(cluster => {
    const tuple: WireCluster = [
      encodeId(cluster.id, snapshot, 'cluster'), groupIndex(cluster.accessGroup), cluster.state === 'ejecting' ? 0 : 1,
      cluster.x, cluster.y, cluster.originX, cluster.originY, cluster.seed,
      cluster.value, cluster.createdAt, cluster.landAt, cluster.expiresAt,
    ];
    if (cluster.lastExpiresAt !== undefined) tuple.push(cluster.lastMergeAt ?? null, cluster.lastExpiresAt);
    else if (cluster.lastMergeAt !== undefined) tuple.push(cluster.lastMergeAt);
    return tuple;
  });
  const transfers: WireTransfer[] = snapshot.transfers.map(transfer => [
    encodeId(transfer.id, snapshot, 'transfer'), encodeId(transfer.clusterId, snapshot, 'cluster'),
    groupIndex(transfer.accessGroup), playerIndex(transfer.playerId), transfer.lifeRevision, transfer.participationRevision,
    transfer.sourceX, transfer.sourceY, transfer.targetX, transfer.targetY, transfer.value,
    transfer.startedAt, transfer.arrivalAt, transfer.seed,
  ]);
  const receipts: WireReceipt[] = snapshot.receipts.map(receipt => {
    if (receipt.worldRevision !== snapshot.worldRevision || receipt.activityRevision !== snapshot.activityRevision) {
      throw new Error('Essence receipt scope does not match its snapshot');
    }
    return [
      encodeId(receipt.id, snapshot, 'transfer'), groupIndex(receipt.accessGroup), playerIndex(receipt.playerId),
      receipt.lifeRevision, receipt.participationRevision, statuses.indexOf(receipt.status), reasons.indexOf(receipt.reason),
      receipt.creditedValue, receipt.returnedValue, receipt.expiredValue, receipt.resourceRevision,
      receipt.completedAt, receipt.sourceX, receipt.sourceY, receipt.targetX, receipt.targetY,
    ];
  });
  const wire: EssenceWireSnapshot = [
    2, snapshot.worldRevision, snapshot.activityRevision, snapshot.full ? 1 : 0,
    snapshot.revision, snapshot.baseRevision, snapshot.stateRevision, snapshot.sentAt,
    groups, players, clusters, snapshot.clusterRemovals.map(id => encodeId(id, snapshot, 'cluster')),
    transfers, snapshot.transferRemovals.map(id => encodeId(id, snapshot, 'transfer')), receipts,
  ];
  encoded.set(snapshot, { wire });
  return wire;
}

export function getEssenceWireByteLength(snapshot: EssenceSnapshot): number {
  const wire = encodeEssenceSnapshot(snapshot);
  const entry = encoded.get(snapshot)!;
  return entry.bytes ??= byteEncoder.encode(JSON.stringify(wire)).length;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonNegativeInteger = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0;
const dictionaryIndex = (value: unknown, count: number): value is number => nonNegativeInteger(value) && value < count;
const numericSpan = (tuple: readonly unknown[], first: number): boolean => tuple.slice(first).every(finite);

function decodeGroups(raw: readonly unknown[]): EssenceAccessGroup[] | null {
  const groups: EssenceAccessGroup[] = [];
  for (const group of raw) {
    if (!Array.isArray(group)) return null;
    if (group.length === 1 && group[0] === 0) groups.push({ kind: 'coop' });
    else if (group.length === 2 && (group[0] === 1 || group[0] === 2) && typeof group[1] === 'string' && group[1].length > 0) {
      groups.push(group[0] === 1 ? { kind: 'team', teamId: group[1] } : { kind: 'personal', playerId: group[1] });
    } else return null;
  }
  return groups;
}

function decodeCluster(raw: unknown, groups: readonly EssenceAccessGroup[], scope: EssenceScope): EssenceClusterSnapshot | null {
  if (!Array.isArray(raw) || (raw.length !== 12 && raw.length !== 13 && raw.length !== 14)
    || !raw.slice(1, 12).every(finite) || (raw.length >= 13 && raw[12] !== null && !finite(raw[12]))
    || (raw.length === 14 && !finite(raw[13]))
    || !dictionaryIndex(raw[1], groups.length) || (raw[2] !== 0 && raw[2] !== 1) || raw[8] < 0) return null;
  const id = decodeId(raw[0], scope, 'cluster');
  if (id === null) return null;
  const row = raw as WireCluster;
  return {
    id, accessGroup: groups[row[1]], state: row[2] === 0 ? 'ejecting' : 'grounded',
    x: row[3], y: row[4], originX: row[5], originY: row[6], seed: row[7],
    value: row[8], createdAt: row[9], landAt: row[10], expiresAt: row[11],
    ...(row[12] !== undefined && row[12] !== null ? { lastMergeAt: row[12] } : {}),
    ...(row[13] !== undefined ? { lastExpiresAt: row[13] } : {}),
  };
}

function decodeTransfer(raw: unknown, groups: readonly EssenceAccessGroup[], players: readonly string[], scope: EssenceScope): EssenceTransferSnapshot | null {
  if (!Array.isArray(raw) || raw.length !== 14 || !numericSpan(raw, 2)
    || !dictionaryIndex(raw[2], groups.length) || !dictionaryIndex(raw[3], players.length) || raw[10] < 0) return null;
  const id = decodeId(raw[0], scope, 'transfer');
  const clusterId = decodeId(raw[1], scope, 'cluster');
  if (id === null || clusterId === null) return null;
  const row = raw as WireTransfer;
  return {
    id, clusterId, accessGroup: groups[row[2]], playerId: players[row[3]], lifeRevision: row[4], participationRevision: row[5],
    sourceX: row[6], sourceY: row[7], targetX: row[8], targetY: row[9], value: row[10],
    startedAt: row[11], arrivalAt: row[12], seed: row[13],
  };
}

function decodeReceipt(raw: unknown, groups: readonly EssenceAccessGroup[], players: readonly string[], scope: EssenceScope): EssenceTransferReceipt | null {
  if (!Array.isArray(raw) || raw.length !== 16 || !numericSpan(raw, 1)
    || !dictionaryIndex(raw[1], groups.length) || !dictionaryIndex(raw[2], players.length)
    || !dictionaryIndex(raw[5], statuses.length) || !dictionaryIndex(raw[6], reasons.length)
    || raw[7] < 0 || raw[8] < 0 || raw[9] < 0) return null;
  const id = decodeId(raw[0], scope, 'transfer');
  if (id === null) return null;
  const row = raw as WireReceipt;
  const reason = reasons[row[6]];
  return {
    ...scope, id, accessGroup: groups[row[1]], playerId: players[row[2]], lifeRevision: row[3], participationRevision: row[4],
    status: statuses[row[5]], ...(reason !== undefined ? { reason } : {}),
    creditedValue: row[7], returnedValue: row[8], expiredValue: row[9], resourceRevision: row[10], completedAt: row[11],
    sourceX: row[12], sourceY: row[13], targetX: row[14], targetY: row[15],
  };
}

/** Invalid packets remain inert; a later valid full snapshot repairs transport loss. */
export function decodeEssenceSnapshot(raw: unknown): EssenceSnapshot | null {
  if (!Array.isArray(raw) || raw.length !== 15 || raw[0] !== 2
    || !nonNegativeInteger(raw[1]) || raw[1] <= 0
    || (raw[2] !== null && (!nonNegativeInteger(raw[2]) || raw[2] <= 0)) || (raw[3] !== 0 && raw[3] !== 1)
    || !nonNegativeInteger(raw[4]) || !nonNegativeInteger(raw[5]) || !nonNegativeInteger(raw[6]) || !finite(raw[7])
    || !raw.slice(8).every(Array.isArray)) return null;
  const groups = decodeGroups(raw[8]);
  if (!groups || !raw[9].every((id: unknown) => typeof id === 'string' && id.length > 0)) return null;
  const players = raw[9] as string[];
  const scope = { worldRevision: raw[1], activityRevision: raw[2] };
  const clusters: EssenceClusterSnapshot[] = [];
  const transfers: EssenceTransferSnapshot[] = [];
  const receipts: EssenceTransferReceipt[] = [];
  const clusterRemovals: string[] = [];
  const transferRemovals: string[] = [];
  for (const row of raw[10]) {
    const cluster = decodeCluster(row, groups, scope);
    if (!cluster) return null;
    clusters.push(cluster);
  }
  for (const rawId of raw[11]) {
    const id = decodeId(rawId, scope, 'cluster');
    if (id === null) return null;
    clusterRemovals.push(id);
  }
  for (const row of raw[12]) {
    const transfer = decodeTransfer(row, groups, players, scope);
    if (!transfer) return null;
    transfers.push(transfer);
  }
  for (const rawId of raw[13]) {
    const id = decodeId(rawId, scope, 'transfer');
    if (id === null) return null;
    transferRemovals.push(id);
  }
  for (const row of raw[14]) {
    const receipt = decodeReceipt(row, groups, players, scope);
    if (!receipt) return null;
    receipts.push(receipt);
  }
  return {
    ...scope, full: raw[3] === 1, revision: raw[4], baseRevision: raw[5], stateRevision: raw[6], sentAt: raw[7],
    clusters, clusterRemovals, transfers, transferRemovals, receipts,
  };
}
