import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
  },
}));

import { LoadoutManager } from '../src/loadout/LoadoutManager';
import { ULTIMATE_CONFIGS, WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';

describe('automated projectile weapons', () => {
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
