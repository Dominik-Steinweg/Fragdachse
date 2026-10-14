import { describe, expect, it, vi } from 'vitest';
import { PlayerUltimateBehaviorRuntime, type PlayerUltimateDeploymentResult,
  type PlayerUltimateHoloOffensiveRequest, type PlayerUltimateBomberSquadronRequest,
} from '../src/world/PlayerUltimateBehaviorRuntime';
import { ULTIMATE_CONFIGS } from '../src/loadout/LoadoutConfig';
import type { HoloOffensiveUltimateConfig, BomberSquadronUltimateConfig } from '../src/loadout/LoadoutTypes';

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
    relationship: { isEnemyPair: (first: string, second: string) => first === 'p1' && second === 'enemy' },
    roundStats: { recordUltimateUsed },
  });
  behavior.setArmageddonCapability(armageddon);
  return { behavior, config, rage, combatSystem, armageddon, recordUltimateUsed };
}

describe('PlayerUltimateBehaviorRuntime – Buff-/Armageddon-Lifecycle', () => {
  it('interrupts active combat without generating catch-up effects after the stun', () => {
    const f = makeHarness();
    f.behavior.execute({ category: 'ultimate', playerId: 'p1', angle: 0, targetX: 0, targetY: 0, hostNowMs: 1000 });
    f.behavior.interruptCombat('p1', 1100);
    f.behavior.update(1000, 2100);
    expect(f.behavior.isUltimateActive('p1')).toBe(false);
    expect(f.armageddon.deactivate).toHaveBeenCalledOnce();
    expect(f.combatSystem.applyAoeDamage).not.toHaveBeenCalled();
    expect(f.combatSystem.addArmor).not.toHaveBeenCalled();
  });

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
  const reveal = vi.fn();
  const rage = new Map([['p1', initialRage]]);
  const scheduleStrike = vi.fn(() => true);
  const placeTunnel = vi.fn(() => true);
  const canStartTunnel = vi.fn(() => true);
  const fireGauss = vi.fn(() => true);
  const canInteract = vi.fn(() => true);
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
    canInteract,
    breakStealth: reveal,
    isAlive: () => true,
    isUltimateBlocked: () => false,
    relationship: { isEnemyPair: () => false },
    roundStats: { recordUltimateUsed },
  });
  behavior.setAirstrikeCapability({ scheduleStrike });
  behavior.setTunnelPlacementCapability({ placeTunnel, canStartTunnel });
  return { behavior, reveal, rage, scheduleStrike, placeTunnel, canStartTunnel, fireGauss, canInteract, recordUltimateUsed };
}

// Independent capability fixtures: these tests protect resource/lifecycle rules, not authored tuning.
const holoConfig: HoloOffensiveUltimateConfig = {
  id: 'HOLO_OFFENSIVE', type: 'holo_offensive', cooldown: 0, rageRequired: 300,
  ragePerSpawnSecond: 50, spawnIntervalMs: 750, copyLifetimeMs: 6000, materializeMs: 400,
  spawnRingRadiiPx: [120, 80, 160], spawnRingSlots: 12, clearanceRadiusPx: 16,
  minCopySpacingPx: 32, injectorProjectionEnabled: 0,
};
const bomberConfig: BomberSquadronUltimateConfig = {
  id: 'BOMBER_SQUADRON', type: 'bomber_squadron', cooldown: 0, rageRequired: 300, rageCost: 300,
  droneCount: 3, launchIntervalMs: 250, approachMs: 600, approachDistancePx: 240,
  runSpeedPxPerSec: 240, bombsPerPass: 6, secondPassEnabled: 0, corridorLeadPx: 48,
  corridorLengthPx: 640, corridorWidthPx: 560, turnMs: 1000, departureMs: 600,
  bombFallMs: 400, explosionRadius: 64, maxDamage: 100, minDamage: 20, fireChunksPerBomb: 0,
};

