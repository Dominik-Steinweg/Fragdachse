import { describe, expect, it } from 'vitest';
import { applyCoopDefenseModifiersToWeaponConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import type { CoopDefenseUpgradeProfile } from '../src/types';
import {
  getCoopDefenseResolvedEffectTotals,
  getCoopDefenseUpgradeDefinition,
} from '../src/utils/coopDefenseUpgrades';

function maxProfile(upgradeIds: readonly string[]): CoopDefenseUpgradeProfile {
  return {
    upgrades: Object.fromEntries(upgradeIds.map((id) => [
      id,
      {
        unlocked: true,
        level: getCoopDefenseUpgradeDefinition(id)?.maxLevel ?? 1,
      },
    ])),
  };
}

describe('Flamethrower fireball coop-defense upgrade', () => {
  it('keeps continuous-fire adrenaline consumption per time equal to the base weapon', () => {
    const base = WEAPON_CONFIGS.FLAMETHROWER;
    const upgradeIds = [
      'unlock_flamethrower',
      'flamethrower_expiry_ground',
      'flamethrower_adrenalin_efficiency',
      'flamethrower_range',
      'flamethrower_pierce',
      'flamethrower_kamikaze',
      'flamethrower_kamikaze_molotov_bonuses',
      'flamethrower_fireball',
    ] as const;
    const totals = getCoopDefenseResolvedEffectTotals(maxProfile(upgradeIds));
    const resolved = applyCoopDefenseModifiersToWeaponConfig(base, 'weapon2', totals);

    expect(resolved.fire.type).toBe('flamethrower');
    if (resolved.fire.type !== 'flamethrower') throw new Error('Expected flamethrower config');
    expect(resolved.fire.fireball?.enabled).toBeGreaterThan(0);
    expect(resolved.cooldown).toBeGreaterThan(0);
    const expectedPreCompensationCost = (
      base.adrenalinCost + (totals.additive['weapon2.adrenalinCost'] ?? 0)
    ) * (1 + (totals.percentage['weapon2.adrenalinCost'] ?? 0));
    expect(resolved.adrenalinCost / resolved.cooldown)
      .toBeCloseTo(expectedPreCompensationCost / base.cooldown);
  });
});
