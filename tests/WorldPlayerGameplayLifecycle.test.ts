import { describe, expect, it, vi } from 'vitest';

// Teilphase 2A: die öffentliche Player-in-World-/Reconcile-Lifecycle-Grenze der
// WorldPlayerGameplayRuntime (Contract-Familie PlayerGameplayLifecyclePort).
// Der Test fixiert, dass jede Operation genau die bisher im ArenaLifecycleCoordinator
// verstreuten Child-System-Schritte in unveränderter Reihenfolge kapselt.

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Distance: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) },
  },
}));

import { WorldPlayerGameplayRuntime } from '../src/world/WorldPlayerGameplayRuntime';
import { LoadoutManager } from '../src/loadout/LoadoutManager';
import { CoopDefenseItemRuntimeSystem } from '../src/systems/CoopDefenseItemRuntimeSystem';
import { CoopDefensePlayerModifierSystem } from '../src/systems/CoopDefensePlayerModifierSystem';
import { HostHeldActionSystem } from '../src/systems/HostHeldActionSystem';
import { ResourceSystem } from '../src/systems/ResourceSystem';
import { BurrowSystem } from '../src/systems/BurrowSystem';
import { TunnelSystem } from '../src/systems/TunnelSystem';

type AnyRuntime = WorldPlayerGameplayRuntime & Record<string, any>;

function makeRuntime() {
  const order: string[] = [];
  const tag = (name: string, fn: (...args: any[]) => any = () => undefined) =>
    vi.fn((...args: any[]) => { order.push(name); return fn(...args); });

  const drainUnsub = vi.fn();
  const gainUnsub = vi.fn();
  const systems: Record<string, any> = {
    resource: {
      initPlayer: tag('resource.initPlayer'),
      removePlayer: tag('resource.removePlayer'),
      reconcilePlayerLimits: tag('resource.reconcilePlayerLimits'),
      getAdrenaline: vi.fn(() => 55),
      getAdrenalineRevision: vi.fn(() => 7),
      getMaxAdrenaline: vi.fn(() => 100),
      addAdrenalineDrainObserver: vi.fn(() => drainUnsub),
      addAdrenalineGainObserver: vi.fn(() => gainUnsub),
    },
    burrow: {
      initPlayer: tag('burrow.initPlayer'),
      removePlayer: tag('burrow.removePlayer'),
      isBurrowed: vi.fn((playerId: string) => playerId === 'buried'),
      isStunned: vi.fn((playerId: string) => playerId === 'zapped'),
    },
    itemRuntime: {
      initPlayer: tag('itemRuntime.initPlayer'),
      removePlayer: tag('itemRuntime.removePlayer'),
    },
    loadout: {
      assignDefaultLoadout: tag('loadout.assignDefaultLoadout'),
      removePlayer: tag('loadout.removePlayer'),
      syncSelectedLoadout: tag('loadout.syncSelectedLoadout'),
      getEquippedUtilityConfig: vi.fn(() => ({ id: 'DECOY' })),
      getTemporaryUtilityConfig: vi.fn(() => ({ id: 'BFG' })),
    },
    ultimateBehavior: {
      resetPlayer: tag('ultimateBehavior.resetPlayer'),
      removePlayer: tag('ultimateBehavior.removePlayer'),
      destroy: tag('ultimateBehavior.destroy'),
      isUltimateActive: vi.fn(() => false),
      getActiveUltimateId: vi.fn(() => null),
    },
    ak47Behavior: {
      resetPlayer: tag('ak47Behavior.resetPlayer'),
      removePlayer: tag('ak47Behavior.removePlayer'),
      destroy: tag('ak47Behavior.destroy'),
    },
    negevBehavior: {
      resetPlayer: tag('negevBehavior.resetPlayer'),
      removePlayer: tag('negevBehavior.removePlayer'),
      destroy: tag('negevBehavior.destroy'),
    },
    utilityAction: {
      syncEquippedUtility: vi.fn(),
      removePlayer: vi.fn(),
      getTemporaryUtilityConfig: vi.fn(() => ({ id: 'BFG' })),
      destroy: vi.fn(),
    },
    tunnel: {
      removePlayer: tag('tunnel.removePlayer'),
      getSnapshot: vi.fn(() => ['tunnel-snap']),
    },
    translocator: {
      getActivePuckId: vi.fn((playerId: string) => (playerId === 'withPuck' ? 42 : undefined)),
      removePlayer: vi.fn(),
    },
    heldAction: {
      clearPlayer: tag('heldAction.clearPlayer'),
      reset: tag('heldAction.reset'),
    },
    playerModifier: {
      syncPlayers: vi.fn(() => [] as readonly string[]),
      getClassId: vi.fn((playerId: string) => (playerId === 'p1' ? 'dachs_of_steel' : null)),
    },
    ak47StrategicTarget: {
      getNetSnapshot: vi.fn((now: number) => [{ now }]),
    },
  };

  const runtime = Object.create(WorldPlayerGameplayRuntime.prototype) as AnyRuntime;
  runtime.systems = systems;
  runtime.options = {
    playerManager: {
      hasPlayer: (playerId: string) => playerId !== 'absent',
    },
    decoySystem: { clearPlayer: vi.fn() },
  };
  return { runtime, systems, order, drainUnsub, gainUnsub };
}