function makeDeploymentHarness(config: HoloOffensiveUltimateConfig | BomberSquadronUltimateConfig, rage = 600) {
  const f = makeActivationHarness(config, rage);
  const fake = () => {
    const owners = new Set<string>();
    return {
      owners,
      tryActivate: vi.fn((request: PlayerUltimateHoloOffensiveRequest | PlayerUltimateBomberSquadronRequest): PlayerUltimateDeploymentResult => {
        owners.add(request.playerId);
        return { ok: true };
      }),
      isActive: vi.fn((ownerId: string) => owners.has(ownerId)),
      removeOwner: vi.fn((ownerId: string) => { owners.delete(ownerId); }),
    };
  };
  const holo = { ...fake(), stopSpawning: vi.fn() };
  const bomber = { ...fake(), cancelUnlaunched: vi.fn() };
  f.behavior.setHoloOffensiveCapability(holo);
  f.behavior.setBomberSquadronCapability(bomber);
  const capability = config.type === 'holo_offensive' ? holo : bomber;
  const request = { category: 'ultimate' as const, playerId: 'p1', angle: .7,
    targetX: 100, targetY: 200, hostNowMs: 1000, attemptId: 'deployment-1' };
  return { ...f, holo, bomber, capability, request };
}

describe('PlayerUltimateBehaviorRuntime – Holo/Bomber deployment capabilities', () => {
  it.each([holoConfig, bomberConfig])('commits $id once, retains new rage, and locks until its capability ends', config => {
    const f = makeDeploymentHarness(config);
    expect(f.behavior.isUltimateActive('p1')).toBe(false);
    expect(f.behavior.getActiveUltimateId('p1')).toBeNull();
    expect(f.behavior.execute(f.request)).toEqual({ ok: true });
    const consumed = config.type === 'holo_offensive' ? 600 : config.rageCost;
    expect(f.rage.get('p1')).toBe(600 - consumed);
    expect(f.capability.tryActivate).toHaveBeenCalledExactlyOnceWith(config.type === 'holo_offensive'
      ? { playerId: 'p1', config, consumedRage: consumed, nowMs: f.request.hostNowMs }
      : { playerId: 'p1', config, angle: f.request.angle, nowMs: f.request.hostNowMs });
    expect(f.behavior.isUltimateActive('p1')).toBe(true);
    expect(f.behavior.getActiveUltimateId('p1')).toBe(config.id);
    f.rage.set('p1', 600);
    f.behavior.update(10_000, 11_000);
    expect(f.rage.get('p1')).toBe(600);
    expect(f.behavior.execute({ ...f.request, hostNowMs: 12_000 })).toEqual({ ok: true });
    expect(f.behavior.execute({ ...f.request, attemptId: 'deployment-2' })).toEqual({ ok: false, reason: 'blocked' });
    expect(f.rage.get('p1')).toBe(600);
    expect(f.capability.tryActivate).toHaveBeenCalledOnce();
    expect(f.recordUltimateUsed).toHaveBeenCalledOnce();
    f.behavior.interruptCombat('p1', 12_000);
    expect(f.behavior.isUltimateActive('p1')).toBe(true);
    expect(f.behavior.getActiveUltimateId('p1')).toBe(config.id);
    expect(f.holo.stopSpawning).not.toHaveBeenCalled();
    expect(f.bomber.cancelUnlaunched).not.toHaveBeenCalled();
    expect(f.holo.removeOwner).not.toHaveBeenCalled();
    expect(f.bomber.removeOwner).not.toHaveBeenCalled();
    f.capability.owners.clear();
    expect(f.behavior.isUltimateActive('p1')).toBe(false);
    expect(f.behavior.getActiveUltimateId('p1')).toBeNull();
    // A late retry must not resurrect a completed deployment either.
    expect(f.behavior.execute(f.request)).toEqual({ ok: true });
    expect(f.capability.tryActivate).toHaveBeenCalledOnce();
    expect(f.behavior.execute({ ...f.request, attemptId: 'deployment-2' })).toEqual({ ok: true });
    expect(f.capability.tryActivate).toHaveBeenCalledTimes(2);
    expect(f.rage.get('p1')).toBe(600 - consumed);
  });

  it('caps consumed Holo rage at the resource maximum', () => {
    const f = makeDeploymentHarness(holoConfig, 700);
    expect(f.behavior.execute(f.request)).toEqual({ ok: true });
    expect(f.holo.tryActivate).toHaveBeenCalledWith(expect.objectContaining({ consumedRage: 600 }));
    expect(f.rage.get('p1')).toBe(100);
  });

  it.each([holoConfig, bomberConfig])('forwards $id failures without spending rage or committing the attempt', config => {
    for (const reason of ['no_fire_sources', 'placement', 'blocked'] as const) {
      const f = makeDeploymentHarness(config);
      f.capability.tryActivate.mockReturnValueOnce({ ok: false, reason });
      expect(f.behavior.execute(f.request)).toEqual({ ok: false, reason });
      expect(f.rage.get('p1')).toBe(600);
      expect(f.behavior.isUltimateActive('p1')).toBe(false);
      expect(f.recordUltimateUsed).not.toHaveBeenCalled();
      expect(f.reveal).not.toHaveBeenCalled();
      expect(f.behavior.execute(f.request)).toEqual({ ok: true });
      expect(f.capability.tryActivate).toHaveBeenCalledTimes(2);
      expect(f.recordUltimateUsed).toHaveBeenCalledOnce();
    }
  });

  it.each([holoConfig, bomberConfig])('rejects $id below the required rage and while the other deployment is active', config => {
    const f = makeDeploymentHarness(config, config.rageRequired - 1);
    expect(f.behavior.execute(f.request)).toEqual({ ok: false, reason: 'resource', resourceKind: 'rage' });
    expect(f.capability.tryActivate).not.toHaveBeenCalled();
    f.rage.set('p1', 600);
    const other = config.type === 'holo_offensive' ? f.bomber : f.holo;
    other.owners.add('p1');
    expect(f.behavior.execute(f.request)).toEqual({ ok: false, reason: 'blocked' });
    expect(f.capability.tryActivate).not.toHaveBeenCalled();
    expect(f.rage.get('p1')).toBe(600);
  });

  it.each(['resetPlayer', 'removePlayer'] as const)('%s forwards cleanup to both capabilities and isolates other owners', method => {
    const f = makeDeploymentHarness(holoConfig);
    f.holo.owners.add('p1'); f.holo.owners.add('p2');
    f.bomber.owners.add('p1'); f.bomber.owners.add('p2');
    f.behavior[method]('p1');
    expect(f.holo.removeOwner).toHaveBeenCalledExactlyOnceWith('p1');
    expect(f.bomber.removeOwner).toHaveBeenCalledExactlyOnceWith('p1');
    expect(f.behavior.isUltimateActive('p1')).toBe(false);
    expect(f.behavior.getActiveUltimateId('p1')).toBeNull();
    expect(f.behavior.isUltimateActive('p2')).toBe(true);
  });
});

