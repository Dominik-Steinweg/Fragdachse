import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ArenaLayout, PlayerProfile, SyncedCaptureTheBeerBeer } from '../src/types';
import type { CoopMissionObjectiveRuntime, CoopMissionRuntime } from '../src/activity/CoopMissionRuntime';
import type { CoopDefenseMissionBarrierManager } from '../src/systems/CoopDefenseMissionBarrierManager';
import type { WorldCombatGameplayBinding, WorldCombatGameplayBindingOptions } from '../src/world/WorldCombatGameplayBinding';
import { WorldRuntime } from '../src/world/WorldRuntime';
import type { WorldRuntimeContext } from '../src/world/WorldRuntimeContext';
import type { ActivityDescriptor } from '../src/world/ActivityDescriptor';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { CombatSystem } from '../src/systems/CombatSystem';
import { resolveActiveArenaWorldMetrics } from '../src/world/WorldMetrics';
import { WorldLifecycle } from '../src/world/WorldLifecycle';

let ULTIMATE_CONFIGS: typeof import('../src/loadout/LoadoutConfig').ULTIMATE_CONFIGS;
let AirstrikeSystem: typeof import('../src/systems/AirstrikeSystem').AirstrikeSystem;
let PowerUpSystem: typeof import('../src/powerups/PowerUpSystem').PowerUpSystem;
let CoopMissionRuntime: typeof import('../src/activity/CoopMissionRuntime').CoopMissionRuntime;
let CaptureTheBeerActivityRuntime: typeof import('../src/activity/CaptureTheBeerActivityRuntime').CaptureTheBeerActivityRuntime;
let WorldCombatGameplayBinding: typeof import('../src/world/WorldCombatGameplayBinding').WorldCombatGameplayBinding;
let WorldPlayerGameplayRuntime: typeof import('../src/world/WorldPlayerGameplayRuntime').WorldPlayerGameplayRuntime;

beforeAll(async () => {
  vi.stubGlobal('window', { cordova: undefined, URL: {} });
  vi.stubGlobal('navigator', {
    userAgent: 'vitest',
    appVersion: 'vitest',
    maxTouchPoints: 0,
  });
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null;
    set src(_value: string) {}
  });
  class CanvasElement {
    readonly style = {};
    readonly tagName = 'CANVAS';

    getContext() {
      const imageData = { data: new Uint8ClampedArray([0, 0, 0, 0]) };
      return {
        fillRect: vi.fn(),
        putImageData: vi.fn(),
        drawImage: vi.fn(),
        getImageData: () => imageData,
      };
    }
  }
  vi.stubGlobal('HTMLCanvasElement', CanvasElement);
  vi.stubGlobal('document', {
    hidden: false,
    documentElement: {},
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
    readyState: 'complete',
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        return new CanvasElement();
      }
      return {
        canPlayType: () => '',
        style: {},
        tagName: tag.toUpperCase(),
      };
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getElementById: vi.fn(),
  });
  const [loadout, airstrike, powerUp, coopRuntime, capture, combat, player] = await Promise.all([
    import('../src/loadout/LoadoutConfig'),
    import('../src/systems/AirstrikeSystem'),
    import('../src/powerups/PowerUpSystem'),
    import('../src/activity/CoopMissionRuntime'),
    import('../src/activity/CaptureTheBeerActivityRuntime'),
    import('../src/world/WorldCombatGameplayBinding'),
    import('../src/world/WorldPlayerGameplayRuntime'),
  ]);
  ULTIMATE_CONFIGS = loadout.ULTIMATE_CONFIGS;
  AirstrikeSystem = airstrike.AirstrikeSystem;
  PowerUpSystem = powerUp.PowerUpSystem;
  CoopMissionRuntime = coopRuntime.CoopMissionRuntime;
  CaptureTheBeerActivityRuntime = capture.CaptureTheBeerActivityRuntime;
  WorldCombatGameplayBinding = combat.WorldCombatGameplayBinding;
  WorldPlayerGameplayRuntime = player.WorldPlayerGameplayRuntime;
});

function service(overrides: Record<string, unknown> = {}): any {
  const target = { ...overrides } as Record<string, unknown>;
  return new Proxy(target, {
    get: (_target, property: string | symbol) => {
      if (typeof property !== 'string') return undefined;
      if (target[property] === undefined) target[property] = vi.fn();
      return target[property];
    },
  });
}

