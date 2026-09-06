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
  it('resends changed allegiance under the same identity after packet loss', () => {
    const records = [createRecord(1)];
    const adapter = new ProjectileReplicationAdapter({
      readProjectileReplication: sink => records.forEach(sink),
    });
    for (let tick = 0; tick < 10; tick++) adapter.getSnapshot(tick);
    records[0] = {
      ...records[0],
      static: { ...records[0].static, ownerId: 'reflector', ownerColor: 0x123456, sourceTurretId: 'turret-reflector' },
    };
    expect(decodeProjectileStatics(adapter.getSnapshot(10)!.s)).toMatchObject([{
      id: 1, ownerId: 'reflector', ownerColor: 0x123456, sourceTurretId: 'turret-reflector',
    }]);
    // The first redirect packet may be lost; the next tick heals the same ID.
    const healed = adapter.getSnapshot(11)!;
    expect(decodeProjectileStatics(healed.s)).toMatchObject([{
      id: 1, ownerId: 'reflector', ownerColor: 0x123456, sourceTurretId: 'turret-reflector',
    }]);
    expect(decodeProjectileDynamics(healed.u)).toMatchObject([{ id: 1 }]);
  });

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

  it('repeats the latest bounce outcome in dynamic snapshots so a lost packet can heal', () => {
    const records = [createRecord(1)];
    const adapter = new ProjectileReplicationAdapter({
      readProjectileReplication: (sink) => records.forEach(sink),
    });
    adapter.getSnapshot(0);
    records[0] = {
      ...records[0],
      dynamic: {
        ...records[0].dynamic,
        bounce: { sequence: 1, x: 12.5, y: 19.25, vx: -300, vy: -40, tracerBounce: true },
      },
    };

    const first = adapter.getSnapshot(1)!;
    const healed = adapter.getSnapshot(2)!;
    expect(decodeProjectileDynamics(first.u)[0]?.bounce).toEqual({
      sequence: 1, x: 12.5, y: 19.25, vx: -300, vy: -40, tracerBounce: true,
    });
    expect(decodeProjectileDynamics(healed.u)[0]?.bounce).toEqual({
      sequence: 1, x: 12.5, y: 19.25, vx: -300, vy: -40, tracerBounce: true,
    });
  });

  it('keeps a terminal bounce as a bounded tombstone after the source disappears', () => {
    let records = [createRecord(1)];
    const adapter = new ProjectileReplicationAdapter({
      readProjectileReplication: (sink) => records.forEach(sink),
    });
    const outcome = { sequence: 1, x: 12.5, y: 19.25, vx: -300, vy: -40, tracerBounce: true } as const;
    adapter.recordBouncePresentation({
      ...records[0],
      dynamic: { ...records[0].dynamic, bounce: outcome },
    });
    records = [];

    for (let tick = 0; tick < 4; tick++) {
      const snapshot = adapter.getSnapshot(tick)!;
      expect(decodeProjectileStatics(snapshot.s)).toMatchObject([{ id: 1 }]);
      expect(decodeProjectileDynamics(snapshot.u)[0]?.bounce).toEqual(outcome);
    }
    expect(adapter.getSnapshot(4)).toBeNull();
  });

  it('retains and repeats multiple outcomes in order until the projectile is gone', () => {
    const records = [createRecord(1)];
    const adapter = new ProjectileReplicationAdapter({
      readProjectileReplication: (sink) => records.forEach(sink),
    });
    const first = { sequence: 1, x: 12.5, y: 19.25, vx: -300, vy: -40, tracerBounce: true } as const;
    const second = { sequence: 2, x: 8.25, y: 18.5, vx: 300, vy: -40, tracerBounce: true } as const;
    adapter.recordBouncePresentation({ ...records[0], dynamic: { ...records[0].dynamic, bounce: first } });
    adapter.recordBouncePresentation({ ...records[0], dynamic: { ...records[0].dynamic, bounce: second } });

    const snapshot = adapter.getSnapshot(0)!;
    expect(decodeProjectileDynamics(snapshot.u)[0]?.bounceOutcomes).toEqual([first, second]);
    const repeated = adapter.getSnapshot(1)!;
    expect(decodeProjectileDynamics(repeated.u)[0]?.bounceOutcomes).toEqual([first, second]);
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
