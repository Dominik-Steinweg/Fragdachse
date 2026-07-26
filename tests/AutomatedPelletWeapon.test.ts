import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
  },
}));

import { LoadoutManager } from '../src/loadout/LoadoutManager';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';

describe('automated pellet weapons', () => {
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
});
