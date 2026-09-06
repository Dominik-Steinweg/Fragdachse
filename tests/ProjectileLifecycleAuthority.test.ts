import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ Geom: { Line: class {}, Rectangle: class {} } }));

import { WorldProjectileRuntime } from '../src/projectile/WorldProjectileRuntime';
import { ProjectileIdentityScope } from '../src/projectile/ProjectileIdentityScope';
import { createSingleOwnerProvenance, type ProjectileSpawnRequest } from '../src/projectile/ProjectileSpawnRequest';
import { createPresentation, createTechnicalPhysicsBinding } from './ProjectileRuntimeTestHelper';

const explosion = { radius: 20, maxDamage: 10, minDamage: 5, knockback: 0, selfDamageMult: 0, damageTarget: 'enemies' as const };

function request(): ProjectileSpawnRequest {
  return {
    origin: { x: 0, y: 0, angle: 0 },
    flight: { speed: 100, size: 40, lifetimeMs: 1000, maxBounces: 0, isGrenade: false, collisionMode: 'overlap' },
    provenance: createSingleOwnerProvenance('owner'),
    interaction: { directHit: { damage: 6 }, explosion },
    presentation: { color: 0xffffff },
  };
}

function fixture() {
  const physics = createTechnicalPhysicsBinding();
  const runtime = new WorldProjectileRuntime({ physicsBinding: physics.binding,
    presentation: createPresentation(), identityScope: new ProjectileIdentityScope(1), hostNowMs: () => 0 });
  const wall = (id: number) => physics.emit({ projectileId: id, target: { kind: 'world-boundary' },
    x: 0, y: 0, velocityX: 100, velocityY: 0, source: 'world-boundary' });
  return { runtime, physics, wall };
}

describe('world-owned projectile lifecycle authority', () => {
  it('queues a terminal impact once and releases resources after producing the deferred request', () => {
    const { runtime, physics, wall } = fixture();
    const resolved = vi.fn();
    runtime.setProjectileResolvedCallback(resolved);
    const id = runtime.spawnProjectile(request())!;
    wall(id);
    wall(id);
    expect(runtime.activeCount).toBe(0);
    expect(physics.released).toHaveLength(0);
    const stage = runtime.runHostProjectileStage(0, 0);
    expect(stage.projectileExplosions).toMatchObject([{ projectileId: id, effect: explosion }]);
    expect(physics.released).toHaveLength(1);
    expect(resolved).toHaveBeenCalledOnce();
    expect(runtime.runHostProjectileStage(0, 0).projectileExplosions).toEqual([]);
  });

  it('resumes mini rockets only after the domain receipt and keeps coast deferral and cascade damage', () => {
    const { runtime, physics, wall } = fixture();
    const spawn = request();
    const id = runtime.spawnProjectile({ ...spawn,
      flight: { ...spawn.flight, miniRocket: { stageRangePx: 100, cascadeDamageBonusPerExplosion: 0.5 } },
      interaction: { ...spawn.interaction, multiExplosion: { count: 2, coastMs: 100 } },
    })!;
    wall(id);
    expect(physics.handles.get(id)!.body.enable).toBe(false);
    const first = runtime.runHostProjectileStage(0, 0).projectileExplosions;
    expect(first).toMatchObject([{ projectileId: id, continuation: { projectileId: id }, effect: explosion }]);
    expect(runtime.activeCount).toBe(1);
    runtime.completeProjectileExplosion(id, { damagedTargetKeys: ['enemies:aoe-only'] });
    expect(physics.handles.get(id)!.body.enable).toBe(true);
    expect(physics.handles.get(id)!.body.velocity.x).toBeCloseTo(80);
    wall(id);
    expect(physics.handles.get(id)!.body.enable).toBe(false);
    expect(runtime.runHostProjectileStage(99, 99).projectileExplosions).toEqual([]);
    // Finalization queues this explosion for the subsequent host's deferred domain stage.
    expect(runtime.runHostProjectileStage(1, 100).projectileExplosions).toEqual([]);
    const second = runtime.runHostProjectileStage(0, 100).projectileExplosions;
    expect(second).toMatchObject([{ effect: { radius: 30, maxDamage: 15, minDamage: 7.5 } }]);
    expect(runtime.activeCount).toBe(0);
    expect(physics.released).toHaveLength(1);
  });

  it('keeps grenade fuses on host time while flame lifetime follows the simulated clock', () => {
    const { runtime } = fixture();
    runtime.setProjectileTimeFieldPort({ getMovementFactor: () => 0.5 });
    const spawn = request();
    const payload = { type: 'damage' as const, radius: 30, damage: 20 };
    runtime.spawnProjectile({ ...spawn, flight: { ...spawn.flight, isGrenade: true, fuseTimeMs: 1000 },
      interaction: { grenadeEffect: payload } });
    const expiry = vi.fn();
    runtime.setNaturalFlameExpiryCallback(expiry);
    runtime.spawnProjectile({ ...spawn, flight: { ...spawn.flight, isFlame: true }, interaction: {} });
    expect(runtime.runHostProjectileStage(999, 999).grenadePayloads).toEqual([]);
    expect(runtime.runHostProjectileStage(1, 1000).grenadePayloads).toMatchObject([{ effect: payload }]);
    expect(expiry).not.toHaveBeenCalled();
    runtime.runHostProjectileStage(1001, 2001);
    expect(expiry).toHaveBeenCalledOnce();
    expect(runtime.activeCount).toBe(0);
  });

  it('drops pending deferred effects and all resources at world teardown', () => {
    const { runtime, physics, wall } = fixture();
    const resolved = vi.fn();
    runtime.setProjectileResolvedCallback(resolved);
    const id = runtime.spawnProjectile(request())!;
    wall(id);
    runtime.destroy();
    runtime.destroy();
    wall(id);
    expect(runtime.runHostProjectileStage(1000, 1000).projectileExplosions).toEqual([]);
    expect(physics.released).toHaveLength(1);
    expect(resolved).toHaveBeenCalledOnce();
    expect(resolved).toHaveBeenCalledWith(expect.objectContaining({ kind: 'resolved', projectileId: id }));
    expect(runtime.spawnProjectile(request())).toBeNull();
  });
});
