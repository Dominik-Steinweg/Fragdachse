import { describe, expect, it, vi } from 'vitest';
import { fakeEntity } from './fakeEntity';

vi.mock('phaser', () => ({
  Math: {
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
  },
}));

import { applyCoopDefenseModifiersToWeaponConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { FlamethrowerUpgradeSystem } from '../src/systems/FlamethrowerUpgradeSystem';
import type { CoopDefenseUpgradeProfile, TrackedProjectile } from '../src/types';
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

  it('characterizes pre-combat fire imbue for a projectile crossing friendly ground fire', () => {
    const projectile = fakeEntity({
      id: 1,
      ownerId: 'shooter',
      lastX: 0,
      lastY: 0,
      x: 100,
      y: 0,
      displayWidth: 8,
      isGrenade: false,
      isFlame: false,
      canReceiveFireImbue: true,
      pendingDestroy: false,
    }) as unknown as TrackedProjectile;
    const system = new FlamethrowerUpgradeSystem(
      { getAllPlayers: () => [] } as never,
      null,
      { getActiveProjectiles: () => [projectile] } as never,
      { isAlive: () => true } as never,
      {} as never,
      {
        collectGroundFireOwnersAlongSegment: () => [{ sourceId: 'ground-fire', ownerId: 'shooter' }],
      } as never,
      () => false,
      () => true,
      () => {},
      (ownerId, stat, baseValue) => {
        if (ownerId !== 'shooter') return baseValue;
        if (stat.endsWith('.enabled')) return 1;
        if (stat.endsWith('.durationMs')) return 500;
        return 3;
      },
      () => {},
      () => {},
    );

    system.prepareProjectileBurns(100);

    expect(projectile.supplementalBurnOnHit).toEqual({ durationMs: 500, damagePerTick: 3 });
  });
});