function worldContext(): WorldRuntimeContext {
  return {
    descriptor: {
      worldRevision: 701,
      definitionId: 'world:test:rebinding',
      seed: 1234,
      generatorVersion: 1,
      layoutFingerprint: 'rebinding',
    },
  } as WorldRuntimeContext;
}

function activity(activityRevision: number): ActivityDescriptor {
  return {
    activityRevision,
    worldRevision: 701,
    kind: 'coop-mission',
    definitionId: `activity:coop-mission:${activityRevision}`,
  };
}

type DamageHandler = (targetType: string, targetId: string, attackerId: string, damage: number) => void;

function combatBindingHarness(
  isCoopMission: () => boolean,
  getMissionBarrierObstacles: () => unknown = () => null,
  // Optional bereits bestehender Fake-CombatSystem samt Aufzeichnung, damit ein Test dieselbe
  // scene-langlebige Instanz ueber mehrere Worlds hinweg teilen kann.
  existing?: { combat: CombatSystem; barriers: unknown[] },
) {
  let damageHandler: DamageHandler | null = null;
  const barriers: unknown[] = existing?.barriers ?? [];
  const stats = { addPlayerRoomDamage: vi.fn() };
  const combat = existing?.combat ?? service({
    setDamageDealtHandler: (handler: DamageHandler) => { damageHandler = handler; },
    setBarrierObstacles: (obstacles: unknown) => { barriers.push(obstacles); },
  });
  const profile = { id: 'attacker', name: 'Attacker', colorHex: 0xffffff } as PlayerProfile;
  const options: WorldCombatGameplayBindingOptions = {
    playerManager: service({ getAllPlayers: () => [], getPlayer: () => undefined }) as PlayerManager,
    projectileManager: service(),
    combatSystem: combat as CombatSystem,
    hostPhysics: service(),
    decoySystem: service(),
    fireSystem: service(),
    gameAudioSystem: service(),
    placementSystem: service(),
    baseManager: null,
    worldMetrics: resolveActiveArenaWorldMetrics(),
    isCoopMission,
    isActivityActive: () => true,
    getSpawnContext: () => null,
    getWorldParticipation: () => null as never,
    getPlayerCapabilities: () => ({ canUseCombat: true }),
    getEnemyManager: () => null,
    getPlayerCombatIntegration: () => null,
    automatedWeaponExecution: null,
    getPowerUpSystem: () => null,
    getTargetStatusSystem: () => null,
    getEnergyInjectorSystem: () => null,
    getWorldGeometryBinding: () => null,
    getPersistentBaseId: () => undefined,
    getConstructionMuzzleOffset: () => undefined,
    getTargetFootprint: () => null,
    resolveObstacleDamage: () => 0,
    applyObstacleDamageById: () => 0,
    handleDestroyedRock: () => undefined,
    updateTurretAngle: () => undefined,
    spawnImpactCloud: () => undefined,
    resetPlayerPosition: () => undefined,
    dropBeer: () => undefined,
    dropCarryForPlayer: () => undefined,
    handlePlayerUnavailable: () => undefined,
    handlePlayerDeath: () => undefined,
    getSecondaryObjectiveState: () => null,
    reportTargetContribution: () => undefined,
    reportTargetDestroyed: () => 0,
    reconcilePersistentBaseWorld: () => undefined,
    syncActiveBaseIds: () => undefined,
    getMissionBarrierObstacles: getMissionBarrierObstacles as WorldCombatGameplayBindingOptions['getMissionBarrierObstacles'],
    getRockTargets: () => [],
    getWorldTrain: () => null,
    getTimebombSystem: () => null,
    getNecromancySystem: () => null,
    hostUpdate: service(),
    createEnergyShieldSystem: () => { throw new Error('not needed in this harness'); },
    network: {
      authority: {
        isHost: () => true,
        isEnemyPair: () => true,
        getPlayerProfile: (playerId) => playerId === 'attacker' ? profile : undefined,
        getConnectedPlayers: () => [],
      },
      round: {
        canPlayerInitialSpawn: () => true,
        canPlayerRespawn: () => true,
        canPlayerReceiveRoundRewards: () => true,
        addCoopDefenseRoundXp: () => undefined,
      },
      stats: {
        recordPlayerDamageTaken: () => undefined,
        addPlayerRoomDamage: stats.addPlayerRoomDamage,
        recordHealingReceived: () => undefined,
        recordArmorReceived: () => undefined,
        recordPlayerDeath: () => undefined,
        recordPlayerKill: () => undefined,
        incrementPlayerFrags: () => undefined,
      },
      effects: {
        broadcastSlimeBloomEffect: () => undefined,
        broadcastExplosionEffect: () => undefined,
        broadcastBfgLaserBatch: () => undefined,
        broadcastMiniRocketCollectionEffect: () => undefined,
        broadcastMiniRocketDestructionEffect: () => undefined,
        broadcastKillEvent: () => undefined,
      },
    },
    respawnPlayer: () => true,
  };
  return {
    binding: new WorldCombatGameplayBinding(options),
    barriers,
    combat: combat as CombatSystem,
    damage: () => damageHandler?.('player', 'victim', 'attacker', 10),
    stats,
  };
}

