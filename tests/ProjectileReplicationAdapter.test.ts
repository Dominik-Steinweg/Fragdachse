import { describe, expect, it } from 'vitest';
import { decodeProjectileDynamics, decodeProjectileStatics } from '../src/network/projectileSnapshotCodec';
import {
  ProjectileReplicationAdapter,
  type ProjectileReplicationRecord,
} from '../src/projectile/ProjectileReplicationAdapter';

function createRecord(id: number, createdAt = 0): ProjectileReplicationRecord {
  return {
    id,
    createdAt,
    static: {
      id,
      ownerId: `owner-${id}`,
      color: 0x100000 + id,
      style: 'rocket',
    },
    dynamic: {
      id,
      x: id * 10,
      y: id * 20,
      vx: 300,
      vy: -40,
      size: 12,
    },
  };
}

describe('ProjectileReplicationAdapter', () => {
  it('keeps dynamic updates complete while static data is resent only for healing', () => {
    const records = [createRecord(1)];
    const adapter = new ProjectileReplicationAdapter({
      readProjectileReplication: (sink) => records.forEach(sink),
    });

    expect(adapter.getSnapshot(0)?.s.length).toBeGreaterThan(0);
    expect(adapter.getSnapshot(1)?.s.length).toBeGreaterThan(0);
    expect(adapter.getSnapshot(2)?.s.length).toBeGreaterThan(0);
    const steady = adapter.getSnapshot(3);
    expect(steady?.s).toEqual([]);
    expect(decodeProjectileDynamics(steady?.u ?? [])).toMatchObject([{ id: 1, x: 10, y: 20 }]);
  });

  it('refreshes long-lived statics, supports full snapshots, and removes absent IDs', () => {
    const records = [createRecord(1), createRecord(2)];
    const adapter = new ProjectileReplicationAdapter({
      readProjectileReplication: (sink) => records.forEach(sink),
    });

    adapter.getSnapshot(0);
    adapter.getSnapshot(1);
    adapter.getSnapshot(2);
    expect(decodeProjectileStatics(adapter.getSnapshot(1_000)?.s ?? [])).toHaveLength(1);

    adapter.requestFullSnapshot();
    const full = adapter.getSnapshot(1_001);
    expect(full).toMatchObject({ f: 1 });
    expect(decodeProjectileStatics(full?.s ?? []).map((entry) => entry.id)).toEqual([1, 2]);

    records.splice(0, 1);
    const removal = adapter.getSnapshot(1_002);
    expect(decodeProjectileDynamics(removal?.u ?? []).map((entry) => entry.id)).toEqual([2]);

    records.length = 0;
    expect(adapter.getSnapshot(1_003)).toBeNull();
    adapter.requestFullSnapshot();
    expect(adapter.getSnapshot(1_004)).toEqual({ s: [], u: [], f: 1 });
  });
});
