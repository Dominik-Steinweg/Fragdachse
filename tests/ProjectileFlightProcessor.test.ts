import { describe, expect, it, vi } from 'vitest';

import { ProjectileFlightProcessor } from '../src/projectile/ProjectileFlightProcessor';
import { createSingleOwnerProvenance } from '../src/projectile/ProjectileSpawnRequest';
import type { ProjectileRuntimeRecord } from '../src/projectile/ProjectileRuntimeRecord';
import { advanceSpeedVariation, createSpeedVariation, CHARGED_BOLT_SPEED_VARIATION } from '../src/projectile/ProjectileSpeedVariation';

function makeProjectile(overrides: { isGrenade?: boolean; fuseTime?: number; lifetime?: number } = {}): ProjectileRuntimeRecord {
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
    provenance: createSingleOwnerProvenance('owner'),
    physics: { sprite, body },
    spec: {
      flight: {
        lifetimeMs: overrides.lifetime ?? 1_000, isGrenade: overrides.isGrenade ?? false,
        fuseTime: overrides.fuseTime, drag: {}, miniRocket: {}, hitboxGrowth: {},
      },
      interaction: { impulse: {} },
    },
    interaction: {},
    miniRocket: {},
    contacts: {},
    lastX: 0,
    lastY: 0,
    createdAt: 0,
    simulatedAgeMs: 0,
    timeBubbleFactor: 1,
    maxBounces: 0,
    bounceCount: 0,
  } as unknown as ProjectileRuntimeRecord;
}

describe('ProjectileFlightProcessor', () => {
  it('varies opted-in speed without changing direction, size or ordinary projectiles', () => {
    const processor = new ProjectileFlightProcessor();
    const bolt = makeProjectile();
    bolt.spec = { ...bolt.spec, flight: { ...bolt.spec.flight, speedVariation: 'charged_bolt' } };
    bolt.physics.body.setVelocity(60, 80);
    const ordinary = makeProjectile();
    processor.run([bolt, ordinary], 150, 150);
    const velocity = bolt.physics.body.velocity;
    expect(Math.hypot(velocity.x, velocity.y)).not.toBeCloseTo(100, 5);
    expect(velocity.x / velocity.y).toBeCloseTo(60 / 80, 10);
    expect(ordinary.physics.body.velocity.x).toBe(100);
    expect(bolt.physics.body.setSize).not.toHaveBeenCalled();

    // A reflection and external speed change must survive the next modulation step.
    const factor = bolt.speedVariation!.appliedFactor;
    bolt.physics.body.setVelocity(-velocity.x * 0.5, -velocity.y * 0.5);
    processor.run([bolt], 50, 200);
    expect(Math.hypot(velocity.x, velocity.y)).toBeCloseTo(50 * bolt.speedVariation!.appliedFactor, 8);
    expect(velocity.x).toBeLessThan(0);
    expect(factor).not.toBe(bolt.speedVariation!.appliedFactor);
  });

  it('advances speed variation in simulated time and composes with time-field slowdown', () => {
    const processor = new ProjectileFlightProcessor();
    let timeFactor = 0.5;
    processor.setTimeFieldPort({ getMovementFactor: () => timeFactor });
    const bolt = makeProjectile();
    bolt.spec = { ...bolt.spec, flight: { ...bolt.spec.flight, speedVariation: 'charged_bolt' } };
    const reference = createSpeedVariation(bolt.id);
    processor.run([bolt], 200, 200);
    expect(bolt.physics.body.velocity.x).toBeCloseTo(50 * advanceSpeedVariation(reference, 100), 10);
    timeFactor = 1;
    processor.run([bolt], 100, 300);
    expect(bolt.physics.body.velocity.x).toBeCloseTo(100 * advanceSpeedVariation(reference, 100), 10);
    timeFactor = 0;
    const beforeFreeze = { ...bolt.speedVariation! };
    processor.run([bolt], 500, 800);
    expect(bolt.speedVariation).toEqual(beforeFreeze);
    expect(bolt.physics.body.velocity.x).toBe(0);
  });

  it('advances simulated time with an explicit time-field sample', () => {
    const processor = new ProjectileFlightProcessor();
    const timeField = vi.fn(() => 0.5);
    processor.setTimeFieldPort({ getMovementFactor: timeField });
    const projectile = makeProjectile();

    processor.run([projectile], 100, 500);

    expect(timeField).toHaveBeenCalledWith(0, 0, 500);
    expect(projectile.simulatedAgeMs).toBe(50);
    expect(projectile.timeBubbleFactor).toBe(0.5);
    expect(projectile.physics.body.setVelocity).toHaveBeenCalledWith(50, 0);
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

  it('reports lifetime expiry to the lifecycle stage without resolving it itself', () => {
    const processor = new ProjectileFlightProcessor();
    const projectile = makeProjectile({ lifetime: 100 });

    const result = processor.run([projectile], 101, 101);

    expect(result.lifetimeExpiredIds.has(projectile.id)).toBe(true);
    expect(projectile.pendingDestroy).not.toBe(true);
  });
});

describe('charged bolt random tempo', () => {
  it('is continuous and independent of frame partitioning with different sequences per projectile', () => {
    const fine = createSpeedVariation(17);
    const coarse = createSpeedVariation(17);
    let previous = 1;
    for (let i = 0; i < 1500; i++) {
      const factor = advanceSpeedVariation(fine, 2);
      expect(Math.abs(factor - previous)).toBeLessThan(0.02);
      previous = factor;
    }
    expect(advanceSpeedVariation(coarse, 3000)).toBeCloseTo(previous, 10);
    expect(advanceSpeedVariation(createSpeedVariation(18), 3000)).not.toBeCloseTo(previous, 5);
  });

  it('stays bounded, fluctuates both ways and retains mean speed across short-lived projectiles', () => {
    let sum = 0, count = 0, below = 0, above = 0;
    const deviation = CHARGED_BOLT_SPEED_VARIATION.maxDeviation;
    for (let id = 1; id <= 500; id++) {
      const state = createSpeedVariation(id);
      for (let frame = 0; frame < 100; frame++) {
        const factor = advanceSpeedVariation(state, 16);
        expect(factor).toBeGreaterThanOrEqual(1 - deviation);
        expect(factor).toBeLessThanOrEqual(1 + deviation);
        if (factor < 0.9) below++;
        if (factor > 1.1) above++;
        sum += factor; count++;
      }
    }
    expect(below).toBeGreaterThan(count * 0.1);
    expect(above).toBeGreaterThan(count * 0.1);
    expect(sum / count).toBeGreaterThan(0.98);
    expect(sum / count).toBeLessThan(1.02);
  });
});