function objectiveWithBarrier(barriers: CoopDefenseMissionBarrierManager): CoopMissionObjectiveRuntime {
  return {
    secondaryObjectives: null,
    missionProgress: null,
    barriers,
    carry: null,
    repair: null,
    placementReward: null,
    roundState: null,
    teamBuff: null,
  };
}

function beer(teamId: 'blue' | 'red', state: SyncedCaptureTheBeerBeer['state'], holderId: string | null): SyncedCaptureTheBeerBeer {
  return {
    teamId,
    defaultX: 100,
    defaultY: 100,
    x: 100,
    y: 100,
    holderId,
    state,
  };
}

describe('Activity rebinding', () => {
  it('liest Coop dynamisch durch none → A → none → B → none ohne neue Combat-Bindung', () => {
    const world = new WorldRuntime(worldContext());
    let lifecycle: WorldLifecycle | null = null;
    const harness = combatBindingHarness(() => lifecycle?.activity.is('coop-mission') ?? false);
    lifecycle = new WorldLifecycle({
      publish: () => undefined,
      publishActivity: () => undefined,
      clear: () => undefined,
      attach: () => undefined,
      detach: () => undefined,
      activity: {
        attach: (descriptor) => {
          world.activity.attach(descriptor, new CoopMissionRuntime(descriptor));
        },
        detach: () => world.activity.detach(),
      },
    });
    lifecycle.attachRuntime(worldContext(), null);

    harness.damage();
    expect(harness.stats.addPlayerRoomDamage).toHaveBeenCalledTimes(1);
    const binding = harness.binding;

    lifecycle.syncObservedActivity(activity(1));
    harness.damage();
    expect(harness.stats.addPlayerRoomDamage).toHaveBeenCalledTimes(1);

    lifecycle.syncObservedActivity(null);
    expect(world.activity.isAttached()).toBe(false);
    harness.damage();
    expect(harness.stats.addPlayerRoomDamage).toHaveBeenCalledTimes(2);

    lifecycle.syncObservedActivity(activity(2));
    harness.damage();
    expect(harness.stats.addPlayerRoomDamage).toHaveBeenCalledTimes(2);

    lifecycle.syncObservedActivity(null);
    harness.damage();
    expect(harness.stats.addPlayerRoomDamage).toHaveBeenCalledTimes(3);
    expect(harness.binding).toBe(binding);
    expect(world.isDestroyed()).toBe(false);
    lifecycle.endInstance();
    harness.binding.destroy();
  });

  it('rebundet echte Coop-Objective-Barriers nach der Materialisierung auf A und B', () => {
    let current: CoopMissionRuntime | null = null;
    const harness = combatBindingHarness(
      () => false,
      () => current?.coopDefenseMissionBarrierManager?.getObstacleRectangles() ?? null,
    );
    const world = new WorldRuntime(worldContext());
    harness.binding.updateActivityBindings();
    expect(harness.barriers.at(-1)).toBeNull();

    const obstaclesA = [{ id: 'A' }];
    const barriersA = {
      getObstacleRectangles: () => obstaclesA,
      destroy: vi.fn(),
    } as unknown as CoopDefenseMissionBarrierManager;
    const runtimeA = new CoopMissionRuntime(activity(1));
    current = runtimeA;
    world.activity.attach(activity(1), runtimeA);
    runtimeA.bind({
      attach: () => harness.binding.updateActivityBindings(),
      detach: () => harness.binding.clearActivityBindings(),
    });
    runtimeA.setObjectives(objectiveWithBarrier(barriersA));
    expect(harness.barriers.at(-1)).toBe(obstaclesA);

    world.activity.detach();
    current = null;
    expect(harness.barriers.at(-1)).toBeNull();

    const obstaclesB = [{ id: 'B' }];
    const barriersB = {
      getObstacleRectangles: () => obstaclesB,
      destroy: vi.fn(),
    } as unknown as CoopDefenseMissionBarrierManager;
    const runtimeB = new CoopMissionRuntime(activity(2));
    current = runtimeB;
    world.activity.attach(activity(2), runtimeB);
    runtimeB.bind({
      attach: () => harness.binding.updateActivityBindings(),
      detach: () => harness.binding.clearActivityBindings(),
    });
    runtimeB.setObjectives(objectiveWithBarrier(barriersB));
    expect(harness.barriers.at(-1)).toBe(obstaclesB);
    runtimeA.destroy();
    expect(harness.barriers.at(-1)).toBe(obstaclesB);

    world.activity.detach();
    expect(harness.barriers.at(-1)).toBeNull();
    expect(world.isDestroyed()).toBe(false);
    harness.binding.destroy();
  });

  it('haelt die Player-Upgrade-Systeme World-scoped und bindet Enemy A, null und B', () => {
    let enemyManager: EnemyManager | null = null;
    const runtime = new WorldPlayerGameplayRuntime({
      playerManager: service({ getAllPlayers: () => [], getPlayer: () => undefined }) as PlayerManager,
      projectileManager: service(),
      translocatorProjectilePort: {
        spawnPuck: () => 1,
        getPuckPosition: () => null,
        consumePuck: () => false,
      },
      combatSystem: service(),
      hostPhysics: service(),
      fireSystem: service(),
      placementSystem: service(),
      gameAudioSystem: service(),
      worldMetrics: resolveActiveArenaWorldMetrics(),
      getEnemyManager: () => enemyManager,
      getTargetStatusSystem: () => null,
      getPowerUpSystem: () => null,
      getPlayerCapabilities: () => ({ canInteract: true } as never),
      resetPlayerPosition: () => undefined,
      dropBeer: () => undefined,
      createLoadoutManager: () => service(),
      createBurrowSystem: () => service(),
      weaponExecution: service(),
      relationship: { isEnemyPair: () => false },
      network: {
        input: { getPlayerInput: () => undefined },
        presentation: {
          getPlayerColor: () => undefined,
          broadcastTranslocatorFlash: () => undefined,
          broadcastExplosionEffect: () => undefined,
          broadcastShotFx: () => undefined,
          broadcastFireChunkEffect: () => undefined,
          broadcastMiniRocketCollectionEffect: () => undefined,
          broadcastMiniRocketDestructionEffect: () => undefined,
        },
        loadout: {
          publishUtilityCooldownUntil: () => undefined,
        },
        roundStats: {
          canPlayerReceiveRoundRewards: () => true,
          recordUtilityUsed: () => undefined,
          recordConstructionBuilt: () => undefined,
          recordUltimateUsed: () => undefined,
        },
      },
    });
    const dependentSystems = [
      runtime.systems.guardianSpirit,
      runtime.systems.slimeTrail,
      runtime.systems.flamethrowerUpgrade,
      runtime.systems.weaponUpgrade,
      runtime.systems.ak47StrategicTarget,
    ];
    expect(dependentSystems.every((system) => system !== null)).toBe(true);
    const initialSystems = [...dependentSystems];
    const managerSpies = dependentSystems.map((system) => vi.spyOn(system!, 'setEnemyManager'));
    const enemyA = service() as EnemyManager;
    const enemyB = service() as EnemyManager;

    runtime.updateEnemyManager(enemyA);
    for (const spy of managerSpies) expect(spy).toHaveBeenLastCalledWith(enemyA);
    runtime.updateEnemyManager(null);
    for (const spy of managerSpies) expect(spy).toHaveBeenLastCalledWith(null);
    runtime.updateEnemyManager(enemyB);
    for (const spy of managerSpies) expect(spy).toHaveBeenLastCalledWith(enemyB);
    expect(dependentSystems).toEqual(initialSystems);
    runtime.destroy();
  });

  it('entfernt authored Airstrikes gezielt, lässt Player-Strikes stehen und akzeptiert B', () => {
    const system = new AirstrikeSystem();
    const config = ULTIMATE_CONFIGS.AIRSTRIKE;
    system.scheduleStrike('player', 100, 100, config, 0);
    system.scheduleStrike('coop-zombie-bomber', 200, 200, config, 0, { eventId: 'activity-a', occurrence: 0 });
    expect(system.getSnapshot()).toHaveLength(2);

    system.clearAuthoredActivityStrikes(new Set(['activity-a']));
    expect(system.getSnapshot()).toEqual([
      expect.objectContaining({ triggeredBy: 'player' }),
    ]);

    system.scheduleStrike('coop-zombie-bomber', 300, 300, config, 0, { eventId: 'activity-b', occurrence: 0 });
    expect(system.getSnapshot()).toHaveLength(2);
  });

  it('bindet die Coop-XP-Reference am selben PowerUp-System um', () => {
    const system = new PowerUpSystem(
      service({ getAllPlayers: () => [] }) as PlayerManager,
      service() as CombatSystem,
      { rocks: [], trees: [], tracks: [], powerUpPedestals: [] } as unknown as ArenaLayout,
      {
        isAdrenalineDropEnabled: () => true,
        getAdrenalineDropChanceMultiplier: () => 1,
      },
      resolveActiveArenaWorldMetrics(),
    );
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    system.setCoopDefenseMapXpReference(10);
    system.onCoopDefenseEnemyKilled('p1', 10, 100, 100);
    expect(system.getNetSnapshot()?.upserts).toHaveLength(1);

    system.reset();
    system.setCoopDefenseMapXpReference(100);
    system.onCoopDefenseEnemyKilled('p1', 10, 100, 100);
    expect(system.getNetSnapshot()?.upserts).toHaveLength(0);
  });

  it('erzeugt und zerstört CTB exakt im Activity-Slot, ohne die World zu erneuern', () => {
    const world = new WorldRuntime(worldContext());
    const playerManager = service({ getAllPlayers: () => [], getPlayer: () => undefined }) as PlayerManager;
    const fxA = vi.fn();
    const runtimeA = new CaptureTheBeerActivityRuntime({
      playerManager,
      isPlayerInteractionAllowed: () => true,
      onFx: fxA,
    });
    const state = {
      scores: { blue: 0, red: 0 },
      beers: [beer('blue', 'carried', 'p1'), beer('red', 'home', null)],
    };

    world.activity.attach(activity(1), runtimeA);
    runtimeA.system.syncSnapshot(state);
    runtimeA.system.dropBeerForPlayer('p1', 120, 120);
    expect(fxA).toHaveBeenCalledTimes(1);
    world.activity.detach();
    runtimeA.system.dropBeerForPlayer('p1', 120, 120);
    expect(fxA).toHaveBeenCalledTimes(1);
    expect(runtimeA.system.getTeamScore('blue')).toBe(0);

    const runtimeB = new CaptureTheBeerActivityRuntime({
      playerManager,
      isPlayerInteractionAllowed: () => true,
      onFx: () => undefined,
    });
    world.activity.attach(activity(2), runtimeB);
    expect(runtimeB).not.toBe(runtimeA);
    expect(runtimeB.system).not.toBe(runtimeA.system);
    world.activity.detach();
    expect(world.isDestroyed()).toBe(false);
  });
});