function makeConcreteRemoveRuntime() {
  const playerId = 'p1';
  const playerManager = {
    getPlayer: () => undefined,
    getAllPlayers: () => [{ id: playerId }],
  };
  const resource = new ResourceSystem();
  const burrow = new BurrowSystem(
    resource,
    playerManager as never,
    { isAlive: () => true } as never,
    { setPlayerBurrowed: vi.fn() } as never,
    { broadcastBurrowVisual: vi.fn() } as never,
  );
  const itemRuntime = new CoopDefenseItemRuntimeSystem({
    getAffixValue: () => 1,
    getPlayerHp: () => null,
  });
  const heldAction = new HostHeldActionSystem();
  const playerModifier = new CoopDefensePlayerModifierSystem();
  const loadoutBridge = {
    getGameMode: () => 'coop_defense' as const,
    publishUtilityCooldownUntil: vi.fn(),
    publishTemporaryUtilityInstances: vi.fn(),
    publishHeldUtilityId: vi.fn(),
  };
  const loadout = new LoadoutManager(
    playerManager as never,
    {} as never,
    resource,
    loadoutBridge as never,
  );
  const placement = {
    canPlaceSingleCell: vi.fn(() => true),
    getClampedTargetCell: vi.fn(() => ({ gridX: 1, gridY: 0 })),
    getWorldPointForCell: vi.fn((gridX: number, gridY: number) => ({ x: gridX * 100, y: gridY * 100 })),
    doesGridSegmentCrossClosedBarrier: vi.fn(() => false),
  };
  const tunnel = new TunnelSystem(
    playerManager as never,
    {} as never,
    placement as never,
    burrow,
    { clearForcedMovement: vi.fn() } as never,
  );
  const translocator = {
    removePlayer: vi.fn(),
  };
  const runtime = Object.create(WorldPlayerGameplayRuntime.prototype) as AnyRuntime;
  runtime.systems = {
    resource,
    burrow,
    itemRuntime,
    loadout,
    ultimateBehavior: { removePlayer: vi.fn() },
    negevBehavior: { removePlayer: vi.fn(), destroy: vi.fn() },
    tunnel,
    heldAction,
    playerModifier,
    translocator,
    utilityAction: { removePlayer: vi.fn(), destroy: vi.fn() },
    ak47Behavior: { removePlayer: vi.fn(), destroy: vi.fn() },
  };
  runtime.options = { decoySystem: { clearPlayer: vi.fn() } };
  return {
    runtime,
    playerId,
    resource,
    burrow,
    itemRuntime,
    loadout,
    tunnel,
  };
}

