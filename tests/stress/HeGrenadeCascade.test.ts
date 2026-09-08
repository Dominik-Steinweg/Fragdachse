import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({
  Math: { Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)) },
  Geom: { Line: class {}, Rectangle: class {}, Intersects: {} },
}));
import { createProjectileRuntimeTestWorld, projectilePhysicsContact } from '../ProjectileRuntimeTestHelper';
import { heEffect, heRequest, resolvedHe } from '../HeGrenadeTestHelper';

describe('fully upgraded HE burst stress', () => {
  it('resolves every primary and shard exactly once and releases the complete cascade', () => {
    const f = createProjectileRuntimeTestWorld();
    f.runtime.setProjectileTargetabilityPort({ canDamage: () => true, canDamageOwner: () => true,
      isTargetCurrentlyValid: () => true, getGrenadeContactRole: (_p, t) => t.kind === 'base' ? 'structure' : null });
    const detonations = new Set<number>();
    const config = resolvedHe();
    const count = config.charges!.maxCharges;
    let spawned = 0;
    for (let now = 0; now <= config.fuseTime + 1000; now += 10) {
      f.setHostNowMs(now);
      if (spawned < count && now >= spawned * config.charges!.burstLockoutMs) {
        const id = f.runtime.spawnProjectile(heRequest())!;
        f.physics.emit(projectilePhysicsContact(id, { kind: 'base', id: 'base' }));
        spawned++;
      }
      f.runtime.runHostInteractionStage(now);
      const stage = f.runtime.runHostProjectileStage(10, now);
      for (const request of stage.grenadePayloads) {
        expect(detonations.has(request.projectileId)).toBe(false);
        detonations.add(request.projectileId);
        f.runtime.completeGrenadeDetonation(request.projectileId);
      }
    }
    const perGrenade = 1 + heEffect().clusterCount! + config.fragmentation!.demolition.count;
    expect(spawned).toBe(4);
    expect(detonations.size).toBe(count * perGrenade);
    expect(f.physics.specs).toHaveLength(count * perGrenade);
    expect(f.physics.released).toHaveLength(count * perGrenade);
    expect(new Set(f.physics.released).size).toBe(count * perGrenade);
    expect(f.runtime.activeCount).toBe(0);
    f.runtime.destroy();
    expect(f.physics.releaseWorldState).toHaveBeenCalledTimes(1);
  });
});