describe('WorldCombatGameplayBinding – Lifetime-Symmetrie', () => {
  it('laesst ein zerstoertes Combat-Binding die naechste World nicht mehr beeinflussen', () => {
    const harnessA = combatBindingHarness(() => false);
    harnessA.binding.destroy();

    // World B teilt sich den scene-langlebigen CombatSystem mit A.
    const harnessB = combatBindingHarness(() => false, () => null, {
      combat: harnessA.combat,
      barriers: harnessA.barriers,
    });
    harnessB.binding.updateActivityBindings();
    const barrierCallsAfterB = harnessB.barriers.length;

    // Die staleen Aufrufe des zerstoerten Bindings A duerfen den gemeinsamen CombatSystem nicht
    // mehr erreichen.
    harnessA.binding.updateActivityBindings();
    harnessA.binding.clearActivityBindings();

    expect(harnessB.barriers.length).toBe(barrierCallsAfterB);
  });

  it('laesst stale Bindings weder PowerUp- noch Enemy-Consumer nach dem Destroy veraendern', () => {
    const harness = combatBindingHarness(() => false);
    const setPowerUpSystem = harness.combat.setPowerUpSystem as ReturnType<typeof vi.fn>;
    const setEnemyManager = vi.fn();

    harness.binding.destroy();
    Object.defineProperty(harness.binding, 'systems', {
      value: { energyShield: { setEnemyManager } },
      configurable: true,
    });
    const callsAfterDestroy = setPowerUpSystem.mock.calls.length;

    harness.binding.setPowerUpSystem(service());
    harness.binding.updateEnemyManager(service() as EnemyManager);

    expect(setPowerUpSystem.mock.calls.length).toBe(callsAfterDestroy);
    expect(setEnemyManager).not.toHaveBeenCalled();
  });
});
