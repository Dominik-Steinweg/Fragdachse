import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
  },
}));

import { ULTIMATE_CONFIGS, WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { WorldWeaponExecutionRuntime } from '../src/world/WorldWeaponExecutionRuntime';
import { AutomatedWeaponExecutionAdapter } from '../src/world/AutomatedWeaponExecutionAdapter';

describe('automated projectile weapons', () => {
  it('forwards construction damage as owner-attributed utility damage', () => {
    const dispatchWeaponFire = vi.fn(() => true);
    const adapter = new AutomatedWeaponExecutionAdapter(
      { fire: dispatchWeaponFire },
      { spawnProjectile: vi.fn() },
    );

    expect(adapter.fire(
      WEAPON_CONFIGS.TURRET_ROCKET_BURST,
      {
        x: 100, y: 200, angle: 0, targetX: 400, targetY: 200,
        ownerId: 'player-owner', ownerColor: 0xff8a3d,
        options: { sourceSlot: 'utility', ignoreRockIndex: 7 },
      },
    )).toBe(true);

    expect(dispatchWeaponFire).toHaveBeenCalledOnce();
    expect(dispatchWeaponFire.mock.calls[0][1]).toMatchObject({
      ownerId: 'player-owner',
      sourceSlot: 'utility',
      options: { ignoreRockIndex: 7 },
    });
  });

  it('passes turret support collision filters into the spawned projectile', () => {
    const spawnProjectile = vi.fn(() => 42);
    const sharedExecution = new WorldWeaponExecutionRuntime({
      projectileManager: { spawnProjectile },
      combatSystem: { resolveHitscanShot: vi.fn(() => true), resolveMeleeSwing: vi.fn(() => true) },
    });
    const adapter = new AutomatedWeaponExecutionAdapter(sharedExecution, { spawnProjectile });

    adapter.fire(
      WEAPON_CONFIGS.TURRET_ROCKET_BURST,
      {
        x: 100, y: 200, angle: 0, targetX: 400, targetY: 200,
        ownerId: 'player-owner', ownerColor: 0xff8a3d,
        options: { ignoreBaseCollisions: true, ignoreRockIndex: 7, sourceTurretId: '7' },
      },
    );

    expect(spawnProjectile.mock.calls[0]?.[4]).toMatchObject({
      ignoreBaseCollisions: true,
      ignoreRockIndex: 7,
      sourceTurretId: '7',
    });
  });

  it('applies one shared tower multiplier to direct, explosive, cloud and burn damage', () => {
    const dispatchWeaponFire = vi.fn(() => true);
    const spawnProjectile = vi.fn(() => 1);
    const adapter = new AutomatedWeaponExecutionAdapter(
      { fire: dispatchWeaponFire },
      { spawnProjectile },
    );

    adapter.fire(
      WEAPON_CONFIGS.TURRET_ROCKET_BURST,
      {
        x: 0, y: 0, angle: 0, targetX: 100, targetY: 0,
        ownerId: 'owner', ownerColor: 0xffffff,
        options: { directDamageMultiplier: 1.25, payloadDamageMultiplier: 2.5, sourceSlot: 'utility' },
      },
    );
    const rocket = dispatchWeaponFire.mock.calls[0][0];
    expect(rocket.damage).toBeCloseTo(WEAPON_CONFIGS.TURRET_ROCKET_BURST.damage * 1.25, 10);
    expect(rocket.fire.impactExplosion.maxDamage).toBeCloseTo(
      WEAPON_CONFIGS.TURRET_ROCKET_BURST.fire.type === 'projectile'
        ? (WEAPON_CONFIGS.TURRET_ROCKET_BURST.fire.impactExplosion?.maxDamage ?? 0) * 2.5
        : 0,
      10,
    );

    dispatchWeaponFire.mockClear();
    adapter.fire(
      WEAPON_CONFIGS.SPORES,
      {
        x: 0, y: 0, angle: 0, targetX: 100, targetY: 0,
        ownerId: 'owner', ownerColor: 0xffffff,
        options: { directDamageMultiplier: 1.25, payloadDamageMultiplier: 2.5, sourceSlot: 'utility' },
      },
    );
    const spores = dispatchWeaponFire.mock.calls[0][0];
    expect(spores.fire.impactCloud.damagePerTick).toBeCloseTo(
      WEAPON_CONFIGS.SPORES.fire.type === 'projectile'
        ? (WEAPON_CONFIGS.SPORES.fire.impactCloud?.damagePerTick ?? 0) * 2.5
        : 0,
      10,
    );

    dispatchWeaponFire.mockClear();
    adapter.fire(
      WEAPON_CONFIGS.TURRET_FLAME,
      {
        x: 0, y: 0, angle: 0, targetX: 100, targetY: 0,
        ownerId: 'owner', ownerColor: 0xffffff,
        options: { directDamageMultiplier: 1.25, payloadDamageMultiplier: 2.5, sourceSlot: 'utility' },
      },
    );
    const flame = spawnProjectile.mock.calls[0][4];
    expect(flame.burnDamagePerTick).toBeCloseTo(
      WEAPON_CONFIGS.TURRET_FLAME.fire.type === 'flamethrower'
        ? WEAPON_CONFIGS.TURRET_FLAME.fire.burnDamagePerTick * 2.5
        : 0,
      10,
    );
  });

  it('dispatches the Void Hunter shotgun as five spread pellets with one shared shot sound', () => {
    const dispatchWeaponFire = vi.fn(() => true);
    const adapter = new AutomatedWeaponExecutionAdapter(
      { fire: dispatchWeaponFire },
      { spawnProjectile: vi.fn() },
    );

    expect(adapter.fire(
      WEAPON_CONFIGS.VOID_HUNTER_SHOTGUN,
      { x: 100, y: 200, angle: 0, targetX: 400, targetY: 200, ownerId: 'void-hunter', ownerColor: 0xaa55ff },
    )).toBe(true);

    expect(dispatchWeaponFire).toHaveBeenCalledTimes(5);
    const anglesInDegrees = dispatchWeaponFire.mock.calls.map(
      (call) => (call[1].angle as number) * 180 / Math.PI,
    );
    expect(anglesInDegrees).toEqual([-12, -6, 0, 6, 12]);
    expect(dispatchWeaponFire.mock.calls[0][0].shotAudio).toBeDefined();
    for (const call of dispatchWeaponFire.mock.calls.slice(1)) {
      expect(call[0].shotAudio).toBeUndefined();
    }
  });

  it('fires the Void Hunter Gauss variant with its legacy projectile values and Gauss style', () => {
    const spawnProjectile = vi.fn(() => 42);
    const adapter = new AutomatedWeaponExecutionAdapter(
      { fire: vi.fn(() => true) },
      { spawnProjectile },
    );
    const config = ULTIMATE_CONFIGS.VOID_HUNTER_GAUSS;
    if (config.type !== 'gauss') throw new Error('Testkonfiguration muss Gauss sein');

    expect(adapter.fireGauss(
      config,
      { x: 100, y: 200, angle: 0, ownerId: 'void-hunter', ownerColor: 0xaa55ff },
    )).toBe(true);

    const [, , , , projectile] = spawnProjectile.mock.calls[0];
    expect(projectile).toMatchObject({
      speed: 1350,
      size: 16,
      damage: 200,
      color: 0xb347ff,
      projectileStyle: 'gauss',
      projectileVisualScale: 1.25,
      maxBounces: 0,
      remainingRangePx: 1500,
      rockDamageMult: 1,
      trainDamageMult: 1,
    });
  });
});