function makeDestroyRuntime() {
  const setterNames = [
    'setAk47Behavior',
    'setNegevBehavior',
    'setCombatSystem',
    'setWeaponExecutionCapability',
    'setSpecializedWeaponExecutionCapability',
    'setPhysicsSystem',
    'setUtilityConfigModifierSource',
    'setItemRuntimeChargeConsumer',
    'setItemRuntimeWeaponFiredHandler',
    'setUltimateModifierReadPort',
  ];
  const resourceSetterNames = [
    'setPowerUpSystem',
    'setAdrenalineMaxResolver',
    'setAdrenalineRegenRateResolver',
    'setRageMaxResolver',
    'setRageGainMultiplierResolver',
    'setAdrenalineGainMultiplierResolver',
    'setAdrenalineCostMultiplierResolver',
    'setAdrenalineSpawnFullResolver',
  ];
  const burrowSetterNames = [
    'setWorldMetrics',
    'setStinkCloudSystem',
    'setBurrowStartCallback',
    'setPositionResetCallback',
    'setTunnelTransitEndedCallback',
    'setUndergroundSpeedResolver',
    'setDrainMultiplierResolver',
    'setShockwaveDamageResolver',
    'setShockwaveRadiusResolver',
  ];
  const loadout = Object.fromEntries([
    ...setterNames,
  ].map((name) => [name, vi.fn()]));
  const resource = Object.fromEntries([
    ...resourceSetterNames,
    'removePlayer',
  ].map((name) => [name, vi.fn()]));
  const burrow = Object.fromEntries([
    ...burrowSetterNames,
    'removePlayer',
  ].map((name) => [name, vi.fn()]));
  const translocator = {
    setUseCallback: vi.fn(),
    setRadialImpulseCallback: vi.fn(),
    setPositionResetCallback: vi.fn(),
    removePlayer: vi.fn(),
  };
  const systems = {
    loadout,
    ultimateBehavior: { destroy: vi.fn() },
    ak47Behavior: { destroy: vi.fn() },
    negevBehavior: { destroy: vi.fn() },
    utilityAction: { removePlayer: vi.fn(), destroy: vi.fn() },
    heldAction: { reset: vi.fn() },
    guardianSpirit: { clear: vi.fn() },
    repairDrone: { clear: vi.fn() },
    slimeTrail: { clear: vi.fn() },
    flamethrowerUpgrade: { clear: vi.fn() },
    weaponUpgrade: { clear: vi.fn() },
    ak47StrategicTarget: { clear: vi.fn() },
    tunnel: { clear: vi.fn() },
    translocator,
    resource,
    burrow,
    playerModifier: { clear: vi.fn() },
    itemRuntime: { clear: vi.fn() },
  };
  const runtime = Object.create(WorldPlayerGameplayRuntime.prototype) as AnyRuntime;
  runtime.systems = systems;
  runtime.options = {
    playerManager: {
      getAllPlayers: () => [{ id: 'p1' }],
    },
    decoySystem: { clearPlayer: vi.fn() },
  };
  return { runtime, systems };
}

describe('WorldPlayerGameplayRuntime – öffentliche Lifecycle-Grenze (2A)', () => {
  it('kapselt Player-in-World-Attach je Child-System', () => {
    const { runtime, systems } = makeRuntime();

    runtime.attachPlayerResources('p1');
    runtime.attachPlayerBurrow('p1');
    runtime.attachPlayerBuild('p1');

    expect(systems.resource.initPlayer).toHaveBeenCalledWith('p1');
    expect(systems.burrow.initPlayer).toHaveBeenCalledWith('p1');
    expect(systems.itemRuntime.initPlayer).toHaveBeenCalledWith('p1');
  });

  it('setzt beim Loadout-Attach erst den Ultimate-State zurück, dann das Default-Loadout', () => {
    const { runtime, systems, order } = makeRuntime();
    const selection = { weapon1: undefined } as never;

    runtime.attachPlayerLoadout('p1', selection);

    expect(order).toEqual([
      'ultimateBehavior.resetPlayer',
      'ak47Behavior.resetPlayer',
      'negevBehavior.resetPlayer',
      'loadout.assignDefaultLoadout',
    ]);
    expect(systems.loadout.assignDefaultLoadout).toHaveBeenCalledWith('p1', selection);
  });

  it('baut beim Loadout-Detach Loadout und Tunnel ab', () => {
    const { runtime, order } = makeRuntime();

    runtime.detachPlayerLoadout('p1');

    expect(order).toEqual([
      'ultimateBehavior.removePlayer',
      'ak47Behavior.removePlayer',
      'negevBehavior.removePlayer',
      'loadout.removePlayer',
      'tunnel.removePlayer',
    ]);
  });

  it('reconciled Loadout-Auswahl und Ressourcenmaxima zusammen', () => {
    const { runtime, systems, order } = makeRuntime();
    const selection = { weapon2: undefined } as never;

    runtime.reconcilePlayerLoadout('p1', selection);

    expect(order).toEqual(['loadout.syncSelectedLoadout', 'resource.reconcilePlayerLimits']);
    expect(systems.loadout.syncSelectedLoadout).toHaveBeenCalledWith('p1', selection);
  });

  it('invalidiert Held Actions pro Spieler bzw. am Activity-Identity-Ende', () => {
    const { runtime, systems } = makeRuntime();

    runtime.invalidateHeldActionsForPlayer('p1');
    runtime.invalidateHeldActionsOnActivityEnd();

    expect(systems.heldAction.clearPlayer).toHaveBeenCalledWith('p1');
    expect(systems.heldAction.reset).toHaveBeenCalledTimes(1);
  });
});

