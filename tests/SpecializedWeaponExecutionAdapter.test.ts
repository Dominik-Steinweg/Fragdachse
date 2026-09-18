import { describe, expect, it, vi } from 'vitest';

import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { FIREBALL_FLAME_SPEED_FACTOR, FIREBALL_FLAME_RANGE_FACTOR, FIREBALL_FLAME_BURN_DAMAGE_FACTOR } from '../src/config';
import { SpecializedWeaponExecutionAdapter } from '../src/world/SpecializedWeaponExecutionAdapter';
import type { ProjectileSpawnRequest } from '../src/projectile/ProjectileSpawnRequest';

describe('SpecializedWeaponExecutionAdapter – unmittelbare Spezialschüsse (4C)', () => {
  it('uses the normal flame payload for emission, including expiry ground, without recursive execution', () => {
    const spawnProjectile = vi.fn((_request: ProjectileSpawnRequest) => 1);
    const adapter = new SpecializedWeaponExecutionAdapter({ spawnProjectile });
    const base = WEAPON_CONFIGS.FLAMETHROWER;
    if (base.fire.type !== 'flamethrower') throw new Error('Expected flames');
    const normal = { ...base, damage: 7, range: 430, cooldown: 43,
      fire: { ...base.fire, piercingCount: 1, burnDamagePerTick: 3,
        burningGround: { cellSize: 32, durationMs: 2300, igniteProjectiles: 1, createOnFlameExpiry: 1 } } };
    const params = { x: 10, y: 20, angle: 0.7, targetX: 100, targetY: 20,
      ownerId: 'owner', ownerColor: 123, sourceSlot: 'weapon2' as const };
    adapter.fire(normal, params);
    adapter.fire({ ...base, damage: 100, cooldown: 1700, range: 900, fireballFlameConfig: normal,
      fire: { ...base.fire, fireball: { ...base.fire.fireball!, enabled: 1, trailEnabled: 1, chunkCount: 3 } } },
    { ...params, flameRuntimeDamageMultiplier: 2 });
    expect(spawnProjectile).toHaveBeenCalledTimes(2);
    const ordinary = spawnProjectile.mock.calls[0][0];
    const fireball = spawnProjectile.mock.calls[1][0];
    const emission = fireball.flameEmission!;
    expect(emission.intervalMs).toBe(normal.cooldown);
    expect(emission.flame.flight).toEqual({ ...ordinary.flight,
      speed: ordinary.flight.speed * FIREBALL_FLAME_SPEED_FACTOR, lifetimeMs: expect.any(Number) });
    const seconds = emission.flame.flight.lifetimeMs / 1000;
    const decay = normal.fire.velocityDecay;
    const distance = emission.flame.flight.speed * (Math.pow(decay, seconds) - 1) / Math.log(decay);
    expect(distance).toBeCloseTo(normal.range * FIREBALL_FLAME_RANGE_FACTOR);
    expect(ordinary.interaction.burn?.damagePerTick).toBe(normal.fire.burnDamagePerTick);
    expect(emission.flame.interaction.burn).toEqual({ ...ordinary.interaction.burn,
      damagePerTick: normal.fire.burnDamagePerTick * FIREBALL_FLAME_BURN_DAMAGE_FACTOR });
    expect(emission.flame.interaction.directHit?.damage).toBe(normal.damage * 2);
    expect(emission.flame.flameExpiryGround).toMatchObject({ durationMs: 2300, igniteProjectiles: true,
      burn: { damagePerTick: normal.fire.burnDamagePerTick * FIREBALL_FLAME_BURN_DAMAGE_FACTOR,
        durationMs: normal.fire.burnDurationMs } });
    expect(emission.flame).not.toHaveProperty('flameEmission');
    expect(emission.flame.presentation.style).toBe('flame');
    expect(fireball.interaction.pathEffect?.kind).toBe('fireball');
    expect(fireball.interaction.explosion?.fireChunkBurst).toMatchObject({ count: 3, igniteCenter: true });
    expect(fireball.interaction.explosion?.burnOnHit).toEqual({
      damagePerTick: base.fire.burnDamagePerTick, durationMs: base.fire.burnDurationMs });
  });
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
      options: { sourceCarrierBaseId: 'carrier', sourceTurretId: 'turret-1' },
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
      expect(request?.flight.collisionFilter).toMatchObject({ sourceCarrierBaseId: 'carrier' });
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
