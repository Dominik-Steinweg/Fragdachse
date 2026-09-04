import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Geom: {
    Line: class {},
  },
}));

import { fakeEntity } from './fakeEntity';
import { DetonationSystem } from '../src/systems/DetonationSystem';
import type { DetonableConfig, TrackedProjectile } from '../src/types';
import type { ProjectileManager } from '../src/entities/ProjectileManager';

describe('projectile detonation characterization', () => {
  it('emits one attributed event for an externally detonated projectile', () => {
    const effect = {
      tag: 'asmd_ball',
      aoeDamage: 40,
      aoeRadius: 96,
      allowCrossTeam: true,
    } satisfies DetonableConfig;
    const projectile = fakeEntity({
      id: 7,
      ownerId: 'ball-owner',
      sourceId: 'weapon.asmd.secondary',
      sourceSlot: 'weapon2',
      x: 12,
      y: 34,
      detonable: effect,
    }) as unknown as TrackedProjectile;
    let active: TrackedProjectile | undefined = projectile;
    const destroyProjectile = vi.fn((id: number) => {
      if (id === projectile.id) active = undefined;
    });
    const projectileManager = {
      getProjectileById: (id: number) => id === active?.id ? active : undefined,
      destroyProjectile,
    } as unknown as ProjectileManager;
    const system = new DetonationSystem(projectileManager);

    expect(system.detonateProjectile(projectile.id, 'detonator')).toBe(true);
    expect(destroyProjectile).toHaveBeenCalledWith(projectile.id);
    expect(system.flushDetonations()).toEqual([{
      x: 12,
      y: 34,
      projectileOwnerId: 'ball-owner',
      detonatorOwnerId: 'detonator',
      effect,
      sourceId: 'weapon.asmd.secondary',
      sourceSlot: 'weapon2',
    }]);
    expect(system.flushDetonations()).toEqual([]);
    expect(system.detonateProjectile(projectile.id, 'detonator')).toBe(false);
  });
});
