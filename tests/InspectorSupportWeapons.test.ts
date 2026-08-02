import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
  },
}));

import { LoadoutManager } from '../src/loadout/LoadoutManager';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { ENERGY_INJECTOR_COLOR, PLASMA_BURNER_COLOR } from '../src/config';
import { EnergyInjectorSystem } from '../src/systems/EnergyInjectorSystem';

function createManagerWithSpawnSpy() {
  const spawnProjectile = vi.fn(() => 42);
  const resolveHitscanShot = vi.fn(() => true);
  const manager = Object.create(LoadoutManager.prototype) as LoadoutManager;
  Object.defineProperty(manager, 'projectileManager', { value: { spawnProjectile } });
  Object.defineProperty(manager, 'combatSystem', { value: { resolveHitscanShot } });
  return { manager, spawnProjectile, resolveHitscanShot };
}

describe('inspector support weapons', () => {
  it('fires the Plasmabrenner as a continuous, context-sensitive hitscan', () => {
    const { manager, spawnProjectile, resolveHitscanShot } = createManagerWithSpawnSpy();

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

    expect(spawnProjectile).not.toHaveBeenCalled();
    expect(WEAPON_CONFIGS.REPARATURSTRAHL.displayName).toBe('Plasmabrenner');
    expect(WEAPON_CONFIGS.REPARATURSTRAHL.cooldown).toBe(160);
    expect(WEAPON_CONFIGS.REPARATURSTRAHL.fire).toMatchObject({
      type: 'hitscan',
      traceThickness: 5,
      visualPreset: 'plasma_burner',
      supportEffect: {
        type: 'plasma_burner',
        healPerHit: 25,
        damagePerHit: 25,
        beamColor: PLASMA_BURNER_COLOR,
      },
    });
    const call = resolveHitscanShot.mock.calls[0];
    expect(call?.[4]).toBe(420);
    expect(call?.[5]).toBe(0);
    expect(call?.[6]).toBe(5);
    expect(call?.[9]).toBe('Plasmabrenner');
    expect(call?.[19]).toEqual({
      type: 'plasma_burner',
      healPerHit: 25,
      damagePerHit: 25,
      beamColor: PLASMA_BURNER_COLOR,
    });
  });

  it('fires the energy injector as a precise non-homing projectile', () => {
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
    expect(projectile.homing).toBeUndefined();
    expect(projectile.energyInjectorPayload).toMatchObject({
      durationMs: 7_000,
      focusDurationMs: 7_000,
      vulnerabilityBonus: 0.2,
      color: ENERGY_INJECTOR_COLOR,
    });
  });
});

describe('energy injector target state', () => {
  const payload = {
    durationMs: 7_000,
    focusDurationMs: 7_000,
    vulnerabilityBonus: 0.2,
    color: ENERGY_INJECTOR_COLOR,
  } as const;

  it('replaces a construction effect instead of stacking it', () => {
    const system = new EnergyInjectorSystem();
    system.applyConstructionEffect('7', 'inspector', 100, 100, { type: 'damage_turret', damageMultiplier: 1.25 }, payload, 0);
    system.applyConstructionEffect('7', 'inspector', 100, 100, { type: 'damage_turret', damageMultiplier: 1.5 }, payload, 200);

    expect(system.getActiveEffects()).toHaveLength(1);
    expect(system.getEffect('7', 200)?.effect).toEqual({ type: 'damage_turret', damageMultiplier: 1.5 });
    expect(system.getTurretDamageMultiplierAt(100, 100, 200)).toBe(1.5);
  });

  it('keeps one focus target per Inspector and refreshes it on a new target', () => {
    const system = new EnergyInjectorSystem();
    system.setFocusTarget('inspector', { targetType: 'enemy', targetId: 'a' }, 7_000, 0);
    system.setFocusTarget('inspector', { targetType: 'base', targetId: 'base:red' }, 7_000, 200);

    expect(system.getNetFocusSnapshot(200)).toEqual([{
      ownerId: 'inspector',
      targetType: 'base',
      targetId: 'base:red',
      startedAt: 200,
      expiresAt: 7_200,
    }]);
  });
});
