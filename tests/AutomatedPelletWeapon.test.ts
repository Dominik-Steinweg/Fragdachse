import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
  },
}));

import { LoadoutManager } from '../src/loadout/LoadoutManager';
import { ULTIMATE_CONFIGS, WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';

describe('automated projectile weapons', () => {
  it('forwards construction damage as owner-attributed utility damage', () => {
    const manager = Object.create(LoadoutManager.prototype) as LoadoutManager;
    const dispatchWeaponFire = vi.fn(() => true);
    Object.defineProperty(manager, 'dispatchWeaponFire', {
      value: dispatchWeaponFire,
    });

    expect(manager.fireAutomatedWeapon(
      WEAPON_CONFIGS.TURRET_ROCKET_BURST,
      100,
      200,
      0,
      400,
      200,
      'player-owner',
      0xff8a3d,
      { sourceSlot: 'utility', ignoreRockIndex: 7 },
    )).toBe(true);

    expect(dispatchWeaponFire).toHaveBeenCalledOnce();
    expect(dispatchWeaponFire.mock.calls[0][6]).toBe('player-owner');
    expect(dispatchWeaponFire.mock.calls[0][8]).toBe('utility');
    expect(dispatchWeaponFire.mock.calls[0][10]).toMatchObject({ ignoreRockIndex: 7 });
  });

  it('passes turret support collision filters into the spawned projectile', () => {
    const manager = Object.create(LoadoutManager.prototype) as LoadoutManager;
    const spawnProjectile = vi.fn(() => 42);
    Object.defineProperty(manager, 'projectileManager', { value: { spawnProjectile } });

    manager.fireAutomatedWeapon(
      WEAPON_CONFIGS.TURRET_ROCKET_BURST,
      100, 200, 0, 400, 200, 'player-owner', 0xff8a3d,
      { ignoreBaseCollisions: true, ignoreRockIndex: 7, sourceTurretId: '7' },
    );

    expect(spawnProjectile.mock.calls[0]?.[4]).toMatchObject({
      ignoreBaseCollisions: true,
      ignoreRockIndex: 7,
      sourceTurretId: '7',
    });
  });

  it('applies one shared tower multiplier to direct, explosive, cloud and burn damage', () => {
    const manager = Object.create(LoadoutManager.prototype) as LoadoutManager;
    const dispatchWeaponFire = vi.fn(() => true);
    Object.defineProperty(manager, 'dispatchWeaponFire', { value: dispatchWeaponFire });

    manager.fireAutomatedWeapon(
      WEAPON_CONFIGS.TURRET_ROCKET_BURST,
      0, 0, 0, 100, 0, 'owner', 0xffffff,
      { directDamageMultiplier: 1.25, payloadDamageMultiplier: 2.5, sourceSlot: 'utility' },
    );
    const rocket = dispatchWeaponFire.mock.calls[0][0];
    expect(rocket.damage).toBeCloseTo(WEAPON_CONFIGS.TURRET_ROCKET_BURST.damage * 1.25, 10);
    expect(rocket.fire.impactExplosion.maxDamage).toBeCloseTo(
      WEAPON_CONFIGS.TURRET_ROCKET_BURST.fire.type === 'projectile'
        ? (WEAPON_CONFIGS.TURRET_ROCKET_BURST.fire.impactExplosion?.maxDamage ?? 0) * 2.5
        : 0,
      10,
    );

    dispatchWeaponFire.mockClear();
    manager.fireAutomatedWeapon(
      WEAPON_CONFIGS.SPOREN,
      0, 0, 0, 100, 0, 'owner', 0xffffff,
      { directDamageMultiplier: 1.25, payloadDamageMultiplier: 2.5, sourceSlot: 'utility' },
    );
    const spores = dispatchWeaponFire.mock.calls[0][0];
    expect(spores.fire.impactCloud.damagePerTick).toBeCloseTo(
      WEAPON_CONFIGS.SPOREN.fire.type === 'projectile'
        ? (WEAPON_CONFIGS.SPOREN.fire.impactCloud?.damagePerTick ?? 0) * 2.5
        : 0,
      10,
    );

    dispatchWeaponFire.mockClear();
    manager.fireAutomatedWeapon(
      WEAPON_CONFIGS.TURRET_FLAME,
      0, 0, 0, 100, 0, 'owner', 0xffffff,
      { directDamageMultiplier: 1.25, payloadDamageMultiplier: 2.5, sourceSlot: 'utility' },
    );
    const flame = dispatchWeaponFire.mock.calls[0][0];
    expect(flame.fire.burnDamagePerTick).toBeCloseTo(
      WEAPON_CONFIGS.TURRET_FLAME.fire.type === 'flamethrower'
        ? WEAPON_CONFIGS.TURRET_FLAME.fire.burnDamagePerTick * 2.5
        : 0,
      10,
    );
  });

  it('dispatches the Void Hunter shotgun as five spread pellets with one shared shot sound', () => {
    const manager = Object.create(LoadoutManager.prototype) as LoadoutManager;
    const dispatchWeaponFire = vi.fn(() => true);
    Object.defineProperty(manager, 'dispatchWeaponFire', {
      value: dispatchWeaponFire,
    });

    expect(manager.fireAutomatedWeapon(
      WEAPON_CONFIGS.VOID_HUNTER_SHOTGUN,
      100,
      200,
      0,
      400,
      200,
      'void-hunter',
      0xaa55ff,
    )).toBe(true);

    expect(dispatchWeaponFire).toHaveBeenCalledTimes(5);
    const anglesInDegrees = dispatchWeaponFire.mock.calls.map(
      (call) => (call[3] as number) * 180 / Math.PI,
    );
    expect(anglesInDegrees).toEqual([-12, -6, 0, 6, 12]);
    expect(dispatchWeaponFire.mock.calls[0][0].shotAudio).toBeDefined();
    for (const call of dispatchWeaponFire.mock.calls.slice(1)) {
      expect(call[0].shotAudio).toBeUndefined();
    }
  });

  it('fires the Void Hunter Gauss variant with its legacy projectile values and Gauss style', () => {
    const manager = Object.create(LoadoutManager.prototype) as LoadoutManager;
    const spawnProjectile = vi.fn(() => 42);
    Object.defineProperty(manager, 'projectileManager', {
      value: { spawnProjectile },
    });
    const config = ULTIMATE_CONFIGS.VOID_HUNTER_GAUSS;
    if (config.type !== 'gauss') throw new Error('Testkonfiguration muss Gauss sein');

    expect(manager.fireAutomatedGaussWeapon(
      config,
      100,
      200,
      0,
      'void-hunter',
      0xaa55ff,
    )).toBe(true);

    const [, , , , projectile] = spawnProjectile.mock.calls[0];
    expect(projectile).toMatchObject({
      speed: 1350,
      size: 16,
      damage: 200,
      color: 0xb347ff,
      projectileStyle: 'gauss',
      projectileVisualScale: 1.25,
      maxBounces: 0,
      remainingRangePx: 1500,
      rockDamageMult: 1,
      trainDamageMult: 1,
    });
  });
});