describe('PlayerUltimateBehaviorRuntime – Airstrike/Tunnel/Gauss-Commit', () => {
  it('does not turn a delayed tunnel selection into a newly equipped ultimate', () => {
    const f = makeActivationHarness(ULTIMATE_CONFIGS.AIRSTRIKE);
    expect(f.behavior.execute({ category: 'ultimate', playerId: 'p1', angle: 0,
      targetX: 100, targetY: 200, hostNowMs: 10, params: { tunnelAction: 'begin',
        tunnelPlacementId: 'old-tunnel', tunnelStartGridX: 1, tunnelStartGridY: 2 },
    }).ok).toBe(false);
    expect(f.scheduleStrike).not.toHaveBeenCalled();
    expect(f.rage.get('p1')).toBe(400);
  });

  it('rejects a tunnel commit without a host-observed first selection', () => {
    const f = makeActivationHarness(ULTIMATE_CONFIGS.DACHS_TUNNEL);
    expect(f.behavior.execute({ category: 'ultimate', playerId: 'p1', angle: 0,
      targetX: 100, targetY: 200, hostNowMs: 10,
      params: { tunnelAction: 'commit', tunnelStartGridX: 40, tunnelStartGridY: 40 },
    })).toEqual({ ok: false, reason: 'blocked' });
    expect(f.placeTunnel).not.toHaveBeenCalled();
    expect(f.rage.get('p1')).toBe(400);
  });

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
    expect(tunnel.behavior.execute({ category: 'ultimate', playerId: 'p1', angle: 0,
      targetX: 10, targetY: 20, hostNowMs: 10,
      params: { tunnelAction: 'begin', tunnelPlacementId: 'selection', tunnelStartGridX: 1, tunnelStartGridY: 2 },
    }).ok).toBe(true);
    expect(tunnel.behavior.execute({
      category: 'ultimate', playerId: 'p1', angle: 0, targetX: 100, targetY: 200, hostNowMs: 20,
      params: { tunnelAction: 'commit', tunnelPlacementId: 'selection' },
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
      params: { tunnelAction: 'commit' as const, tunnelPlacementId: 'selection' },
      clientPosition: { x: 12, y: 24 },
    };

    expect(behavior.execute({ ...request, attemptId: undefined, params: {
      tunnelAction: 'begin', tunnelPlacementId: 'selection', tunnelStartGridX: 1, tunnelStartGridY: 2,
    } })).toEqual({ ok: true });
    expect(rage.get('p1')).toBe(400);
    expect(recordUltimateUsed).not.toHaveBeenCalled();
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
      { ...request.params, tunnelStartGridX: 1, tunnelStartGridY: 2 },
    );
    expect(rage.get('p1')).toBe(200);
    expect(recordUltimateUsed).toHaveBeenCalledOnce();
  });

  it.each(['cancel', 'interrupt', 'reset', 'remove', 'destroy'])('invalidates the tunnel selection on %s', boundary => {
    const f = makeActivationHarness(ULTIMATE_CONFIGS.DACHS_TUNNEL);
    const request = { category: 'ultimate' as const, playerId: 'p1', angle: 0,
      targetX: 10, targetY: 20, hostNowMs: 10 };
    expect(f.behavior.execute({ ...request, params: { tunnelAction: 'begin',
      tunnelPlacementId: 'a', tunnelStartGridX: 1, tunnelStartGridY: 2 } }).ok).toBe(true);
    expect(f.reveal).not.toHaveBeenCalled();
    if (boundary === 'cancel') {
      f.canInteract.mockReturnValue(false);
      expect(f.behavior.execute({ ...request, params: { tunnelAction: 'cancel', tunnelPlacementId: 'a' } }).ok).toBe(true);
      f.canInteract.mockReturnValue(true);
    }
    if (boundary === 'interrupt') f.behavior.interruptCombat('p1', 11);
    if (boundary === 'reset') f.behavior.resetPlayer('p1');
    if (boundary === 'remove') f.behavior.removePlayer('p1');
    if (boundary === 'destroy') f.behavior.destroy();
    expect(f.behavior.execute({ ...request, params: { tunnelAction: 'commit', tunnelPlacementId: 'a' } }).ok).toBe(false);
    expect(f.placeTunnel).not.toHaveBeenCalled();
    expect(f.rage.get('p1')).toBe(400);
  });

  it('isolates a new selection from old cancels and forged commit coordinates', () => {
    const f = makeActivationHarness(ULTIMATE_CONFIGS.DACHS_TUNNEL);
    const request = { category: 'ultimate' as const, playerId: 'p1', angle: 0,
      targetX: 10, targetY: 20, hostNowMs: 10 };
    for (const id of ['a', 'b']) expect(f.behavior.execute({ ...request, params: { tunnelAction: 'begin',
      tunnelPlacementId: id, tunnelStartGridX: 1, tunnelStartGridY: 2 } }).ok).toBe(true);
    f.behavior.execute({ ...request, params: { tunnelAction: 'cancel', tunnelPlacementId: 'a' } });
    expect(f.behavior.execute({ ...request, params: { tunnelAction: 'commit', tunnelPlacementId: 'a' } }).ok).toBe(false);
    expect(f.behavior.execute({ ...request, params: { tunnelAction: 'commit', tunnelPlacementId: 'b',
      tunnelStartGridX: 100, tunnelStartGridY: 100 } }).ok).toBe(true);
    expect(f.placeTunnel.mock.calls[0].at(-1)).toMatchObject({ tunnelStartGridX: 1, tunnelStartGridY: 2 });
    expect(f.behavior.execute({ ...request, params: { tunnelAction: 'commit', tunnelPlacementId: 'b' } }).ok).toBe(false);
    expect(f.placeTunnel).toHaveBeenCalledOnce();
    expect(f.rage.get('p1')).toBe(200);
  });

  it('berechnet Gauss-Vollladung ausschließlich aus Host-Zeit und hält Charge bei Execution-Reject', () => {
    const { behavior, reveal, rage, fireGauss, recordUltimateUsed } = makeActivationHarness(ULTIMATE_CONFIGS.GAUSS_RIFLE);
    fireGauss.mockReturnValueOnce(false);
    const press = {
      category: 'ultimate' as const,
      playerId: 'p1',
      angle: 0.5,
      targetX: 0,
      targetY: 0,
      hostNowMs: 100,
      params: { ultimateAction: 'press' as const, gaussChargeId: 'charge-a' },
    };
    expect(behavior.execute(press)).toEqual({ ok: true });
    expect(reveal).not.toHaveBeenCalled();
    expect(behavior.getUltimateChargeFraction('p1', 1_000)).toBeCloseTo(0.6);
    expect(behavior.execute({ ...press, hostNowMs: 1_700, params: { ultimateAction: 'release', gaussChargeId: 'charge-a', attemptId: 'gauss-commit-a' } })).toEqual({ ok: false, reason: 'blocked' });
    expect(behavior.isUltimateCharging('p1')).toBe(true);
    expect(behavior.execute({ ...press, hostNowMs: 1_700, params: { ultimateAction: 'release', gaussChargeId: 'charge-a', attemptId: 'gauss-commit-a' } })).toEqual({ ok: true });
    expect(fireGauss).toHaveBeenCalledTimes(2);
    expect(reveal).toHaveBeenCalledExactlyOnceWith('p1', 1700);
    expect(rage.get('p1')).toBe(200);
    expect(recordUltimateUsed).toHaveBeenCalledOnce();
  });

  it('beendet eine frühe Release-Anfrage als Cancel und feuert später nur eine neue Charge', () => {
    const { behavior, rage, fireGauss, recordUltimateUsed } = makeActivationHarness(ULTIMATE_CONFIGS.GAUSS_RIFLE);
    const pressA = {
      category: 'ultimate' as const, playerId: 'p1', angle: 0, targetX: 0, targetY: 0,
      hostNowMs: 100, params: { ultimateAction: 'press' as const, gaussChargeId: 'charge-a' },
    };

    expect(behavior.execute(pressA)).toEqual({ ok: true });
    expect(behavior.execute({ ...pressA, hostNowMs: 200, params: { ultimateAction: 'cancel', gaussChargeId: 'charge-a' } })).toEqual({ ok: true });
    expect(behavior.isUltimateCharging('p1')).toBe(false);
    expect(fireGauss).not.toHaveBeenCalled();

    expect(behavior.execute({ ...pressA, hostNowMs: 300, params: { ultimateAction: 'press', gaussChargeId: 'charge-b' } })).toEqual({ ok: true });
    expect(behavior.execute({ ...pressA, hostNowMs: 1_900, params: { ultimateAction: 'release', gaussChargeId: 'charge-b', attemptId: 'gauss-commit-b' } })).toEqual({ ok: true });
    expect(fireGauss).toHaveBeenCalledOnce();
    expect(rage.get('p1')).toBe(200);
    expect(recordUltimateUsed).toHaveBeenCalledOnce();
  });

  it('lässt eine verspätete Charge-A-Anfrage niemals Charge-B verändern', () => {
    const { behavior, canInteract, fireGauss } = makeActivationHarness(ULTIMATE_CONFIGS.GAUSS_RIFLE);
    const base = { category: 'ultimate' as const, playerId: 'p1', angle: 0, targetX: 0, targetY: 0 };

    expect(behavior.execute({ ...base, hostNowMs: 100, params: { ultimateAction: 'press', gaussChargeId: 'charge-a' } })).toEqual({ ok: true });
    expect(behavior.execute({ ...base, hostNowMs: 150, params: { ultimateAction: 'cancel', gaussChargeId: 'charge-a' } })).toEqual({ ok: true });
    expect(behavior.execute({ ...base, hostNowMs: 300, params: { ultimateAction: 'press', gaussChargeId: 'charge-b' } })).toEqual({ ok: true });

    expect(behavior.execute({ ...base, hostNowMs: 1_700, params: { ultimateAction: 'release', gaussChargeId: 'charge-a', attemptId: 'gauss-commit-a' } })).toEqual({ ok: false, reason: 'blocked' });
    expect(behavior.isUltimateCharging('p1')).toBe(true);
    expect(fireGauss).not.toHaveBeenCalled();

    canInteract.mockReturnValue(false);
    expect(behavior.execute({ ...base, hostNowMs: 350, params: { ultimateAction: 'cancel', gaussChargeId: 'charge-b' } })).toEqual({ ok: true });
    expect(behavior.isUltimateCharging('p1')).toBe(false);
    expect(fireGauss).not.toHaveBeenCalled();
  });

  it('verhindert eine Wiederbelebung derselben Charge-ID nach Reset und lässt einen neuen Versuch zu', () => {
    const { behavior, fireGauss } = makeActivationHarness(ULTIMATE_CONFIGS.GAUSS_RIFLE);
    const base = { category: 'ultimate' as const, playerId: 'p1', angle: 0, targetX: 0, targetY: 0 };
    expect(behavior.execute({ ...base, hostNowMs: 100, params: { ultimateAction: 'press', gaussChargeId: 'charge-a' } })).toEqual({ ok: true });

    behavior.resetPlayer('p1');
    expect(behavior.execute({ ...base, hostNowMs: 1_700, params: { ultimateAction: 'release', gaussChargeId: 'charge-a', attemptId: 'gauss-commit-a' } })).toEqual({ ok: false, reason: 'blocked' });
    expect(behavior.execute({ ...base, hostNowMs: 200, params: { ultimateAction: 'press', gaussChargeId: 'charge-a' } })).toEqual({ ok: false, reason: 'blocked' });
    expect(behavior.execute({ ...base, hostNowMs: 300, params: { ultimateAction: 'press', gaussChargeId: 'charge-b' } })).toEqual({ ok: true });
    expect(behavior.execute({ ...base, hostNowMs: 1_900, params: { ultimateAction: 'release', gaussChargeId: 'charge-b', attemptId: 'gauss-commit-b' } })).toEqual({ ok: true });
    expect(fireGauss).toHaveBeenCalledOnce();
  });

  it('weist eine ungültige Attempt-ID vor dem Ultimate-Commit zurück', () => {
    const { behavior, rage, scheduleStrike, recordUltimateUsed } = makeActivationHarness(ULTIMATE_CONFIGS.AIRSTRIKE, 600);
    const result = behavior.execute({
      category: 'ultimate', playerId: 'p1', angle: 0, targetX: 1, targetY: 2, hostNowMs: 100,
      attemptId: ' invalid',
    } as never);

    expect(result).toEqual({ ok: false, reason: 'invalid' });
    expect(scheduleStrike).not.toHaveBeenCalled();
    expect(rage.get('p1')).toBe(600);
    expect(recordUltimateUsed).not.toHaveBeenCalled();
  });

  it('begrenzt die Commit-Historie pro Spieler', () => {
    const { behavior, rage } = makeActivationHarness(ULTIMATE_CONFIGS.AIRSTRIKE, 20_000);
    for (let index = 0; index < 80; index += 1) {
      expect(behavior.execute({
        category: 'ultimate', playerId: 'p1', angle: 0, targetX: index, targetY: 2,
        hostNowMs: 100 + index, attemptId: `airstrike-${index}`,
      })).toEqual({ ok: true });
    }

    const histories = (behavior as unknown as {
      committedAttempts: Map<string, Map<string, unknown>>;
    }).committedAttempts;
    expect(histories.get('p1')?.size).toBeLessThanOrEqual(64);
    expect(rage.get('p1')).toBeGreaterThan(0);
  });
});
