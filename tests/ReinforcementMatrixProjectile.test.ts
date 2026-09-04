import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
  },
}));

import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { AutomatedWeaponExecutionAdapter } from '../src/world/AutomatedWeaponExecutionAdapter';
import type { ProjectileSpawnRequest } from '../src/projectile/ProjectileSpawnRequest';

// Fachlicher Name; OVERCHARGE_CORE bleibt nur der persistente Loadout-Identifier.
describe('reinforcement matrix projectile', () => {
  it('launches a slow wall-colliding rocket payload and deploys only on impact', () => {
    const spawnProjectile = vi.fn((_request: ProjectileSpawnRequest) => 17);
    const adapter = new AutomatedWeaponExecutionAdapter(
      { fire: vi.fn(() => true) },
      { spawnProjectile },
    );

    expect(adapter.fire(
      WEAPON_CONFIGS.OVERCHARGE_CORE,
      {
        x: 100, y: 200, angle: Math.PI, targetX: 1_000, targetY: 200,
        ownerId: 'inspector', ownerColor: 0x22cc88,
      },
    )).toBe(true);

    expect(spawnProjectile).toHaveBeenCalledTimes(1);
    const [request] = spawnProjectile.mock.calls[0];
    expect(request.origin).toMatchObject({ x: 100, y: 200, angle: 0 });
    expect(request.provenance).toMatchObject({ attributionId: 'inspector', sourceSlot: 'weapon2' });
    expect(request.flight).toMatchObject({
      speed: 320,
      size: 12,
      lifetimeMs: 1_312.5,
      remainingRangePx: 420,
      maxBounces: 0,
      isGrenade: false,
    });
    expect(request.presentation.style).toBe('rocket');
    expect(request.interaction.directHit?.damage ?? 0).toBe(0);
    expect(request.interaction.explosion).toMatchObject({
      radius: 220,
      maxDamage: 0,
      knockback: 0,
      selfDamageMult: 0,
      rockDamageMult: 0,
      trainDamageMult: 0,
      reinforcementMatrix: {
        durationMs: 6_000,
        damageReduction: 0.5,
        vulnerabilityBonus: 0.2,
        color: 0x4fd6ff,
      },
    });
    expect(request.interaction.explosion?.visualStyle).toBeUndefined();
  });

  it('limits flight time to the aimed position when it is inside weapon range', () => {
    const spawnProjectile = vi.fn((_request: ProjectileSpawnRequest) => 18);
    const adapter = new AutomatedWeaponExecutionAdapter(
      { fire: vi.fn(() => true) },
      { spawnProjectile },
    );

    adapter.fire(
      WEAPON_CONFIGS.OVERCHARGE_CORE,
      {
        x: 40, y: 60, angle: 0, targetX: 40, targetY: 220,
        ownerId: 'inspector', ownerColor: 0xffffff,
      },
    );

    const [request] = spawnProjectile.mock.calls[0];
    expect(request.origin.angle).toBeCloseTo(Math.PI / 2);
    expect(request.flight.remainingRangePx).toBe(160);
    expect(request.flight.lifetimeMs).toBe(500);
  });
});
