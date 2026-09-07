import { describe, expect, it, vi } from 'vitest';

import { WorldWeaponExecutionRuntime } from '../src/world/WorldWeaponExecutionRuntime';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { getHeldWeaponGameplayMuzzleOrigin } from '../src/loadout/HeldItemVisuals';
import type { ProjectileSpawnRequest } from '../src/projectile/ProjectileSpawnRequest';

function makeRuntime() {
  const spawnProjectile = vi.fn((_request: ProjectileSpawnRequest) => 7);
  const resolveImmediateAttack = vi.fn(() => ({ accepted: true, interactions: [] }));
  const resolveSafeHitscanStart = vi.fn((_sx: number, _sy: number, startX: number, startY: number) => ({ x: startX, y: startY }));
  const runtime = new WorldWeaponExecutionRuntime({
    projectileSpawn: { spawnProjectile },
    combatSystem: { resolveImmediateAttack, resolveSafeHitscanStart },
  });
  return { runtime, spawnProjectile, resolveImmediateAttack, resolveSafeHitscanStart };
}

describe('WorldWeaponExecutionRuntime – gemeinsame Immediate-Weapon-Execution-Capability', () => {
  it('transports explicit reward components and the captured basis through every immediate weapon branch', () => {
    const { runtime, spawnProjectile, resolveImmediateAttack } = makeRuntime();
    const basis = Object.freeze({ playerId: 'p1', multiplier: 1.75 });
    const params = { x: 0, y: 0, angle: 0, targetX: 200, targetY: 0,
      ownerId: 'p1', ownerColor: 0xffffff, sourceSlot: 'weapon1' as const, adrenalineGainBasis: basis,
      primaryHitRewardOrigin: { x: 30, y: 40 } };
    runtime.fire({ ...WEAPON_CONFIGS.GLOCK, adrenalinGain: 2 }, params);
    runtime.fire({ ...WEAPON_CONFIGS.PLASMA_BURNER, adrenalinGain: 2 }, params);
    runtime.fire({ ...WEAPON_CONFIGS.BITE, adrenalinGain: 2, hitAdrenaline: 3 }, params);
    const intents = [spawnProjectile.mock.calls[0][0].provenance.primaryHitReward,
      ...resolveImmediateAttack.mock.calls.map(([request]) => request.payload.primaryHitReward)];
    expect(intents.map(intent => intent?.components.reduce((sum, component) => sum + component.amount, 0))).toEqual([2, 2, 5]);
    for (const intent of intents) {
      expect(intent?.gainBasis).toBe(basis);
      expect(intent?.sourcePosition).toEqual({ x: 30, y: 40 });
      expect(Object.isFrozen(intent?.sourcePosition)).toBe(true);
    }
  });

  it('verdrahtet Projektil-, Hitscan- und Melee-Fire einmalig mit Spawn-Port und Combat-Senken', () => {
    const { runtime, spawnProjectile, resolveImmediateAttack } = makeRuntime();

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
    expect(resolveImmediateAttack).toHaveBeenCalledTimes(1);
    expect(resolveImmediateAttack.mock.calls[0]?.[0]).toMatchObject({ kind: 'hitscan', payload: { shooterId: 'p1' } });

    expect(runtime.fire(WEAPON_CONFIGS.BITE, { ...params, sourceSlot: 'weapon2' })).toBe(true);
    expect(resolveImmediateAttack).toHaveBeenCalledTimes(2);
    expect(resolveImmediateAttack.mock.calls[1]?.[0]).toMatchObject({ kind: 'melee', payload: { shooterId: 'p1' } });
  });

  it('trägt gameplay-/visual-Muzzle sowie sourceSlot/shotId unverändert in den Hitscan-Request', () => {
    const { runtime, resolveImmediateAttack } = makeRuntime();
    const config = WEAPON_CONFIGS.PLASMA_BURNER;
    const muzzle = getHeldWeaponGameplayMuzzleOrigin(config.id, 100, 200, 0, 32);
    if (!muzzle) throw new Error('erwartete einen expliziten Gameplay-Muzzle');

    runtime.fire(config, {
      x: 100, y: 200, angle: 0, targetX: 500, targetY: 200,
      ownerId: 'p1', ownerColor: 0xffffff, sourceSlot: 'weapon2',
      shotId: 42, gameplayMuzzleOrigin: muzzle,
    });

    const call = resolveImmediateAttack.mock.calls[0]?.[0];
    expect(call?.kind).toBe('hitscan');
    expect(call?.payload.startX).toBe(muzzle.x);
    expect(call?.payload.startY).toBe(muzzle.y);
    expect(call?.payload.sourceSlot).toBe('weapon2');
    expect(call?.payload.shotId).toBe(42);
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

  it('delegiert Hitscan und Melee als normalisierte Immediate-Attacks statt positionaler Legacy-Aufrufe', () => {
    const spawnProjectile = vi.fn((_request: ProjectileSpawnRequest) => 7);
    const resolveImmediateAttack = vi.fn(() => ({ accepted: true, interactions: [] }));
    const resolveSafeHitscanStart = vi.fn((_sx: number, _sy: number, startX: number, startY: number) => ({ x: startX, y: startY }));
    const runtime = new WorldWeaponExecutionRuntime({
      projectileSpawn: { spawnProjectile },
      combatSystem: { resolveImmediateAttack, resolveSafeHitscanStart },
    });
    const params = {
      x: 100, y: 200, angle: 0, targetX: 500, targetY: 200,
      ownerId: 'p1', ownerColor: 0xffffff, sourceSlot: 'weapon1' as const,
    };

    expect(runtime.fire(WEAPON_CONFIGS.PLASMA_BURNER, params)).toBe(true);
    expect(runtime.fire(WEAPON_CONFIGS.BITE, params)).toBe(true);
    expect(resolveImmediateAttack).toHaveBeenCalledTimes(2);
    const hitscan = resolveImmediateAttack.mock.calls[0]?.[0];
    expect(hitscan).toMatchObject({ kind: 'hitscan', payload: { shooterId: 'p1', startY: 200 } });
    expect(hitscan?.payload.startX).toBeGreaterThan(100);
    expect(hitscan?.payload.range).toBeLessThan(WEAPON_CONFIGS.PLASMA_BURNER.range);
    expect(resolveImmediateAttack.mock.calls[1]?.[0]).toMatchObject({
      kind: 'melee',
      payload: { shooterId: 'p1', x: 100, y: 200, range: WEAPON_CONFIGS.BITE.range },
    });
  });

});
