import { describe, expect, it, vi } from 'vitest';
import { PlayerUltimateBehaviorRuntime } from '../src/world/PlayerUltimateBehaviorRuntime';
import { ULTIMATE_CONFIGS } from '../src/loadout/LoadoutConfig';

function makeHarness() {
  const players = [
    { id: 'p1', x: 0, y: 0 },
    { id: 'p2', x: 50, y: 0 },
    { id: 'enemy', x: 50, y: 0 },
  ];
  const rage = new Map([['p1', 600]]);
  const combatSystem = { addArmor: vi.fn(), applyAoeDamage: vi.fn() };
  const armageddon = { activate: vi.fn(), deactivate: vi.fn() };
  const recordUltimateUsed = vi.fn();
  const config = {
    ...ULTIMATE_CONFIGS.ARMAGEDDON,
    rageRequired: 600,
    duration: 2_000,
    rageDrainDuration: 2_000,
    armorPerTick: 4,
    armorTickIntervalMs: 500,
    speedMultiplier: 1.5,
    damageMultiplier: 2,
    aura: {
      radius: 100,
      damagePerTick: 3,
      tickIntervalMs: 500,
      allySpeedMultiplier: 1.1,
      allyDamageMultiplier: 1.2,
      allyArmorPerTick: 2,
      lingerMs: 1_000,
    },
  } as any;
  const behavior = new PlayerUltimateBehaviorRuntime({
    playerManager: {
      getPlayer: (playerId: string) => players.find((player) => player.id === playerId),
      getAllPlayers: () => players,
    } as any,
    combatSystem,
    resourceSystem: {
      getRage: (playerId: string) => rage.get(playerId) ?? 0,
      getMaxRage: () => 600,
      addRage: (playerId: string, amount: number) => rage.set(playerId, (rage.get(playerId) ?? 0) + amount),
    },
    loadout: { getEquippedUltimateConfig: () => config },
    canInteract: () => true,
    isAlive: () => true,
    isUltimateBlocked: () => false,
    network: {
      teams: { isEnemyPair: (first: string, second: string) => first === 'p1' && second === 'enemy' },
      roundStats: { recordUltimateUsed },
    },
  });
  behavior.setArmageddonCapability(armageddon);
  return { behavior, config, rage, combatSystem, armageddon, recordUltimateUsed };
}

describe('PlayerUltimateBehaviorRuntime – Buff-/Armageddon-Lifecycle', () => {
  it('aktiviert Buff und Armageddon genau einmal bei einem retried Commit', () => {
    const { behavior, config, armageddon, recordUltimateUsed } = makeHarness();
    const request = {
      category: 'ultimate' as const,
      playerId: 'p1',
      angle: 0,
      targetX: 0,
      targetY: 0,
      hostNowMs: 1_000,
      attemptId: 'ultimate-1',
    };

    expect(behavior.execute(request)).toEqual({ ok: true });
    expect(behavior.execute({ ...request, hostNowMs: 1_100 })).toEqual({ ok: true });
    expect(behavior.isUltimateActive('p1')).toBe(true);
    expect(behavior.getActiveUltimateId('p1')).toBe(config.id);
    expect(armageddon.activate).toHaveBeenCalledOnce();
    expect(recordUltimateUsed).toHaveBeenCalledOnce();
    expect(behavior.getSpeedMultiplier('p1', 1_100)).toBe(1.5);
    expect(behavior.getDamageMultiplier('p2', 1_100)).toBe(1.2);
    expect(behavior.getDamageMultiplier('enemy', 1_100)).toBe(1);
  });

  it('drainiert Rage, führt Armor-/Aura-Ticks aus und beendet Armageddon mit Linger', () => {
    const { behavior, rage, combatSystem, armageddon } = makeHarness();
    behavior.execute({
      category: 'ultimate',
      playerId: 'p1',
      angle: 0,
      targetX: 0,
      targetY: 0,
      hostNowMs: 1_000,
    });

    behavior.update(16, 3_000);

    expect(rage.get('p1')).toBe(0);
    expect(combatSystem.addArmor).toHaveBeenCalledTimes(8);
    expect(combatSystem.applyAoeDamage).toHaveBeenCalledTimes(4);
    expect(armageddon.deactivate).toHaveBeenCalledWith('p1');
    expect(behavior.isUltimateActive('p1')).toBe(false);
    expect(behavior.getActiveUltimateId('p1')).toBeNull();
    expect(behavior.getSpeedMultiplier('p2', 3_500)).toBe(1.1);
    expect(behavior.getSpeedMultiplier('p2', 4_001)).toBe(1);
  });

  it('räumt Player- und World-Lifetime idempotent auf', () => {
    const { behavior, armageddon } = makeHarness();
    behavior.execute({ category: 'ultimate', playerId: 'p1', angle: 0, targetX: 0, targetY: 0, hostNowMs: 1_000 });

    behavior.removePlayer('p1');
    behavior.removePlayer('p1');
    behavior.destroy();
    behavior.destroy();

    expect(behavior.isUltimateActive('p1')).toBe(false);
    expect(armageddon.deactivate).toHaveBeenCalledOnce();
  });
});
