import { describe, expect, it, vi } from 'vitest';

import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { SpecializedWeaponExecutionAdapter } from '../src/world/SpecializedWeaponExecutionAdapter';

describe('SpecializedWeaponExecutionAdapter – unmittelbare Spezialschüsse (4C)', () => {
  it('führt Flamethrower, Leaf Blower, Reinforcement Matrix und Energy Injector über eine Capability aus', () => {
    const spawnProjectile = vi.fn(() => 1);
    const adapter = new SpecializedWeaponExecutionAdapter({ spawnProjectile });
    const params = {
      x: 100,
      y: 200,
      angle: 0,
      targetX: 400,
      targetY: 200,
      ownerId: 'player-owner',
      ownerColor: 0xff8a3d,
      sourceSlot: 'weapon1' as const,
      options: { ignoreBaseCollisions: true, sourceTurretId: 'turret-1' },
      gameplayMuzzleOrigin: { x: 108, y: 200 },
      visualMuzzleOrigin: { x: 109, y: 201 },
    };

    for (const config of [
      WEAPON_CONFIGS.FLAMETHROWER,
      WEAPON_CONFIGS.LEAF_BLOWER,
      WEAPON_CONFIGS.OVERCHARGE_CORE,
      WEAPON_CONFIGS.ENERGY_INJECTOR,
    ]) {
      expect(adapter.fire(config, params)).toBe(true);
    }

    expect(spawnProjectile).toHaveBeenCalledTimes(4);
    for (const [, , , ownerId, projectile] of spawnProjectile.mock.calls) {
      expect(ownerId).toBe('player-owner');
      expect(projectile).toMatchObject({
        sourceSlot: 'weapon1',
        gameplayMuzzleOrigin: { x: 108, y: 200 },
        visualMuzzleOrigin: { x: 109, y: 201 },
      });
    }
    expect(spawnProjectile.mock.calls[0]?.[4]).toMatchObject({ ignoreBaseCollisions: true });
    expect(spawnProjectile.mock.calls[1]?.[4]).toMatchObject({ ignoreBaseCollisions: true });
    expect(spawnProjectile.mock.calls[0]?.[4]).toMatchObject({ sourceTurretId: 'turret-1' });
    expect(spawnProjectile.mock.calls[1]?.[4]).toMatchObject({ sourceTurretId: 'turret-1' });
  });

  it('lässt die gemeinsamen Fire-Typen und nicht unterstützte Zustandswaffen beim Aufrufer', () => {
    const spawnProjectile = vi.fn(() => 1);
    const adapter = new SpecializedWeaponExecutionAdapter({ spawnProjectile });

    expect(adapter.fire(WEAPON_CONFIGS.GLOCK, {
      x: 0,
      y: 0,
      angle: 0,
      targetX: 1,
      targetY: 0,
      ownerId: 'owner',
      ownerColor: 0xffffff,
    })).toBe(false);
    expect(adapter.fire(WEAPON_CONFIGS.TESLA_DOME, {
      x: 0,
      y: 0,
      angle: 0,
      targetX: 1,
      targetY: 0,
      ownerId: 'owner',
      ownerColor: 0xffffff,
    })).toBe(false);
    expect(spawnProjectile).not.toHaveBeenCalled();
  });
});
