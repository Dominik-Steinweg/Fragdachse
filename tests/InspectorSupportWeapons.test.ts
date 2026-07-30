import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
  },
}));

import { LoadoutManager } from '../src/loadout/LoadoutManager';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { TurretChargeSystem } from '../src/systems/TurretChargeSystem';
import { REPAIR_BEAM_COLOR, TURRET_CHARGE_COLOR } from '../src/config';
import type { ProjectileTurretChargePayload } from '../src/types';

function createManagerWithSpawnSpy() {
  const spawnProjectile = vi.fn(() => 42);
  const manager = Object.create(LoadoutManager.prototype) as LoadoutManager;
  Object.defineProperty(manager, 'projectileManager', { value: { spawnProjectile } });
  return { manager, spawnProjectile };
}

describe('inspector support weapons', () => {
  it('fires the repair beam as a damage-free projectile carrying only a heal payload', () => {
    const { manager, spawnProjectile } = createManagerWithSpawnSpy();

    expect(manager.fireAutomatedWeapon(
      WEAPON_CONFIGS.REPARATURSTRAHL,
      100,
      200,
      0,
      500,
      200,
      'inspector',
      0x22cc88,
    )).toBe(true);

    const [, , , , projectile] = spawnProjectile.mock.calls[0];
    expect(projectile).toMatchObject({
      damage: 0,
      rockDamageMult: 0,
      trainDamageMult: 0,
      maxBounces: 0,
      projectileStyle: 'energy_ball',
      sourceSlot: 'weapon2',
      repairPayload: { amount: 25, color: REPAIR_BEAM_COLOR },
    });
    expect(projectile.explosion).toBeUndefined();
    expect(projectile.turretChargePayload).toBeUndefined();
  });

  it('fires the energy injector with turret-only homing and a charge payload', () => {
    const { manager, spawnProjectile } = createManagerWithSpawnSpy();

    manager.fireAutomatedWeapon(
      WEAPON_CONFIGS.ENERGIEINJEKTOR,
      0,
      0,
      0,
      400,
      0,
      'inspector',
      0xffffff,
    );

    const [, , , , projectile] = spawnProjectile.mock.calls[0];
    expect(projectile.damage).toBe(0);
    expect(projectile.homing?.targetTypes).toEqual(['turrets']);
    expect(projectile.repairPayload).toBeUndefined();
    expect(projectile.turretChargePayload).toMatchObject({
      durationMs: 3_000,
      damageMultiplierPerStack: 0.08,
      maxStacks: 8,
      color: TURRET_CHARGE_COLOR,
    });
  });
});

describe('turret charge system', () => {
  const payload: ProjectileTurretChargePayload = {
    durationMs: 1_000,
    damageMultiplierPerStack: 0.1,
    maxStacks: 3,
    color: TURRET_CHARGE_COLOR,
  };

  it('stacks up to the cap, refreshes the duration and only buffs damage', () => {
    const system = new TurretChargeSystem();

    system.applyCharge('7', 100, 100, 'inspector', payload, 0);
    system.applyCharge('7', 100, 100, 'inspector', payload, 200);
    const third = system.applyCharge('7', 100, 100, 'inspector', payload, 400);
    const fourth = system.applyCharge('7', 100, 100, 'inspector', payload, 600);

    expect(third.stacks).toBe(3);
    expect(fourth.stacks).toBe(3);
    // Startzeit bleibt der erste Treffer, das Ende schiebt jeder weitere Treffer nach hinten.
    expect(fourth.startedAt).toBe(0);
    expect(fourth.expiresAt).toBe(1_600);
    expect(system.getBuffAt(100, 100)).toEqual({ fireRateMultiplier: 1, damageMultiplier: 1.3 });
  });

  it('matches only the charged turret position and expires on time', () => {
    const system = new TurretChargeSystem();
    system.applyCharge('base:north', 300, 300, 'inspector', payload, 0);

    expect(system.getBuffAt(300, 300)).not.toBeNull();
    expect(system.getBuffAt(340, 300)).toBeNull();

    system.update(999);
    expect(system.getActiveCharges()).toHaveLength(1);
    system.update(1_000);
    expect(system.getActiveCharges()).toHaveLength(0);
    expect(system.getBuffAt(300, 300)).toBeNull();
  });
});
