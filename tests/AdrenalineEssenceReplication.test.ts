import { describe, expect, it } from 'vitest';
import { AdrenalineEssenceClientReplica, AdrenalineEssenceReplication, ESSENCE_RECEIPT_REPEAT_MS } from '../src/adrenalineEssence/AdrenalineEssenceReplication';
import type { EssenceClusterSnapshot, EssenceState, EssenceTransferReceipt } from '../src/adrenalineEssence/AdrenalineEssenceTypes';

const scope = { worldRevision: 1, activityRevision: 2 };
const cluster: EssenceClusterSnapshot = { id: 'c', accessGroup: { kind: 'coop' }, x: 10, y: 20, originX: 10, originY: 20, seed: 4, value: 0.15, createdAt: 0, landAt: 200, expiresAt: 8200, state: 'grounded' };
const state = (revision: number, clusters: readonly EssenceClusterSnapshot[]): EssenceState => ({ ...scope, revision, clusters, transfers: [] });
const receipt: EssenceTransferReceipt = { ...scope, id: 't', status: 'committed', accessGroup: { kind: 'coop' }, playerId: 'p', lifeRevision: 1, participationRevision: 1, creditedValue: 0.15, returnedValue: 0, expiredValue: 0, resourceRevision: 3, completedAt: 50, sourceX: 10, sourceY: 20, targetX: 40, targetY: 30 };

describe('Essence delta/full stream', () => {
  it('heals a dropped delta only from a newer full, preserving fractions and rejecting stale tombstones', () => {
    const host = new AdrenalineEssenceReplication();
    const client = new AdrenalineEssenceClientReplica(scope);
    const first = host.build(state(1, [cluster]), 0)!;
    expect(client.apply(first)).toBe(true);
    const removed = host.build(state(2, []), 50)!; // lost
    const next = host.build(state(3, [{ ...cluster, value: 0.375 }]), 100)!;
    expect(client.apply(next)).toBe(false);
    expect(client.isAwaitingFull()).toBe(true);
    const full = host.build(state(3, [{ ...cluster, value: 0.375 }]), 1000)!;
    expect(client.apply(full)).toBe(true);
    expect(client.getState().clusters[0].value).toBe(0.375);
    expect(client.apply(removed)).toBe(false);
    expect(client.apply(first)).toBe(false);
    expect(client.getState().clusters).toHaveLength(1);
  });

  it('repeats terminal receipts for loss recovery but never replays them on full/JIP or twice', () => {
    const host = new AdrenalineEssenceReplication();
    const client = new AdrenalineEssenceClientReplica(scope);
    client.apply(host.build(state(0, []), 0));
    host.addReceipts([receipt]);
    const delta = host.build(state(1, []), 50)!;
    client.apply(delta);
    expect(client.drainReceipts()).toEqual([receipt]);
    client.apply(host.build(state(1, []), 100));
    expect(client.drainReceipts()).toEqual([]);
    const full = host.build(state(1, []), 150, true)!;
    const joining = new AdrenalineEssenceClientReplica(scope);
    joining.apply(full);
    joining.apply(host.build(state(1, []), 200));
    expect(joining.drainReceipts()).toEqual([]);
    expect(full.receipts).toEqual([]);
  });

  it('isolates Activity and World revisions and requires a full baseline', () => {
    const host = new AdrenalineEssenceReplication();
    const full = host.build(state(1, [cluster]), 0)!;
    const newer = new AdrenalineEssenceClientReplica({ ...scope, activityRevision: 3 });
    expect(newer.apply(full)).toBe(false);
    expect(newer.getState().clusters).toEqual([]);
    const client = new AdrenalineEssenceClientReplica(scope);
    expect(client.apply({ ...full, full: false })).toBe(false);
    expect(client.apply(full)).toBe(true);
    expect(client.apply({ ...full, revision: 2, worldRevision: 99 })).toBe(false);
  });

  it('sends each new terminal immediately, repeats at bounded cadence and emits no empty intermediate packet', () => {
    const host = new AdrenalineEssenceReplication();
    const empty = state(1, []);
    host.build(empty, 0);
    host.addReceipts([receipt]);
    expect(host.build(empty, receipt.completedAt)!.receipts).toEqual([receipt]);
    expect(host.build(empty, receipt.completedAt + ESSENCE_RECEIPT_REPEAT_MS - 1)).toBeNull();
    expect(host.build(empty, receipt.completedAt + ESSENCE_RECEIPT_REPEAT_MS)!.receipts).toEqual([receipt]);
    const fresh = { ...receipt, id: 'new-transfer', completedAt: receipt.completedAt + ESSENCE_RECEIPT_REPEAT_MS + 1 };
    host.addReceipts([fresh]);
    expect(host.build(empty, fresh.completedAt)!.receipts).toEqual([fresh]);
    expect(host.build(empty, fresh.completedAt + 1)).toBeNull();
  });

  it('does not consume a pending first terminal delivery when a full resync occurs', () => {
    const host = new AdrenalineEssenceReplication();
    const empty = state(1, []);
    host.build(empty, 0);
    host.addReceipts([receipt]);
    expect(host.build(empty, receipt.completedAt, true)!.receipts).toEqual([]);
    expect(host.build(empty, receipt.completedAt + 1)!.receipts).toEqual([receipt]);
  });
});