describe('WorldPlayerGameplayRuntime.reconcilePlayerBuildModifiers (2A)', () => {
  it('materialisiert die Item-Runtime nur für geänderte Spieler mit Build und stehender Figur', () => {
    const { runtime, systems } = makeRuntime();
    systems.playerModifier.syncPlayers.mockReturnValue(['withBuild', 'noBuild', 'absent']);
    const builds = new Map<string, any>([
      ['withBuild', { equippedItems: [{ id: 'x' }] }],
      ['noBuild', { equippedItems: [] }],
      ['absent', { coopDefenseProfile: {} }],
    ]);

    runtime.reconcilePlayerBuildModifiers(builds);

    expect(systems.playerModifier.syncPlayers).toHaveBeenCalledWith(builds);
    expect(systems.itemRuntime.initPlayer).toHaveBeenCalledWith('withBuild');
    expect(systems.itemRuntime.initPlayer).not.toHaveBeenCalledWith('absent');
    expect(systems.itemRuntime.removePlayer).toHaveBeenCalledWith('noBuild');
  });

  it('rührt die Item-Runtime nicht an, wenn keine Build sich geändert hat', () => {
    const { runtime, systems } = makeRuntime();
    systems.playerModifier.syncPlayers.mockReturnValue([]);

    runtime.reconcilePlayerBuildModifiers(new Map());

    expect(systems.itemRuntime.initPlayer).not.toHaveBeenCalled();
    expect(systems.itemRuntime.removePlayer).not.toHaveBeenCalled();
  });
});

describe('WorldPlayerGameplayRuntime – Idempotenz-Gate (2A)', () => {
  it('entfernt Player-State über alle relevanten Detach-Pfade auch bei Wiederholung', () => {
    const {
      runtime,
      playerId,
      resource,
      burrow,
      itemRuntime,
      loadout,
      tunnel,
    } = makeConcreteRemoveRuntime();

    resource.initPlayer(playerId);
    resource.setRage(playerId, 123);
    burrow.startTunnelTransit(playerId);
    itemRuntime.initPlayer(playerId, 1_000);
    itemRuntime.registerOwnKill(playerId, 1_000);
    loadout.assignDefaultLoadout(playerId);
    expect(tunnel.tryPlaceTunnel(
      { placement: { range: 100 } } as never,
      playerId,
      0xffffff,
      0,
      0,
      0,
      0,
      100,
      0,
    )).toBe(true);

    runtime.detachPlayerResources(playerId);
    runtime.detachPlayerResources(playerId);
    runtime.detachPlayerBurrow(playerId);
    runtime.detachPlayerBurrow(playerId);
    runtime.detachPlayerBuild(playerId);
    runtime.detachPlayerBuild(playerId);
    runtime.detachPlayerLoadout(playerId);
    runtime.detachPlayerLoadout(playerId);

    expect(resource.getAdrenaline(playerId)).toBe(0);
    expect(resource.getRage(playerId)).toBe(0);
    expect(burrow.getPhase(playerId)).toBe('idle');
    expect(itemRuntime.getKillChargeStacks(playerId, 1_000)).toBe(0);
    expect(loadout.getEquippedUtilityConfig(playerId)).toBeUndefined();
    expect(tunnel.getSnapshot()).toEqual([]);
  });

  it('macht spielerbezogenes Held-Action-Remove und Activity-Reset wiederholbar', () => {
    const heldAction = new HostHeldActionSystem();
    const runtime = Object.create(WorldPlayerGameplayRuntime.prototype) as AnyRuntime;
    runtime.systems = { heldAction };

    expect(heldAction.start('p1', 'action-p1', 'charged_throw', 100, 0)).toBe(true);
    expect(heldAction.start('p2', 'action-p2', 'charged_throw', 100, 0)).toBe(true);
    runtime.invalidateHeldActionsForPlayer('p1');
    runtime.invalidateHeldActionsForPlayer('p1');

    expect(heldAction.consume('p1', 'action-p1', 'charged_throw', 100, 50)).toBeNull();
    expect(heldAction.consume('p2', 'action-p2', 'charged_throw', 100, 50)).not.toBeNull();

    expect(heldAction.start('p1', 'action-p1b', 'charged_throw', 100, 0)).toBe(true);
    expect(heldAction.start('p2', 'action-p2b', 'charged_throw', 100, 0)).toBe(true);
    runtime.invalidateHeldActionsOnActivityEnd();
    runtime.invalidateHeldActionsOnActivityEnd();

    expect(heldAction.consume('p1', 'action-p1b', 'charged_throw', 100, 50)).toBeNull();
    expect(heldAction.consume('p2', 'action-p2b', 'charged_throw', 100, 50)).toBeNull();
  });

  it('führt den World-destroy-Teardown bei wiederholtem Aufruf nur einmal aus', () => {
    const { runtime, systems } = makeDestroyRuntime();

    runtime.destroy();
    runtime.destroy();

    expect(systems.ultimateBehavior.destroy).toHaveBeenCalledTimes(1);
    expect(systems.ak47Behavior.destroy).toHaveBeenCalledTimes(1);
    expect(systems.negevBehavior.destroy).toHaveBeenCalledTimes(1);
    expect(systems.heldAction.reset).toHaveBeenCalledTimes(1);
    expect(systems.tunnel.clear).toHaveBeenCalledTimes(1);
    expect(systems.resource.removePlayer).toHaveBeenCalledTimes(1);
    expect(systems.burrow.removePlayer).toHaveBeenCalledTimes(1);
    expect(systems.translocator.removePlayer).toHaveBeenCalledTimes(1);
    expect(systems.playerModifier.clear).toHaveBeenCalledTimes(1);
    expect(systems.itemRuntime.clear).toHaveBeenCalledTimes(1);
    for (const system of [
      systems.guardianSpirit,
      systems.repairDrone,
      systems.slimeTrail,
      systems.flamethrowerUpgrade,
      systems.weaponUpgrade,
      systems.ak47StrategicTarget,
    ]) {
      expect(system.clear).toHaveBeenCalledTimes(1);
    }
  });
});

