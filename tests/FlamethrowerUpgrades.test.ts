import { describe, expect, it } from 'vitest';
import { applyCoopDefenseModifiersToWeaponConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import type { CoopDefenseUpgradeProfile } from '../src/types';
import { getCoopDefenseResolvedEffectTotals } from '../src/utils/coopDefenseUpgrades';

function maxProfile(levels: Record<string, number>): CoopDefenseUpgradeProfile {
  return {
    upgrades: Object.fromEntries(
      Object.entries(levels).map(([id, level]) => [id, { unlocked: true, level }]),
    ),
  };
}

describe('Flamethrower fireball coop-defense upgrade', () => {
  it('keeps continuous-fire adrenaline consumption per time equal to the base weapon', () => {
    const base = WEAPON_CONFIGS.FLAMETHROWER;
    const totals = getCoopDefenseResolvedEffectTotals(maxProfile({
      unlock_flamethrower: 1,
      flamethrower_expiry_ground: 1,
      flamethrower_adrenalin_efficiency: 3,
      flamethrower_range: 3,
      flamethrower_pierce: 1,
      flamethrower_kamikaze: 1,
      flamethrower_kamikaze_molotov_bonuses: 1,
      flamethrower_fireball: 1,
    }));
    const resolved = applyCoopDefenseModifiersToWeaponConfig(base, 'weapon2', totals);

    expect(resolved.fire.type).toBe('flamethrower');
    if (resolved.fire.type !== 'flamethrower') throw new Error('Expected flamethrower config');
    expect(resolved.fire.fireball?.enabled).toBe(1);
    expect(resolved.cooldown).toBeCloseTo(1500);
    expect(resolved.adrenalinCost).toBeCloseTo(7.5);
    expect(resolved.adrenalinCost / resolved.cooldown)
      .toBeCloseTo((base.adrenalinCost * 0.7) / base.cooldown);
  });
});
