import { describe, expect, it, vi } from 'vitest';

import { WorldWeaponExecutionRuntime } from '../src/world/WorldWeaponExecutionRuntime';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { getHeldWeaponGameplayMuzzleOrigin } from '../src/loadout/HeldItemVisuals';
import type { ProjectileSpawnRequest } from '../src/projectile/ProjectileSpawnRequest';

function makeRuntime() {
  const spawnProjectile = vi.fn((_request: ProjectileSpawnRequest) => 7);
  const resolveHitscanShot = vi.fn(() => true);
  const resolveMeleeSwing = vi.fn(() => true);
  const resolveSafeHitscanStart = vi.fn((_sx: number, _sy: number, startX: number, startY: number) => ({ x: startX, y: startY }));
  const runtime = new WorldWeaponExecutionRuntime({
    projectileSpawn: { spawnProjectile },
    combatSystem: { resolveHitscanShot, resolveMeleeSwing, resolveSafeHitscanStart },
  });
  return { runtime, spawnProjectile, resolveHitscanShot, resolveMeleeSwing, resolveSafeHitscanStart };
}

describe('WorldWeaponExecutionRuntime – gemeinsame Immediate-Weapon-Execution-Capability', () => {
  it('verdrahtet Projektil-, Hitscan- und Melee-Fire einmalig mit Spawn-Port und Combat-Senken', () => {
    const { runtime, spawnProjectile, resolveHitscanShot, resolveMeleeSwing } = makeRuntime();

    const params = {
      x: 100, y: 200, angle: 0, targetX: 500, targetY: 200,
      ownerId: 'p1', ownerColor: 0xffffff, sourceSlot: 'weapon1' as const,
    };

    expect(runtime.fire(WEAPON_CONFIGS.GLOCK, params)).toBe(true);
    expect(spawnProjectile).toHaveBeenCalledTimes(1);
    const request = spawnProjectile.mock.calls[0]?.[0];
    expect(request?.origin).toMatchObject({ x: 100, y: 200, angle: 0 });
    expect(request?.provenance).toMatchObject({
      gameplaySourceId: 'p1',
      attributionId: 'p1',
      allegiance: { ownerId: 'p1' },
      weaponSourceId: WEAPON_CONFIGS.GLOCK.id,
      sourceSlot: 'weapon1',
    });

    expect(runtime.fire(WEAPON_CONFIGS.PLASMA_BURNER, params)).toBe(true);
    expect(resolveHitscanShot).toHaveBeenCalledTimes(1);
    expect(resolveHitscanShot.mock.calls[0]?.[0]).toBe('p1');

    expect(runtime.fire(WEAPON_CONFIGS.BITE, { ...params, sourceSlot: 'weapon2' })).toBe(true);
    expect(resolveMeleeSwing).toHaveBeenCalledTimes(1);
    expect(resolveMeleeSwing.mock.calls[0]?.[0]).toBe('p1');
  });

  it('trägt gameplay-/visual-Muzzle sowie sourceSlot/shotId unverändert in den Hitscan-Request', () => {
    const { runtime, resolveHitscanShot } = makeRuntime();
    const config = WEAPON_CONFIGS.PLASMA_BURNER;
    const muzzle = getHeldWeaponGameplayMuzzleOrigin(config.id, 100, 200, 0, 32);
    if (!muzzle) throw new Error('erwartete einen expliziten Gameplay-Muzzle');

    runtime.fire(config, {
      x: 100, y: 200, angle: 0, targetX: 500, targetY: 200,
      ownerId: 'p1', ownerColor: 0xffffff, sourceSlot: 'weapon2',
      shotId: 42, gameplayMuzzleOrigin: muzzle,
    });

    const call = resolveHitscanShot.mock.calls[0];
    // resolveHitscanShot(shooterId, startX, startY, angle, range, damage, ..., sourceSlot, shotId, ...)
    expect(call?.[1]).toBe(muzzle.x);
    expect(call?.[2]).toBe(muzzle.y);
    expect(call?.[12]).toBe('weapon2');
    expect(call?.[13]).toBe(42);
  });

  it('gibt für nicht-shared Fire-Typen false zurück (Spezialpfade bleiben beim Aufrufer)', () => {
    const { runtime, spawnProjectile } = makeRuntime();
    // Flammenwerfer ist ein spezialisierter Fire-Typ und läuft nicht über diesen Pfad.
    expect(runtime.fire(WEAPON_CONFIGS.FLAMETHROWER, {
      x: 0, y: 0, angle: 0, targetX: 1, targetY: 0, ownerId: 'p1', ownerColor: 0xffffff,
    })).toBe(false);
    expect(spawnProjectile).not.toHaveBeenCalled();
  });

  it('hält keinen world-scoped State: destroy ist idempotent', () => {
    const { runtime } = makeRuntime();
    expect(() => { runtime.destroy(); runtime.destroy(); }).not.toThrow();
  });

});
