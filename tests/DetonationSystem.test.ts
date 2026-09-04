import { describe, expect, it, vi } from 'vitest';

import { DetonationSystem } from '../src/systems/DetonationSystem';
import type { DetonableConfig } from '../src/types';
import type { ProjectileExternalInteractionPort } from '../src/projectile/ProjectileExternalInteractionPort';

describe('projectile detonation characterization', () => {
  it('emits one attributed event for an externally detonated projectile', () => {
    const effect = {
      tag: 'asmd_ball',
      aoeDamage: 40,
      aoeRadius: 96,
      allowCrossTeam: true,
    } satisfies DetonableConfig;
    const detonateProjectile = vi.fn((id: number, detonatorOwnerId: string) => id === 7
      ? {
        id,
        x: 12,
        y: 34,
        projectileOwnerId: 'ball-owner',
        detonatorOwnerId,
        effect,
        sourceId: 'weapon.asmd.secondary',
        sourceSlot: 'weapon2' as const,
      }
      : null);
    const projectileInteraction: ProjectileExternalInteractionPort = {
      searchDetonableProjectiles: () => [],
      detonateProjectile,
      detonateOverlappingProjectiles: () => [],
    };
    const system = new DetonationSystem(projectileInteraction);

    expect(system.detonateProjectile(7, 'detonator')).toBe(true);
    expect(detonateProjectile).toHaveBeenCalledWith(7, 'detonator');
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
    expect(system.detonateProjectile(8, 'detonator')).toBe(false);
  });
});
