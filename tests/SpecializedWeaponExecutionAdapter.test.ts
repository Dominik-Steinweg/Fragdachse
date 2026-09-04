import { describe, expect, it, vi } from 'vitest';

import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { SpecializedWeaponExecutionAdapter } from '../src/world/SpecializedWeaponExecutionAdapter';
import type { ProjectileSpawnRequest } from '../src/projectile/ProjectileSpawnRequest';

describe('SpecializedWeaponExecutionAdapter – unmittelbare Spezialschüsse (4C)', () => {
  it('führt Flamethrower, Leaf Blower, Reinforcement Matrix und Energy Injector über eine Capability aus', () => {
    const spawnProjectile = vi.fn((_request: ProjectileSpawnRequest) => 1);
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
    for (const [request] of spawnProjectile.mock.calls) {
      expect(request.provenance).toMatchObject({
        gameplaySourceId: 'player-owner',
        attributionId: 'player-owner',
        allegiance: { ownerId: 'player-owner' },
        sourceSlot: 'weapon1',
      });
      expect(request.origin.gameplayMuzzleOrigin).toEqual({ x: 108, y: 200 });
      expect(request.presentation.visualMuzzleOrigin).toEqual({ x: 109, y: 201 });
    }
    // Nur die beiden Dauerstrahl-Waffen tragen die Quellen-Kollisionsausnahmen des Turms.
    for (const index of [0, 1]) {
      const request = spawnProjectile.mock.calls[index]?.[0];
      expect(request?.flight.collisionFilter).toMatchObject({ ignoreBaseCollisions: true });
      expect(request?.provenance.sourceTurretId).toBe('turret-1');
    }
  });

  it('lässt die gemeinsamen Fire-Typen und nicht unterstützte Zustandswaffen beim Aufrufer', () => {
    const spawnProjectile = vi.fn((_request: ProjectileSpawnRequest) => 1);
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
