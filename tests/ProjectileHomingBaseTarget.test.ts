import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    DegToRad: (degrees: number) => degrees * Math.PI / 180,
    Angle: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1),
      Wrap: (angle: number) => {
        while (angle > Math.PI) angle -= Math.PI * 2;
        while (angle < -Math.PI) angle += Math.PI * 2;
        return angle;
      },
    },
  },
}));

import { ProjectileHomingController } from '../src/entities/ProjectileHomingController';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import type { ProjectileHomingConfig, TrackedProjectile } from '../src/types';

function makeProjectile(config: ProjectileHomingConfig): TrackedProjectile {
  const velocity = {
    x: 100,
    y: 0,
    length: () => Math.hypot(velocity.x, velocity.y),
  };
  return {
    ownerId: 'player-1',
    sprite: { x: 0, y: 0 },
    body: {
      velocity,
      setVelocity: (x: number, y: number) => {
        velocity.x = x;
        velocity.y = y;
      },
    },
    homing: config,
    lockedTargetId: null,
  } as unknown as TrackedProjectile;
}

const BASE_HOMING: ProjectileHomingConfig = {
  acquireDelayMs: 0,
  searchRadius: 300,
  retargetIntervalMs: 1,
  maxTurnDegreesPerStep: 90,
  targetTypes: ['bases'],
  requireLineOfSight: true,
};

describe('projectile homing against hostile bases', () => {
  it('enables bases for the player-selectable homing weapons', () => {
    for (const weaponId of ['PLASMA', 'MINI_ROCKET_LAUNCHER', 'P90'] as const) {
      const weapon = WEAPON_CONFIGS[weaponId];
      expect(weapon.fire.type).toBe('projectile');
      if (weapon.fire.type !== 'projectile') continue;
      expect(weapon.fire.homing?.targetTypes).toContain('bases');
    }
  });

  it('locks the nearest base surface candidate when the shot line is clear', () => {
    const controller = new ProjectileHomingController();
    controller.setTargetProvider((_config, _ownerId, _x, _y, _radius, emit) => {
      emit('hostile-base', 'bases', 100, 0);
    });
    controller.setLineOfFireChecker(() => true);

    const projectile = makeProjectile(BASE_HOMING);
    expect(controller.update(projectile, 0, true)).toBe(true);
    expect(projectile.lockedTargetId).toBe('hostile-base');
    expect(projectile.lockedTargetType).toBe('bases');
  });

  it('does not lock a base behind an obstacle', () => {
    const controller = new ProjectileHomingController();
    const lineOfFire = vi.fn(() => false);
    controller.setTargetProvider((_config, _ownerId, _x, _y, _radius, emit) => {
      emit('hostile-base', 'bases', 100, 0);
    });
    controller.setLineOfFireChecker(lineOfFire);

    const projectile = makeProjectile(BASE_HOMING);
    expect(controller.update(projectile, 0, true)).toBe(false);
    expect(projectile.lockedTargetId).toBeNull();
    expect(lineOfFire).toHaveBeenCalledWith(0, 0, 100, 0);
  });

  it('filters stealthed reacquire candidates while keeping decoys valid', () => {
    const controller = new ProjectileHomingController();
    let stealthed = false;
    controller.setTargetProvider((_config, _ownerId, _x, _y, _radius, emit) => {
      emit('player-2', 'players', 120, 0);
      emit('decoy-7', 'decoys', 180, 0);
    });
    controller.setLineOfFireChecker(() => true);
    controller.setTargetValidityChecker((id, type) => (
      type === 'decoys' || id !== 'player-2' || !stealthed
    ));

    const projectile = makeProjectile({
      ...BASE_HOMING,
      targetTypes: ['players', 'decoys'],
    });
    expect(controller.update(projectile, 0, true)).toBe(true);
    expect(projectile.lockedTargetId).toBe('player-2');
    expect(projectile.lockedTargetType).toBe('players');

    stealthed = true;
    expect(controller.update(projectile, 1)).toBe(true);
    expect(projectile.lockedTargetId).toBe('decoy-7');
    expect(projectile.lockedTargetType).toBe('decoys');
  });
});
