import { describe, expect, it, vi } from 'vitest';

import { ProjectileHomingController } from '../src/entities/ProjectileHomingController';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import type { ProjectileHomingConfig, HomingRuntimeState } from '../src/types';
import type { ProjectileHomingRequest } from '../src/entities/ProjectileHomingController';
import { zeusRef } from './ZeusTestHelper';

function makeProjectile(config: ProjectileHomingConfig): ProjectileHomingRequest {
  const velocity = {
    x: 100,
    y: 0,
  };
  const state: HomingRuntimeState = { lockedTargetId: null };
  return {
    ownerId: 'player-1',
    homing: config,
    state,
    kinematics: {
      get x() { return 0; },
      get y() { return 0; },
      get velocityX() { return velocity.x; },
      get velocityY() { return velocity.y; },
      setVelocity: (x: number, y: number) => {
        velocity.x = x;
        velocity.y = y;
      },
    },
  };
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
  it('permanently excludes the origin incarnation, but permits a successor with the same id', () => {
    const controller = new ProjectileHomingController();
    let original = true;
    controller.setTargetabilityPort({ isTargetCurrentlyValid: () => true, isCurrentTargetInstance: () => original });
    controller.setTargetQueryPort({ queryTargets: (_c, _owner, _x, _y, _r, emit) => emit('origin', 'enemies', 50, 0) });
    const projectile = { ...makeProjectile({ ...BASE_HOMING, requireLineOfSight: false, targetTypes: ['enemies'] }),
      excludedTarget: zeusRef('origin') };
    expect(controller.update(projectile, 0, true, 0)).toBe(false);
    expect(controller.update(projectile, 10_000, true, 10_000)).toBe(false);
    original = false;
    expect(controller.update(projectile, 10_001, true, 10_001)).toBe(true);
    expect(projectile.state.lockedTargetId).toBe('origin');
  });
  it('excludes the origin circle including its edge, reacquires moving targets and expires in host time', () => {
    const controller = new ProjectileHomingController();
    let x = 150;
    controller.setTargetQueryPort({ queryTargets: (_c, _owner, _x, _y, _r, emit) => {
      emit('moving', 'enemies', x, 0);
      emit('edge', 'enemies', 110, 0);
      emit('inside', 'enemies', 10, 0);
    } });
    const projectile: ProjectileHomingRequest = {
      ...makeProjectile({ ...BASE_HOMING, targetTypes: ['enemies'] }),
      excludedCircle: { x: 10, y: 0, radius: 100, expiresAt: 1000 },
    };
    expect(controller.update(projectile, 100, true, 100)).toBe(true);
    expect(projectile.state.lockedTargetId).toBe('moving');
    x = 50;
    expect(controller.update(projectile, 101, true, 900)).toBe(false);
    expect(projectile.state.lockedTargetId).toBeNull();
    x = 110.01;
    expect(controller.update(projectile, 102, true, 999)).toBe(true);
    expect(projectile.state.lockedTargetId).toBe('moving');
    x = 400;
    // Only host time advances: slowing a projectile cannot extend its bubble exclusion.
    expect(controller.update(projectile, 102, true, 1000)).toBe(true);
    expect(projectile.state.lockedTargetId).toBe('inside');
  });

  it('does not apply a circle exclusion to ordinary homing projectiles', () => {
    const controller = new ProjectileHomingController();
    controller.setTargetQueryPort({ queryTargets: (_c, _owner, _x, _y, _r, emit) => emit('near', 'enemies', 5, 0) });
    const projectile = makeProjectile({ ...BASE_HOMING, targetTypes: ['enemies'] });
    expect(controller.update(projectile, 0, true, 100)).toBe(true);
    expect(projectile.state.lockedTargetId).toBe('near');
  });
  it('keeps smoke bolts ballistic until acquisition, favors forward targets and later permits the origin', () => {
    const controller = new ProjectileHomingController();
    let originOnly = false;
    controller.setTargetQueryPort({ queryTargets: (_config, _owner, _x, _y, _r, emit) => {
      emit('origin', 'enemies', 5, 0);
      if (!originOnly) { emit('behind', 'enemies', -20, 0); emit('ahead', 'enemies', 150, 20); }
    } });
    controller.setLineOfFireReadPort({ hasClearLineOfFire: () => true });
    const projectile = { ...makeProjectile({ ...BASE_HOMING, targetTypes: ['enemies'], acquireDelayMs: 200,
      distanceWeight: 1, forwardWeight: 1.4, maxTurnDegreesPerStep: 4 }),
      initialTargetProtection: { targetId: 'origin', durationMs: 300 } };
    expect(controller.update(projectile, 199)).toBe(false);
    expect(projectile.kinematics.velocityY).toBe(0);
    expect(controller.update(projectile, 200)).toBe(true);
    expect(projectile.state.lockedTargetId).toBe('ahead');
    expect(projectile.kinematics.velocityY).toBeGreaterThan(0);
    originOnly = true;
    expect(controller.update(projectile, 250, true)).toBe(false);
    expect(controller.update(projectile, 300, true)).toBe(true);
    expect(projectile.state.lockedTargetId).toBe('origin');
  });
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
    controller.setTargetQueryPort({ queryTargets: (_config, _ownerId, _x, _y, _radius, emit) => {
      emit('hostile-base', 'bases', 100, 0);
    } });
    controller.setLineOfFireReadPort({ hasClearLineOfFire: () => true });

    const projectile = makeProjectile(BASE_HOMING);
    expect(controller.update(projectile, 0, true)).toBe(true);
    expect(projectile.state.lockedTargetId).toBe('hostile-base');
    expect(projectile.state.lockedTargetType).toBe('bases');
  });

  it('does not lock a base behind an obstacle', () => {
    const controller = new ProjectileHomingController();
    const lineOfFire = vi.fn(() => false);
    controller.setTargetQueryPort({ queryTargets: (_config, _ownerId, _x, _y, _radius, emit) => {
      emit('hostile-base', 'bases', 100, 0);
    } });
    controller.setLineOfFireReadPort({ hasClearLineOfFire: lineOfFire });

    const projectile = makeProjectile(BASE_HOMING);
    expect(controller.update(projectile, 0, true)).toBe(false);
    expect(projectile.state.lockedTargetId).toBeNull();
    expect(lineOfFire).toHaveBeenCalledWith(0, 0, 100, 0);
  });

  it('filters stealthed reacquire candidates while keeping decoys valid', () => {
    const controller = new ProjectileHomingController();
    let stealthed = false;
    controller.setTargetQueryPort({ queryTargets: (_config, _ownerId, _x, _y, _radius, emit) => {
      emit('player-2', 'players', 120, 0);
      emit('decoy-7', 'decoys', 180, 0);
    } });
    controller.setLineOfFireReadPort({ hasClearLineOfFire: () => true });
    controller.setTargetabilityPort({ isTargetCurrentlyValid: (id, type) => (
      type === 'decoys' || id !== 'player-2' || !stealthed
    ) });

    const projectile = makeProjectile({
      ...BASE_HOMING,
      targetTypes: ['players', 'decoys'],
    });
    expect(controller.update(projectile, 0, true)).toBe(true);
    expect(projectile.state.lockedTargetId).toBe('player-2');
    expect(projectile.state.lockedTargetType).toBe('players');

    stealthed = true;
    expect(controller.update(projectile, 1)).toBe(true);
    expect(projectile.state.lockedTargetId).toBe('decoy-7');
    expect(projectile.state.lockedTargetType).toBe('decoys');
  });
});
