import { describe, expect, it } from 'vitest';
import type { EssenceSnapshot } from '../src/adrenalineEssence/AdrenalineEssenceReplication';
import { decodeEssenceSnapshot, encodeEssenceSnapshot, getEssenceWireByteLength } from '../src/adrenalineEssence/AdrenalineEssenceWireCodec';
import type { EssenceAccessGroup, EssenceCancelReason, EssenceClusterSnapshot, EssenceTransferReceipt } from '../src/adrenalineEssence/AdrenalineEssenceTypes';

const groups: EssenceAccessGroup[] = [{ kind: 'coop' }, { kind: 'team', teamId: 'blau-💧' }, { kind: 'personal', playerId: 'player:α' }];
const scope = { worldRevision: 21, activityRevision: 7 };
const scopePrefix = '21:7';
const cluster = (index: number, overrides: Partial<EssenceClusterSnapshot> = {}): EssenceClusterSnapshot => ({
  id: `${scopePrefix}:cluster:${index}`, accessGroup: groups[index % groups.length], state: index % 2 ? 'ejecting' : 'grounded',
  x: 1 / 3, y: -4.56789, originX: 1024.1, originY: -44.4, seed: -12345,
  value: 0.1 + 0.2, createdAt: 1_700_000_000_000.25, landAt: 1_700_000_000_200.123,
  expiresAt: 1_700_000_008_200.123, ...overrides,
});

const receipt = (status: EssenceTransferReceipt['status'], reason?: EssenceCancelReason): EssenceTransferReceipt => ({
  ...scope, id: `${scopePrefix}:transfer:12`, accessGroup: groups[1], playerId: 'player:α', lifeRevision: 11, participationRevision: 2,
  status, ...(reason ? { reason } : {}), creditedValue: 0.123456789012345, returnedValue: 1 / 3, expiredValue: Number.MIN_VALUE,
  resourceRevision: 42, completedAt: 1_700_000_001_012.234, sourceX: -45.6, sourceY: 98.7, targetX: 0.1, targetY: -99.999,
});

function snapshot(overrides: Partial<EssenceSnapshot> = {}): EssenceSnapshot {
  return {
    ...scope, full: false, revision: 100, baseRevision: 99, stateRevision: 1032, sentAt: 1_700_000_001_250.123,
    clusters: [cluster(1), cluster(2, { lastMergeAt: 1_700_000_000_250.1 }), cluster(3, { lastExpiresAt: 1_700_000_008_300.987 })],
    clusterRemovals: [`${scopePrefix}:cluster:4`, 'external:arbitrary-cluster'],
    transfers: [{
      id: `${scopePrefix}:transfer:10`, clusterId: `${scopePrefix}:cluster:2`, accessGroup: groups[2], playerId: 'player:α',
      lifeRevision: 11, participationRevision: 2, sourceX: -45.6, sourceY: 98.7, targetX: 0.1, targetY: -99.999,
      value: Number.MIN_VALUE, startedAt: 1_700_000_000_234.56, arrivalAt: 1_700_000_000_444.999, seed: 2147483647,
    }],
    transferRemovals: [`${scopePrefix}:transfer:3`, 'external:arbitrary-transfer'],
    receipts: [receipt('committed'), receipt('returned', 'burrow'), receipt('expired'), receipt('cancelled', 'teardown')],
    ...overrides,
  };
}

const roundtrip = (state: EssenceSnapshot) => decodeEssenceSnapshot(JSON.parse(JSON.stringify(encodeEssenceSnapshot(state))));

