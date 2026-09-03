import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
  },
}));

import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { ENERGY_INJECTOR_COLOR, getTopDownMuzzleOrigin, PLASMA_BURNER_COLOR } from '../src/config';
import { EnergyInjectorSystem } from '../src/systems/EnergyInjectorSystem';
import { getLoadoutItemName } from '../src/i18n/contentPresentation';
import { WorldWeaponExecutionRuntime } from '../src/world/WorldWeaponExecutionRuntime';
import { AutomatedWeaponExecutionAdapter } from '../src/world/AutomatedWeaponExecutionAdapter';

function createManagerWithSpawnSpy() {
  const spawnProjectile = vi.fn(() => 42);
  const resolveHitscanShot = vi.fn(() => true);
  const resolveMeleeSwing = vi.fn(() => true);
  const sharedExecution = new WorldWeaponExecutionRuntime({
    projectileManager: { spawnProjectile },
    combatSystem: { resolveHitscanShot, resolveMeleeSwing },
  });
  const adapter = new AutomatedWeaponExecutionAdapter(sharedExecution, { spawnProjectile });
  return { adapter, spawnProjectile, resolveHitscanShot };
}

describe('inspector support weapons', () => {
  it('fires the Plasmabrenner as a continuous, context-sensitive hitscan', () => {
    const { adapter, spawnProjectile, resolveHitscanShot } = createManagerWithSpawnSpy();
    const productionConfig = WEAPON_CONFIGS.PLASMA_BURNER;

    expect(getLoadoutItemName(productionConfig.id, 'de')).toBe('Plasmabrenner');
    expect(productionConfig.shotAudio).toMatchObject({ failureKey: 'shot_dry_trigger' });
    expect(productionConfig.fire).toMatchObject({
      type: 'hitscan',
      visualPreset: 'plasma_burner',
      supportEffect: {
        type: 'plasma_burner',
        beamColor: PLASMA_BURNER_COLOR,
      },
    });
    if (productionConfig.fire.type !== 'hitscan') {
      throw new Error('Der Plasmabrenner muss eine Hitscan-Waffe sein');
    }

    const supportEffect = {
      type: 'plasma_burner' as const,
      healPerHit: 3,
      damagePerHit: 7,
      beamColor: 0x123456,
    };
    const testConfig = {
      ...productionConfig,
      range: 123,
      damage: 11,
      adrenalinGain: 5,
      fire: {
        ...productionConfig.fire,
        traceThickness: 9,
        supportEffect,
      },
    };

    expect(adapter.fire(
      testConfig,
      {
        x: 100, y: 200, angle: 0, targetX: 500, targetY: 200,
        ownerId: 'inspector', ownerColor: 0x22cc88,
      },
    )).toBe(true);

    expect(spawnProjectile).not.toHaveBeenCalled();
    const call = resolveHitscanShot.mock.calls[0];
    expect(call?.[4]).toBe(testConfig.range);
    expect(call?.[5]).toBe(testConfig.damage);
    expect(call?.[6]).toBe(testConfig.fire.traceThickness);
    expect(call?.[8]).toBe(testConfig.adrenalinGain);
    expect(call?.[9]).toBe(testConfig.id);
    expect(call?.[10]).toBe(testConfig.fire.visualPreset);
    expect(call?.[19]).toEqual(supportEffect);
  });

  it('limits the Plasmabrenner trace to the cursor while retaining its maximum range', () => {
    const { adapter, resolveHitscanShot } = createManagerWithSpawnSpy();
    const config = WEAPON_CONFIGS.PLASMA_BURNER;
    const startX = 100;
    const startY = 200;
    const angle = 0;
    const muzzle = getTopDownMuzzleOrigin(startX, startY, angle);
    const cursorX = muzzle.x + 80;

    const secondAdapter = new AutomatedWeaponExecutionAdapter(
      new WorldWeaponExecutionRuntime({
        projectileManager: { spawnProjectile: vi.fn() },
        combatSystem: { resolveHitscanShot, resolveMeleeSwing: vi.fn(() => true) },
      }),
      { spawnProjectile: vi.fn() },
    );

    adapter.fire(config, {
      x: startX, y: startY, angle, targetX: cursorX, targetY: startY,
      ownerId: 'inspector', ownerColor: 0x22cc88,
    });
    expect(resolveHitscanShot.mock.calls[0]?.[4]).toBeCloseTo(cursorX - muzzle.x, 10);

    secondAdapter.fire(
      config,
      {
        x: startX, y: startY, angle, targetX: muzzle.x + config.range + 200, targetY: startY,
        ownerId: 'inspector', ownerColor: 0x22cc88,
      },
    );
    expect(resolveHitscanShot.mock.calls[1]?.[4]).toBe(config.range);
  });

  it('fires the energy injector as a precise non-homing projectile', () => {
    const { adapter, spawnProjectile } = createManagerWithSpawnSpy();

    adapter.fire(
      WEAPON_CONFIGS.ENERGY_INJECTOR,
      { x: 0, y: 0, angle: 0, targetX: 400, targetY: 0, ownerId: 'inspector', ownerColor: 0xffffff },
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
