import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
  },
}));

import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { LoadoutManager } from '../src/loadout/LoadoutManager';
import { ShieldBuffSystem } from '../src/systems/ShieldBuffSystem';

describe('ShieldBuff Loadout boundary', () => {
  it('preserves primary-damage and HUD reads through the semantic port', () => {
    const loadout = new LoadoutManager(
      { getMaxRage: () => 600 } as never,
      { getGameMode: () => 'coop_defense' } as never,
    );
    loadout.assignDefaultLoadout('p1', {
      weapon1: WEAPON_CONFIGS.GLOCK,
      weapon2: WEAPON_CONFIGS.ENERGY_SHIELD,
    });
    const shieldBuff = new ShieldBuffSystem();
    loadout.setShieldBuffReadPort(shieldBuff);

    const fire = WEAPON_CONFIGS.ENERGY_SHIELD.fire;
    if (fire.type !== 'energy_shield') throw new Error('expected Energy Shield config');
    shieldBuff.addBlockedDamage('p1', 50, fire, 1_000);

    const hud = loadout.getShieldBuffHudState('p1', 1_000);
    const expectedMultiplier = 1 + fire.buffMaxBonus * (hud.value / fire.buffMax);
    expect(hud.visible).toBe(true);
    expect(hud.value).toBeGreaterThan(0);
    expect(loadout.getWeaponDamageMultiplier('p1', 'weapon1', 1_000)).toBeCloseTo(expectedMultiplier);

    shieldBuff.resetPlayer('p1');
    expect(loadout.getWeaponDamageMultiplier('p1', 'weapon1', 1_001)).toBe(1);
    expect(loadout.getShieldBuffHudState('p1', 1_001)).toMatchObject({ visible: true, value: 0 });

    shieldBuff.addBlockedDamage('p1', 50, fire, 2_000);
    shieldBuff.removePlayer('p1');
    expect(loadout.getWeaponDamageMultiplier('p1', 'weapon1', 2_001)).toBe(1);
  });
});
