import { describe, expect, it, vi } from 'vitest';
import {
  NegevBehaviorRuntime,
  type NegevBehaviorRuntimeOptions,
} from '../src/world/NegevBehaviorRuntime';

function makeConfig() {
  return {
    id: 'NEGEV',
    damage: 20,
    burnOnHit: { damagePerTick: 3, durationMs: 2_000 },
    negevKillstreak: {
      damageBonusPerKill: 0.1,
      healPerKill: 5,
      armorPerKill: 2,
      explosionEnabled: 1,
      explosionDamagePerKill: 20,
      explosionBaseRadius: 100,
      explosionRadiusPerKill: 10,
      explosionBaseKnockback: 4,
      explosionKnockbackPerKill: 2,
      fireChunkDurationMs: 700,
      fireChunkBurnDurationMs: 2_000,
      fireChunkBurnDamagePerTick: 3,
    },
  } as any;
}

function makeRuntime(config = makeConfig()) {
  const combatSystem = {
    heal: vi.fn(),
    addArmor: vi.fn(),
    applyAoeDamage: vi.fn(),
  };
  const physicsSystem = { applyRadialImpulse: vi.fn() };
  const onKillstreakExplosion = vi.fn();
  const loadout = {
    getEquippedWeaponConfig: vi.fn(() => config),
  };
  const options: NegevBehaviorRuntimeOptions = {
    loadout,
    playerManager: { getPlayer: vi.fn(() => ({ x: 40, y: 60 })) } as any,
    combatSystem,
    physicsSystem,
    onKillstreakExplosion,
  };
  return {
    runtime: new NegevBehaviorRuntime(options),
    config,
    loadout,
    combatSystem,
    physicsSystem,
    onKillstreakExplosion,
  };
}

describe('NegevBehaviorRuntime – Killstreak ownership and timing', () => {
  it('applies the current streak damage contribution to the next shot without mutating config', () => {
    const { runtime, config, combatSystem } = makeRuntime();

    runtime.resetPlayer('p1');
    runtime.registerKill({ killerId: 'p1', sourceId: 'NEGEV' });
    runtime.registerKill({ killerId: 'p1', sourceId: 'NEGEV' });

    const prepared = runtime.prepareShot('p1', config);

    expect(prepared).toMatchObject({ damageMultiplier: 1.2 });
    expect(prepared?.shotConfig.damage).toBe(24);
    expect(prepared?.shotConfig.burnOnHit?.damagePerTick).toBeCloseTo(3.6);
    expect(config.damage).toBe(20);
    expect(combatSystem.heal).toHaveBeenCalledTimes(2);
  });

  it('records the last successful shot only through commit and keeps the streak inside the host-time gap', () => {
    const { runtime, onKillstreakExplosion } = makeRuntime();

    runtime.registerKill({ killerId: 'p1', sourceId: 'NEGEV' });
    runtime.commitShot('p1', 1_000);
    runtime.update(1_299);
    expect(runtime.getHudBuffs('p1')).toHaveLength(1);
    expect(onKillstreakExplosion).not.toHaveBeenCalled();

    runtime.update(1_300);
    expect(onKillstreakExplosion).toHaveBeenCalledTimes(1);
    expect(runtime.getHudBuffs('p1')).toEqual([]);
  });

  it('finishes once with damage, knockback and the fire-chunk contract at the supplied host time', () => {
    const { runtime, combatSystem, physicsSystem, onKillstreakExplosion } = makeRuntime();

    runtime.registerKill({ killerId: 'p1', sourceId: 'NEGEV' });
    runtime.registerKill({ killerId: 'p1', sourceId: 'NEGEV' });
    runtime.commitShot('p1', 2_000);
    runtime.update(2_301);

    expect(combatSystem.applyAoeDamage).toHaveBeenCalledWith(
      40,
      60,
      120,
      40,
      'p1',
      false,
      expect.objectContaining({
        category: 'explosion',
        sourceId: 'weapon.NEGEV.killstreak',
        sourceSlot: 'weapon2',
      }),
    );
    expect(physicsSystem.applyRadialImpulse).toHaveBeenCalledWith(40, 60, 120, 8, 'p1', 0);
    expect(onKillstreakExplosion).toHaveBeenCalledWith({
      ownerId: 'p1',
      x: 40,
      y: 60,
      kills: 2,
      radius: 120,
      damage: 40,
      nowMs: 2_301,
      fireChunkDurationMs: 700,
      fireChunkBurnDurationMs: 2_000,
      fireChunkBurnDamagePerTick: 3,
    });

    runtime.update(2_302);
    expect(onKillstreakExplosion).toHaveBeenCalledTimes(1);
  });

  it('terminates immediately on a resource rejection and is stale-safe after equipment change', () => {
    const { runtime, loadout, onKillstreakExplosion } = makeRuntime();

    runtime.registerKill({ killerId: 'p1', sourceId: 'NEGEV' });
    runtime.terminateStreak('p1', 500);
    expect(onKillstreakExplosion).toHaveBeenCalledTimes(1);

    runtime.registerKill({ killerId: 'p1', sourceId: 'NEGEV' });
    loadout.getEquippedWeaponConfig.mockReturnValue({ id: 'AK47' } as any);
    runtime.update(1_000);
    expect(onKillstreakExplosion).toHaveBeenCalledTimes(1);
    expect(runtime.getHudBuffs('p1')).toEqual([]);
  });

  it('clears player/world lifetime state and ignores later outcomes after destroy', () => {
    const { runtime, onKillstreakExplosion } = makeRuntime();

    runtime.registerKill({ killerId: 'p1', sourceId: 'NEGEV' });
    runtime.removePlayer('p1');
    expect(runtime.getHudBuffs('p1')).toEqual([]);

    runtime.registerKill({ killerId: 'p1', sourceId: 'NEGEV' });
    runtime.destroy();
    runtime.registerKill({ killerId: 'p1', sourceId: 'NEGEV' });
    runtime.update(10_000);

    expect(onKillstreakExplosion).not.toHaveBeenCalled();
    expect(runtime.getHudBuffs('p1')).toEqual([]);
  });
});
