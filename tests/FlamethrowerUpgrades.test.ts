import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
  },
}));

import { applyCoopDefenseModifiersToWeaponConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { createSingleOwnerProvenance } from '../src/projectile/ProjectileSpawnRequest';
import { FlamethrowerUpgradeSystem } from '../src/systems/FlamethrowerUpgradeSystem';
import type { CoopDefenseUpgradeProfile } from '../src/types';
import type { ProjectileBurnAugment, ProjectileTravelSample } from '../src/projectile/ProjectileTravelPort';
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
    const projectile: ProjectileTravelSample = {
      projectileId: 1,
      fromX: 0,
      fromY: 0,
      toX: 100,
      toY: 0,
      provenance: createSingleOwnerProvenance('shooter', { weaponSourceId: 'GLOCK' }),
      capabilities: { canReceiveFireImbue: true },
    };
    const augments: Array<{ projectileId: number; augment: ProjectileBurnAugment }> = [];
    const system = new FlamethrowerUpgradeSystem(
      { getAllPlayers: () => [] } as never,
      null,
      { getTravelSamples: () => [projectile] },
      { addBurnAugment: (projectileId, augment) => { augments.push({ projectileId, augment }); return true; } },
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

    expect(augments).toHaveLength(1);
    expect(augments[0]).toMatchObject({
      projectileId: 1,
      augment: {
        burn: { durationMs: 500, damagePerTick: 3 },
        provenance: {
          gameplaySourceId: 'shooter',
          attributionId: 'shooter',
          allegiance: { ownerId: 'shooter' },
          weaponSourceId: 'ground-fire',
        },
      },
    });
  });

  it('emits a fireball path effect once per ground-fire cell without touching the travel sample', () => {
    const sample: ProjectileTravelSample = {
      projectileId: 7,
      fromX: 0,
      fromY: 8,
      toX: 24,
      toY: 8,
      provenance: createSingleOwnerProvenance('shooter', { weaponSourceId: 'weapon.fireball_launcher' }),
      capabilities: {
        canReceiveFireImbue: false,
        pathEffect: {
          kind: 'fireball',
          fireTrail: {
            effect: {
              durationMs: 1_000,
              burnDurationMs: 500,
              burnDamagePerTick: 2,
              sourceId: 'weapon.fireball_fire',
            },
            halfWidthCells: 0,
            cellKey: '1:0',
          },
        },
      },
    };
    const refreshGround = vi.fn();
    const system = new FlamethrowerUpgradeSystem(
      { getAllPlayers: () => [] } as never,
      null,
      { getTravelSamples: () => [sample] },
      { addBurnAugment: () => false },
      { isAlive: () => true } as never,
      {} as never,
      { hostRefreshGroundCell: refreshGround } as never,
      () => false,
      () => true,
      () => {},
      (_ownerId, _stat, baseValue) => baseValue,
      () => {},
      () => {},
    );

    system.hostUpdate(100);
    system.hostUpdate(200);

    expect(refreshGround).toHaveBeenCalledTimes(1);
    expect(refreshGround).toHaveBeenCalledWith(
      24,
      8,
      expect.objectContaining({ sourceId: 'weapon.fireball_fire', durationMs: 1_000 }),
      100,
    );
  });
});
