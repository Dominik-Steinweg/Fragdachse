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
    physics: { addRecoil: vi.fn() },
    gaussExecution: { fireGauss: vi.fn(() => true) },
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

function makeActivationHarness(config: any, initialRage = 400) {
  const rage = new Map([['p1', initialRage]]);
  const scheduleStrike = vi.fn(() => true);
  const placeTunnel = vi.fn(() => true);
  const fireGauss = vi.fn(() => true);
  const recordUltimateUsed = vi.fn();
  const behavior = new PlayerUltimateBehaviorRuntime({
    playerManager: {
      getPlayer: () => ({ id: 'p1', x: 10, y: 20, color: 0xabcdef }),
      getAllPlayers: () => [],
    } as any,
    combatSystem: { addArmor: vi.fn(), applyAoeDamage: vi.fn() },
    resourceSystem: {
      getRage: (playerId: string) => rage.get(playerId) ?? 0,
      getMaxRage: () => 600,
      addRage: (playerId: string, amount: number) => rage.set(playerId, (rage.get(playerId) ?? 0) + amount),
    },
    loadout: { getEquippedUltimateConfig: () => config },
    physics: { addRecoil: vi.fn() },
    gaussExecution: { fireGauss },
    canInteract: () => true,
    isAlive: () => true,
    isUltimateBlocked: () => false,
    network: {
      teams: { isEnemyPair: () => false },
      roundStats: { recordUltimateUsed },
    },
  });
  behavior.setAirstrikeCapability({ scheduleStrike });
  behavior.setTunnelPlacementCapability({ placeTunnel });
  return { behavior, rage, scheduleStrike, placeTunnel, fireGauss, recordUltimateUsed };
}

describe('PlayerUltimateBehaviorRuntime – Airstrike/Tunnel/Gauss-Commit', () => {
  it('committet Airstrike at-most-once und reicht die Host-Zeit an den Support-Owner', () => {
    const { behavior, rage, scheduleStrike, recordUltimateUsed } = makeActivationHarness(ULTIMATE_CONFIGS.AIRSTRIKE);
    const request = {
      category: 'ultimate' as const,
      playerId: 'p1',
      angle: 0,
      targetX: 120,
      targetY: 240,
      hostNowMs: 1_234,
      attemptId: 'airstrike-1',
    };

    expect(behavior.execute(request)).toEqual({ ok: true });
    expect(behavior.execute({ ...request, hostNowMs: 1_300 })).toEqual({ ok: true });
    expect(scheduleStrike).toHaveBeenCalledOnce();
    expect(scheduleStrike).toHaveBeenCalledWith('p1', 120, 240, ULTIMATE_CONFIGS.AIRSTRIKE, 1_234);
    expect(rage.get('p1')).toBe(200);
    expect(recordUltimateUsed).toHaveBeenCalledOnce();
  });

  it('ändert Rage nicht, wenn Airstrike-Commit oder Tunnel-Placement abgelehnt werden', () => {
    const airstrike = makeActivationHarness(ULTIMATE_CONFIGS.AIRSTRIKE);
    airstrike.scheduleStrike.mockReturnValue(false);
    expect(airstrike.behavior.execute({
      category: 'ultimate', playerId: 'p1', angle: 0, targetX: 1, targetY: 2, hostNowMs: 10,
    })).toEqual({ ok: false, reason: 'blocked' });
    expect(airstrike.rage.get('p1')).toBe(400);
    expect(airstrike.recordUltimateUsed).not.toHaveBeenCalled();

    const tunnel = makeActivationHarness(ULTIMATE_CONFIGS.DACHS_TUNNEL);
    tunnel.placeTunnel.mockReturnValue(false);
    expect(tunnel.behavior.execute({
      category: 'ultimate', playerId: 'p1', angle: 0, targetX: 100, targetY: 200, hostNowMs: 20,
      params: { tunnelAction: 'commit', tunnelStartGridX: 1, tunnelStartGridY: 2 },
    })).toEqual({ ok: false, reason: 'blocked' });
    expect(tunnel.rage.get('p1')).toBe(400);
    expect(tunnel.recordUltimateUsed).not.toHaveBeenCalled();
  });

  it('führt Tunnel nur mit Placement-Commit aus und dedupliziert den Commit', () => {
    const { behavior, rage, placeTunnel, recordUltimateUsed } = makeActivationHarness(ULTIMATE_CONFIGS.DACHS_TUNNEL);
    const request = {
      category: 'ultimate' as const,
      playerId: 'p1',
      angle: 0,
      targetX: 100,
      targetY: 200,
      hostNowMs: 30,
      attemptId: 'tunnel-1',
      params: { tunnelAction: 'commit' as const, tunnelStartGridX: 1, tunnelStartGridY: 2 },
      clientPosition: { x: 12, y: 24 },
    };

    expect(behavior.execute(request)).toEqual({ ok: true });
    expect(behavior.execute({ ...request, hostNowMs: 40 })).toEqual({ ok: true });
    expect(placeTunnel).toHaveBeenCalledOnce();
    expect(placeTunnel).toHaveBeenCalledWith(
      ULTIMATE_CONFIGS.DACHS_TUNNEL,
      'p1',
      12,
      24,
      100,
      200,
      0xabcdef,
      request.params,
    );
    expect(rage.get('p1')).toBe(200);
    expect(recordUltimateUsed).toHaveBeenCalledOnce();
  });

  it('berechnet Gauss-Vollladung ausschließlich aus Host-Zeit und hält Charge bei Execution-Reject', () => {
    const { behavior, rage, fireGauss, recordUltimateUsed } = makeActivationHarness(ULTIMATE_CONFIGS.GAUSS_RIFLE);
    fireGauss.mockReturnValueOnce(false);
    const press = {
      category: 'ultimate' as const,
      playerId: 'p1',
      angle: 0.5,
      targetX: 0,
      targetY: 0,
      hostNowMs: 100,
      params: { ultimateAction: 'press' as const },
    };
    expect(behavior.execute(press)).toEqual({ ok: true });
    expect(behavior.getUltimateChargeFraction('p1', 1_000)).toBeCloseTo(0.6);
    expect(behavior.execute({ ...press, hostNowMs: 1_700, params: { ultimateAction: 'release', ultimateChargeFraction: 0 } })).toEqual({ ok: false, reason: 'blocked' });
    expect(behavior.isUltimateCharging('p1')).toBe(true);
    expect(behavior.execute({ ...press, hostNowMs: 1_700, params: { ultimateAction: 'release', ultimateChargeFraction: 0 } })).toEqual({ ok: true });
    expect(fireGauss).toHaveBeenCalledTimes(2);
    expect(rage.get('p1')).toBe(200);
    expect(recordUltimateUsed).toHaveBeenCalledOnce();
  });
});