describe('versioned compact essence wire tuples', () => {
  it('round-trips full and delta variants without changing floats, identities, access or optional presentation fields', () => {
    const delta = snapshot();
    expect(roundtrip(delta)).toEqual(delta);
    const full = snapshot({ full: true, receipts: [], clusterRemovals: [], transferRemovals: [] });
    expect(roundtrip(full)).toEqual(full);
    const empty = snapshot({ full: true, clusters: [], transfers: [], receipts: [], clusterRemovals: [], transferRemovals: [] });
    expect(roundtrip(empty)).toEqual(empty);
    const mixedExpiry = snapshot({ clusters: [cluster(2, { lastMergeAt: 100.23, lastExpiresAt: 100.456 })] });
    expect(roundtrip(mixedExpiry)).toEqual(mixedExpiry);
    expect(roundtrip(delta)!.transfers[0].value).toBe(Number.MIN_VALUE);
  });

  it('preserves every terminal reason and never duplicates the per-packet scope', () => {
    const reasons: EssenceCancelReason[] = ['death', 'life', 'burrow', 'underground', 'participation', 'access', 'disconnect', 'teardown'];
    const state = snapshot({ receipts: reasons.map(reason => receipt('cancelled', reason)) });
    expect(roundtrip(state)).toEqual(state);
    expect(encodeEssenceSnapshot(state)[14].every(row => row.length === 16)).toBe(true);
    expect(() => encodeEssenceSnapshot(snapshot({ receipts: [{ ...receipt('committed'), activityRevision: 999 }] }))).toThrow(/scope/);
  });

  it('deduplicates access groups and players and caches the same wire projection for publication and metrics', () => {
    const state = snapshot({ clusters: Array.from({ length: 30 }, (_, index) => cluster(index)) });
    const wire = encodeEssenceSnapshot(state);
    expect(wire[8]).toHaveLength(3);
    expect(wire[9]).toEqual(['player:α']);
    expect(encodeEssenceSnapshot(state)).toBe(wire);
    expect(wire[10][0][0]).toBe(0);
    const bytes = new TextEncoder().encode(JSON.stringify(wire)).length;
    expect(getEssenceWireByteLength(state)).toBe(bytes);
    expect(getEssenceWireByteLength(state)).toBe(bytes);
    expect(bytes).toBeLessThan(new TextEncoder().encode(JSON.stringify(state)).length * 0.6);
  });

  it('keeps noncanonical, external and large string identities lossless', () => {
    const ids = ['21:7:cluster:01', '21:7:cluster:9007199254740992', '21:7:cluster:-1', 'another-world:3', '💧:α', '123'];
    const state = snapshot({ clusters: ids.map((id, index) => cluster(index, { id })), clusterRemovals: ids });
    expect(roundtrip(state)).toEqual(state);
    expect(encodeEssenceSnapshot(state)[10].map(row => row[0])).toEqual(ids);
  });

  it('round-trips an explicitly absent Lobby Activity with scope-safe IDs and receipt attribution', () => {
    const state = snapshot({
      activityRevision: null,
      clusters: [cluster(1, { id: '21:null:cluster:1' })],
      transfers: [], clusterRemovals: ['21:null:cluster:2'], transferRemovals: ['21:null:transfer:3'],
      receipts: [{ ...receipt('committed'), activityRevision: null, id: '21:null:transfer:4' }],
    });
    const wire = encodeEssenceSnapshot(state);
    expect(wire[0]).toBe(2);
    expect(wire[2]).toBeNull();
    expect(wire[10][0][0]).toBe(1);
    expect(roundtrip(state)).toEqual(state);
  });

  it('rejects malformed or unsupported packets before applying any partial state', () => {
    for (const invalid of [null, undefined, {}, [], [2], snapshot()]) expect(decodeEssenceSnapshot(invalid)).toBeNull();
    const mutations: ((wire: unknown[][] & unknown[]) => void)[] = [
      wire => { wire[0] = 1 as never; },
      wire => { wire[2] = 0 as never; },
      wire => { wire[1] = Number.NaN as never; },
      wire => { wire[8] = [[3, 'unknown-group']]; },
      wire => { (wire[10][0] as unknown[])[1] = 999; },
      wire => { (wire[10][0] as unknown[])[2] = 9; },
      wire => { (wire[10][0] as unknown[])[8] = -1; },
      wire => { (wire[12][0] as unknown[])[3] = -1; },
      wire => { (wire[12][0] as unknown[])[12] = Number.POSITIVE_INFINITY; },
      wire => { (wire[14][0] as unknown[])[5] = 99; },
      wire => { (wire[14][0] as unknown[])[6] = 99; },
      wire => { (wire[14][0] as unknown[]).pop(); },
    ];
    for (const mutate of mutations) {
      const wire = JSON.parse(JSON.stringify(encodeEssenceSnapshot(snapshot())));
      mutate(wire);
      expect(decodeEssenceSnapshot(wire)).toBeNull();
    }
  });
});
