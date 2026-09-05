import { describe, expect, it } from 'vitest';
import { ProjectileClientReplica } from '../src/projectile/ProjectileClientReplica';
import type { SyncedProjectile } from '../src/types';

function projectile(overrides: Partial<SyncedProjectile> = {}): SyncedProjectile {
  return {
    id: 1,
    ownerId: 'owner',
    x: 100,
    y: 200,
    vx: 100,
    vy: -40,
    size: 12,
    color: 0xffcc00,
    style: 'bullet',
    ...overrides,
  };
}

describe('ProjectileClientReplica', () => {
  it('keeps the receive anchor separate from extrapolated position and corrects on a new snapshot', () => {
    const replica = new ProjectileClientReplica();
    const first = replica.sync([projectile()], 1_000);
    expect(first.updates[0]?.isNew).toBe(true);

    const positions: Array<{ x: number; y: number }> = [];
    replica.readExtrapolated(1_500, ({ x, y }) => positions.push({ x, y }));
    expect(positions).toEqual([{ x: 150, y: 180 }]);

    const corrected = replica.sync([projectile({ x: 130, y: 240 })], 2_000);
    expect(corrected.updates[0]?.previous?.serverX).toBe(100);
    replica.readExtrapolated(2_001, ({ x, y }) => positions.push({ x, y }));
    expect(positions.at(-1)).toEqual({ x: 130.1, y: 239.96 });
  });

  it('matches decaying flame motion and retires absent IDs against stale packets', () => {
    const replica = new ProjectileClientReplica();
    replica.sync([projectile({ style: 'flame', velocityDecay: 0.25 })], 0);
    const extrapolated: Array<{ x: number; velocityX: number }> = [];
    replica.readExtrapolated(1_000, ({ x, velocityX }) => extrapolated.push({ x, velocityX }));
    expect(extrapolated[0]?.velocityX).toBeCloseTo(25);
    expect(extrapolated[0]?.x).toBeCloseTo(100 + 100 * (1 - 0.25) / -Math.log(0.25));

    const removed = replica.sync([], 2_000);
    expect(removed.removed.has(1)).toBe(true);
    expect(replica.sync([projectile({ x: 999 })], 3_000).updates).toHaveLength(0);
    expect(replica.size).toBe(0);
  });
});
