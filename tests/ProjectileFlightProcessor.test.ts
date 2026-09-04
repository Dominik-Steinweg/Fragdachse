import { describe, expect, it, vi } from 'vitest';

import { ProjectileFlightProcessor } from '../src/projectile/ProjectileFlightProcessor';
import type { TrackedProjectile } from '../src/types';

function makeProjectile(overrides: Partial<TrackedProjectile> = {}): TrackedProjectile {
  const body = {
    velocity: { x: 100, y: 0 },
    setVelocity: vi.fn((x: number, y: number) => {
      body.velocity.x = x;
      body.velocity.y = y;
    }),
    setDrag: vi.fn(),
    setSize: vi.fn(),
    setOffset: vi.fn(),
    enable: true,
  };
  const sprite = {
    x: 0,
    y: 0,
    width: 4,
    displayWidth: 4,
    displayHeight: 4,
    setDisplaySize: vi.fn(),
  };
  return {
    id: 1,
    ownerId: 'owner',
    sprite,
    body,
    lastX: 0,
    lastY: 0,
    createdAt: 0,
    simulatedAgeMs: 0,
    timeBubbleFactor: 1,
    lifetime: 1_000,
    maxBounces: 0,
    bounceCount: 0,
    isGrenade: false,
    colliders: [],
    boundsListener: () => {},
    ...overrides,
  } as unknown as TrackedProjectile;
}

describe('ProjectileFlightProcessor', () => {
  it('advances simulated time with an explicit time-field sample', () => {
    const processor = new ProjectileFlightProcessor();
    const timeField = vi.fn(() => 0.5);
    processor.setTimeFieldPort({ getMovementFactor: timeField });
    const projectile = makeProjectile();

    processor.run([projectile], 100, 500);

    expect(timeField).toHaveBeenCalledWith(0, 0, 500, expect.objectContaining({ allegiance: { ownerId: 'owner' } }));
    expect(projectile.simulatedAgeMs).toBe(50);
    expect(projectile.timeBubbleFactor).toBe(0.5);
    expect(projectile.body.setVelocity).toHaveBeenCalledWith(50, 0);
  });

  it('keeps grenade fuse expiry on host time while slowing simulated age', () => {
    const processor = new ProjectileFlightProcessor();
    processor.setTimeFieldPort({ getMovementFactor: () => 0.1 });
    const projectile = makeProjectile({
      isGrenade: true,
      fuseTime: 300,
      lifetime: 300,
    });

    const result = processor.run([projectile], 1_000, 500);

    expect(projectile.simulatedAgeMs).toBe(100);
    expect(result.grenadeExpiredIds.has(projectile.id)).toBe(true);
  });

  it('reports lifetime expiry to the legacy outcome stage without resolving it itself', () => {
    const processor = new ProjectileFlightProcessor();
    const projectile = makeProjectile({ lifetime: 100 });

    const result = processor.run([projectile], 101, 101);

    expect(result.lifetimeExpiredIds.has(projectile.id)).toBe(true);
    expect(projectile.pendingDestroy).not.toBe(true);
  });
});