describe('WorldPlayerGameplayRuntime – Read-Views (2B)', () => {
  it('reicht State-Reads unverändert an die Child-Systeme durch', () => {
    const { runtime } = makeRuntime();

    expect(runtime.isBurrowed('buried')).toBe(true);
    expect(runtime.isBurrowed('p1')).toBe(false);
    expect(runtime.isStunned('zapped')).toBe(true);
    expect(runtime.getPlayerClassId('p1')).toBe('dachs_of_steel');
    expect(runtime.getPlayerClassId('other')).toBeNull();
  });

  it('reicht Loadout-/Translocator-Reads durch', () => {
    const { runtime } = makeRuntime();

    expect(runtime.getEquippedUtilityConfig('p1')).toEqual({ id: 'DECOY' });
    expect(runtime.getTemporaryUtilityConfig('p1', 'inst-1')).toEqual({ id: 'BFG' });
    expect(runtime.hasActiveTranslocatorPuck('withPuck')).toBe(true);
    expect(runtime.hasActiveTranslocatorPuck('p1')).toBe(false);
    expect(runtime.getTranslocatorActivePuckId('withPuck')).toBe(42);
  });

  it('reicht Resource-Reads und Observer-Abos durch', () => {
    const { runtime, systems, drainUnsub } = makeRuntime();

    expect(runtime.getAdrenaline('p1')).toBe(55);
    expect(runtime.getAdrenalineRevision('p1')).toBe(7);
    expect(runtime.getMaxAdrenaline('p1')).toBe(100);

    const listener = vi.fn();
    const unsub = runtime.addAdrenalineDrainObserver(listener);
    expect(systems.resource.addAdrenalineDrainObserver).toHaveBeenCalledWith(listener);
    expect(unsub).toBe(drainUnsub);
  });

  it('reicht Snapshot-Reads durch (Tunnel, AK47-Strategic-Target)', () => {
    const { runtime, systems } = makeRuntime();

    expect(runtime.getTunnelNetSnapshot()).toEqual(['tunnel-snap']);
    expect(runtime.getAk47StrategicTargetNetSnapshot(1_234)).toEqual([{ now: 1_234 }]);

    systems.ak47StrategicTarget = null;
    expect(runtime.getAk47StrategicTargetNetSnapshot(0)).toEqual([]);
  });
});
