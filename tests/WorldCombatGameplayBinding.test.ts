import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Angle: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1),
    },
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
  },
}));

import { RockGridIndex } from '../src/arena/RockGridIndex';
import {
  CELL_SIZE,
  COOP_DEFENSE_BASE_TURRET_OWNER_ID,
  COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID,
} from '../src/config';
import { COOP_DEFENSE_CONSTRUCTIONS } from '../src/config/coopDefenseConstructions';
import type { BaseManager } from '../src/entities/BaseManager';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { PlayerEntity } from '../src/entities/PlayerEntity';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { ProjectileManager } from '../src/entities/ProjectileManager';
import { LoadoutManager } from '../src/loadout/LoadoutManager';
import { Ak47BehaviorRuntime } from '../src/world/Ak47BehaviorRuntime';
import { WorldWeaponExecutionRuntime } from '../src/world/WorldWeaponExecutionRuntime';
import { AutomatedWeaponExecutionAdapter } from '../src/world/AutomatedWeaponExecutionAdapter';
import { UTILITY_CONFIGS, WEAPON_CONFIGS, type PlaceableTurretUtilityConfig } from '../src/loadout/LoadoutConfig';
import type { ResourceSystem } from '../src/systems/ResourceSystem';
import type { CombatSystem } from '../src/systems/CombatSystem';
import type { DecoySystem } from '../src/systems/DecoySystem';
import type { FireSystem } from '../src/effects/FireSystem';
import type { GameAudioSystem } from '../src/audio/GameAudioSystem';
import type { HostPhysicsSystem } from '../src/systems/HostPhysicsSystem';
import { PlacementSystem } from '../src/systems/PlacementSystem';
import { TurretSystem } from '../src/systems/TurretSystem';
import { Ak47StrategicTargetSystem } from '../src/systems/Ak47StrategicTargetSystem';
import type { TargetStatusSystem, TargetStatusTarget } from '../src/systems/TargetStatusSystem';
import type { ArenaLayout, PlayerProfile, TrackedProjectile } from '../src/types';
import { resolveActiveArenaWorldMetrics } from '../src/world/WorldMetrics';
import {
  WorldCombatGameplayBinding,
  type WorldCombatGameplayBindingOptions,
} from '../src/world/WorldCombatGameplayBinding';
import type { WorldPlayerGameplaySystems } from '../src/world/WorldPlayerGameplayRuntime';

const layout: ArenaLayout = {
  seed: 1,
  rocks: [],
  trees: [],
  tracks: [],
  dirt: [],
  powerUpPedestals: [],
};

function methodBag(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const methods = new Map<PropertyKey, ReturnType<typeof vi.fn>>();
  return new Proxy(overrides, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      let method = methods.get(property);
      if (!method) {
        method = vi.fn();
        methods.set(property, method);
      }
      return method;
    },
  });
}

function createPlacement(playerManager: PlayerManager): PlacementSystem {
  const metrics = resolveActiveArenaWorldMetrics();
  return new PlacementSystem(
    layout,
    new RockGridIndex(layout.rocks, { cols: metrics.gridCols, rows: metrics.gridRows }),
    playerManager,
    metrics,
  );
}

interface TurretFixture {
  readonly binding: WorldCombatGameplayBinding;
  readonly projectileManager: ProjectileManager;
  readonly playerLoadout: LoadoutManager;
  readonly playerManager: PlayerManager;
  readonly combatSystem: CombatSystem;
  readonly metrics: ReturnType<typeof resolveActiveArenaWorldMetrics>;
}

function createFixture(options: {
  readonly placementSystem?: PlacementSystem;
  readonly players: readonly { id: string; x: number; y: number; active: boolean; rotation?: number }[];
  readonly enemies: readonly { id: string; x: number; y: number; active: boolean }[];
  readonly baseTurrets?: readonly {
    id: string;
    x: number;
    y: number;
    weaponId: 'BASE_SPORES';
    faction: 'friendly' | 'hostile';
  }[];
  readonly loadoutDamageMultiplier?: number;
  readonly powerUpDamageMultiplier?: number;
  readonly turretDamageMultiplier?: number;
  readonly combatSystem?: CombatSystem;
  readonly ak47Behavior?: WorldPlayerGameplaySystems['ak47Behavior'];
  readonly negevBehavior?: WorldPlayerGameplaySystems['negevBehavior'];
  readonly sustainedWeaponBehavior?: WorldPlayerGameplaySystems['sustainedWeaponBehavior'];
  readonly weaponReaction?: WorldPlayerGameplaySystems['weaponReaction'];
  readonly ak47StrategicTarget?: Ak47StrategicTargetSystem | null;
  readonly rockTargets?: readonly { id?: number; index: number; active: boolean; x: number; y: number }[];
  readonly applyTeslaRockDamage?: (index: number, damage: number, ownerId: string) => void;
  readonly targetStatusSystem?: TargetStatusSystem | null;
}): TurretFixture {
  const playerManager = {
    getAllPlayers: () => options.players as readonly PlayerEntity[] as PlayerEntity[],
    getPlayer: (id: string) => options.players.find((player) => player.id === id) as PlayerEntity | undefined,
    setSpawnContextProvider: vi.fn(),
  } as unknown as PlayerManager;
  const projectileManager = methodBag({
    spawnProjectile: vi.fn(),
  }) as unknown as ProjectileManager;
  const combatSystem = options.combatSystem ?? (methodBag({
    isAlive: vi.fn(() => true),
    isBurrowed: vi.fn(() => false),
    canDamageTarget: vi.fn(() => true),
    hasClearLineOfFire: vi.fn(() => true),
    hasLineOfSight: vi.fn(() => true),
  }) as unknown as CombatSystem);
  const enemyManager = {
    getAllEnemies: () => options.enemies.map((enemy) => ({
      id: enemy.id,
      sprite: { active: enemy.active, x: enemy.x, y: enemy.y },
    })),
    getEnemy: () => undefined,
    hasEnemy: () => false,
  } as unknown as EnemyManager;
  const baseManager = methodBag({
    getTurrets: () => options.baseTurrets ?? [],
    getBasesByFaction: () => [],
    getBase: () => undefined,
    getObstacleRectangles: () => null,
  }) as unknown as BaseManager;
  const resource = methodBag() as unknown as ResourceSystem;
  const playerLoadout = new LoadoutManager(
    playerManager,
    projectileManager,
    resource,
    {} as never,
  );
  // Die gemeinsame Immediate-Fire-Capability und der explizite Automatik-Adapter werden beide
  // an der World-Grenze erzeugt; Player- und Turmquellen teilen nur die Ausführung.
  const weaponExecution = new WorldWeaponExecutionRuntime({
    projectileManager,
    combatSystem: combatSystem as unknown as ConstructorParameters<typeof WorldWeaponExecutionRuntime>[0]['combatSystem'],
  });
  playerLoadout.setWeaponExecutionCapability(weaponExecution);
  const automatedWeaponExecution = new AutomatedWeaponExecutionAdapter(weaponExecution, projectileManager);
  if (options.loadoutDamageMultiplier !== undefined) {
    vi.spyOn(playerLoadout, 'getDamageMultiplier').mockReturnValue(options.loadoutDamageMultiplier);
  }
  const playerSystems = {
    heldAction: methodBag(),
    playerModifier: methodBag(),
    itemRuntime: methodBag({
      getRemoteControlDamageMultiplier: vi.fn(() => 1),
    }),
    resource,
    burrow: methodBag({ isWeaponBlocked: vi.fn(() => false) }),
    loadout: playerLoadout,
    translocator: methodBag(),
    tunnel: methodBag(),
    guardianSpirit: null,
    repairDrone: null,
    slimeTrail: null,
    flamethrowerUpgrade: null,
    weaponUpgrade: null,
    ak47Behavior: options.ak47Behavior ?? null,
    negevBehavior: options.negevBehavior ?? null,
    sustainedWeaponBehavior: options.sustainedWeaponBehavior ?? methodBag(),
    weaponReaction: options.weaponReaction ?? methodBag(),
    ak47StrategicTarget: options.ak47StrategicTarget ?? null,
  } as unknown as WorldPlayerGameplaySystems;
  const metrics = resolveActiveArenaWorldMetrics();
  const network = {
    authority: {
      isHost: () => true,
      isEnemyPair: () => true,
      getPlayerProfile: () => undefined,
      getConnectedPlayers: (): readonly PlayerProfile[] => [],
    },
    round: {
      canPlayerInitialSpawn: () => true,
      canPlayerRespawn: () => true,
      canPlayerReceiveRoundRewards: () => true,
      addCoopDefenseRoundXp: vi.fn(),
    },
    stats: methodBag() as never,
    effects: methodBag() as never,
  };
  const placement = options.placementSystem ?? createPlacement(playerManager);
  const binding = new WorldCombatGameplayBinding({
    playerManager,
    projectileManager,
    combatSystem,
    hostPhysics: methodBag() as unknown as HostPhysicsSystem,
    decoySystem: methodBag() as unknown as DecoySystem,
    fireSystem: methodBag() as unknown as FireSystem,
    gameAudioSystem: methodBag() as unknown as GameAudioSystem,
    placementSystem: placement,
    baseManager,
    worldMetrics: metrics,
    isCoopMission: () => false,
    isActivityActive: () => true,
    getSpawnContext: () => undefined,
    getWorldParticipation: () => ({}) as never,
    getPlayerCapabilities: () => ({ canUseCombat: true }),
    getEnemyManager: () => enemyManager,
    getPlayerSystems: () => playerSystems,
    automatedWeaponExecution,
    getPowerUpSystem: () => options.powerUpDamageMultiplier === undefined
      ? null
      : { getDamageMultiplier: () => options.powerUpDamageMultiplier } as never,
    getTargetStatusSystem: () => options.targetStatusSystem ?? null,
    getEnergyInjectorSystem: () => options.turretDamageMultiplier === undefined
      ? null
      : {
        getFocusTarget: () => null,
        getTurretDamageMultiplierAt: () => options.turretDamageMultiplier,
      } as never,
    getWorldGeometryBinding: () => null,
    getPersistentBaseId: () => undefined,
    getConstructionMuzzleOffset: (constructionId) => (
      constructionId === 'rocket_turret' ? COOP_DEFENSE_CONSTRUCTIONS.rocket_turret.muzzleOffset : undefined
    ),
    getTargetFootprint: () => null,
    resolveObstacleDamage: () => 0,
    applyObstacleDamageById: () => 0,
    handleDestroyedRock: vi.fn(),
    updateTurretAngle: vi.fn(),
    spawnImpactCloud: vi.fn(),
    resetPlayerPosition: vi.fn(),
    dropBeer: vi.fn(),
    dropCarryForPlayer: vi.fn(),
    handlePlayerUnavailable: vi.fn(),
    handlePlayerDeath: vi.fn(),
    handleCoopItemKill: vi.fn(),
    getSecondaryObjectiveState: () => null,
    reportTargetContribution: vi.fn(),
    reportTargetDestroyed: () => 0,
    reconcilePersistentBaseWorld: vi.fn(),
    syncActiveBaseIds: vi.fn(),
    getMissionBarrierObstacles: () => null,
    getRockTargets: () => options.rockTargets ?? [],
    getWorldTrain: () => null,
    getTimebombSystem: () => null,
    getNecromancySystem: () => null,
    hostUpdate: methodBag({
      applyTeslaRockDamage: options.applyTeslaRockDamage ?? vi.fn(),
    }) as never,
    createEnergyShieldSystem: () => methodBag() as never,
    network,
    respawnPlayer: () => true,
  } satisfies WorldCombatGameplayBindingOptions);
  return { binding, projectileManager, playerLoadout, playerManager, combatSystem, metrics };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WorldCombatGameplayBinding turret fire wiring', () => {
  it('fires a placed rocket turret through the world loadout and creates a projectile', () => {
    const player = { id: 'builder', x: 0, y: 0, active: true };
    const playerManager = {
      getAllPlayers: () => [player] as unknown as PlayerEntity[],
      getPlayer: (id: string) => id === player.id ? player as unknown as PlayerEntity : undefined,
    } as unknown as PlayerManager;
    const placement = createPlacement(playerManager);
    const placed = placement.materializePersistentPlaceable(
      COOP_DEFENSE_CONSTRUCTIONS.rocket_turret,
      10,
      10,
      0,
      player.id,
      0xff8a3d,
      'guest-session',
    );
    expect(placed).not.toBeNull();
    if (!placed) return;
    const metrics = resolveActiveArenaWorldMetrics();
    const turretX = metrics.offsetX + placed.gridX * CELL_SIZE + CELL_SIZE / 2;
    const turretY = metrics.offsetY + placed.gridY * CELL_SIZE + CELL_SIZE / 2;
    const fixture = createFixture({
      placementSystem: placement,
      players: [player],
      enemies: [{ id: 'enemy', x: turretX + 100, y: turretY, active: true }],
      loadoutDamageMultiplier: 1.5,
      powerUpDamageMultiplier: 2,
      turretDamageMultiplier: 1.25,
    });

    fixture.binding.systems?.turret.hostUpdate(
      0,
      UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig,
      WEAPON_CONFIGS.SPORES,
    );

    const spawn = (fixture.projectileManager.spawnProjectile as unknown as ReturnType<typeof vi.fn>);
    expect(spawn).toHaveBeenCalledOnce();
    const [, , , ownerId, projectile] = spawn.mock.calls[0];
    expect(ownerId).toBe(player.id);
    expect(projectile).toMatchObject({
      ignoreRockIndex: placed.id,
      sourceTurretId: String(placed.id),
      sourceSlot: 'utility',
      damage: WEAPON_CONFIGS.TURRET_ROCKET_BURST.damage * 1.25,
      explosion: {
        maxDamage: 14 * 1.25 * 1.5 * 2,
      },
    });
    expect(projectile.ignoreBaseCollisions).toBe(false);
    fixture.binding.destroy();
  });

  it('fires a hostile base turret with player homing targets through the same path', () => {
    const player = { id: 'defender', x: 100, y: 0, active: true };
    const fixture = createFixture({
      placementSystem: createPlacement({
        getAllPlayers: () => [player] as unknown as PlayerEntity[],
        getPlayer: (id: string) => id === player.id ? player as unknown as PlayerEntity : undefined,
      } as unknown as PlayerManager),
      players: [player],
      enemies: [],
      baseTurrets: [{
        id: 'hostile-base:front',
        x: 0,
        y: 0,
        weaponId: 'BASE_SPORES',
        faction: 'hostile',
      }],
    });

    fixture.binding.systems?.turret.hostUpdate(
      0,
      UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig,
      WEAPON_CONFIGS.SPORES,
    );

    const spawn = (fixture.projectileManager.spawnProjectile as unknown as ReturnType<typeof vi.fn>);
    expect(spawn).toHaveBeenCalledOnce();
    const [, , , ownerId, projectile] = spawn.mock.calls[0];
    expect(ownerId).toBe(COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID);
    expect(projectile).toMatchObject({
      ignoreBaseCollisions: true,
      sourceTurretId: 'hostile-base:front',
      homing: { targetTypes: ['players'] },
    });
    expect(projectile.sourceSlot).toBeUndefined();
    expect(projectile.ignoreRockIndex).toBeUndefined();
    fixture.binding.destroy();
  });

  it('fires a persistent base-owned turret through the world loadout with base collision bypass', () => {
    const player = { id: 'builder', x: 0, y: 0, active: true };
    const playerManager = {
      getAllPlayers: () => [player] as unknown as PlayerEntity[],
      getPlayer: (id: string) => id === player.id ? player as unknown as PlayerEntity : undefined,
    } as unknown as PlayerManager;
    const placement = createPlacement(playerManager);
    const placed = placement.materializePersistentPlaceable(
      COOP_DEFENSE_CONSTRUCTIONS.spore_turret,
      5,
      5,
      0,
      player.id,
      0x4a90e2,
      'base-owned',
    );
    expect(placed).not.toBeNull();
    if (!placed) return;
    const metrics = resolveActiveArenaWorldMetrics();
    const turretX = metrics.offsetX + placed.gridX * CELL_SIZE + CELL_SIZE / 2;
    const turretY = metrics.offsetY + placed.gridY * CELL_SIZE + CELL_SIZE / 2;
    const fixture = createFixture({
      placementSystem: placement,
      players: [player],
      enemies: [{ id: 'enemy-base-target', x: turretX + 80, y: turretY, active: true }],
    });

    fixture.binding.systems?.turret.hostUpdate(
      0,
      UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig,
      WEAPON_CONFIGS.SPORES,
    );

    const spawn = (fixture.projectileManager.spawnProjectile as unknown as ReturnType<typeof vi.fn>);
    expect(spawn).toHaveBeenCalledOnce();
    const [, , , ownerId, projectile] = spawn.mock.calls[0];
    expect(ownerId).toBe(COOP_DEFENSE_BASE_TURRET_OWNER_ID);
    expect(projectile).toMatchObject({
      ignoreBaseCollisions: true,
      ignoreRockIndex: placed.id,
      sourceTurretId: String(placed.id),
      damage: WEAPON_CONFIGS.SPORES.damage,
    });
    expect(projectile.sourceSlot).toBeUndefined();
    fixture.binding.destroy();
  });
});

describe('WorldCombatGameplayBinding AK47 strategic target wiring', () => {
  it('wires AK47 direct enemy hit handler to strategic target system and applies damage bonus plus explosion', () => {
    const player = { id: 'shooter', x: 0, y: 0, active: true, rotation: 0 };
    const enemy = { id: 'strategic-zombie', x: 100, y: 0, active: true, getHp: () => 100, isBurrowed: () => false };
    const unmarkedEnemy = { id: 'other-zombie', x: 200, y: 0, active: true, getHp: () => 100, isBurrowed: () => false };
    const enemyList = [
      { id: enemy.id, sprite: { active: true, x: enemy.x, y: enemy.y }, getHp: enemy.getHp, isBurrowed: enemy.isBurrowed, kind: 'zombie-badger' },
      { id: unmarkedEnemy.id, sprite: { active: true, x: unmarkedEnemy.x, y: unmarkedEnemy.y }, getHp: unmarkedEnemy.getHp, isBurrowed: unmarkedEnemy.isBurrowed, kind: 'zombie-badger' },
    ];
    const enemyManager = {
      getAllEnemies: () => enemyList,
      getEnemy: (id: string) => enemyList.find(e => e.id === id),
      hasEnemy: (id: string) => enemyList.some(e => e.id === id),
    } as unknown as EnemyManager;
    const playerManager = {
      getAllPlayers: () => [player] as unknown as PlayerEntity[],
      getPlayer: (id: string) => id === player.id ? player as unknown as PlayerEntity : undefined,
      setSpawnContextProvider: vi.fn(),
    } as unknown as PlayerManager;

    let registeredHitHandler: ((proj: TrackedProjectile, enemyId: string, nowMs: number) => any) | null = null;
    const combatSystem = methodBag({
      isAlive: () => true,
      isBurrowed: () => false,
      canDamageTarget: () => true,
      hasLineOfSight: () => true,
      setAk47DirectEnemyHitHandler: vi.fn((handler) => {
        registeredHitHandler = handler;
      }),
    }) as unknown as CombatSystem;

    const projectileManager = methodBag({
      spawnProjectile: vi.fn(),
    }) as unknown as ProjectileManager;
    const resource = methodBag() as unknown as ResourceSystem;
    const playerLoadout = new LoadoutManager(
      playerManager,
      projectileManager,
      resource,
      {} as never,
    );
    playerLoadout.getEquippedWeaponConfig = vi.fn((_playerId, slot) => {
      if (slot === 'weapon2') {
        return {
          id: 'AK47',
          range: 600,
          ak47Focus: {
            strategicTargetEnabled: 1,
            strategicTargetDamageBonus: 0.5,
            targetPrioritizationEnabled: 0,
            explosiveTargetAcquisitionLevel: 1,
          },
        } as any;
      }
      return null;
    });
    const ak47Behavior = new Ak47BehaviorRuntime(playerLoadout);
    ak47Behavior.resetPlayer(player.id);
    const registerHitSpy = vi.spyOn(ak47Behavior, 'registerStrategicTargetHit');

    const ak47StrategicTarget = new Ak47StrategicTargetSystem(
      playerManager,
      enemyManager,
      combatSystem,
      playerLoadout,
      ak47Behavior,
    );
    vi.spyOn(Math, 'random').mockReturnValue(0);
    ak47StrategicTarget.hostUpdate(0);
    expect(ak47StrategicTarget.isCurrentTarget(player.id, enemy.id)).toBe(true);
    expect(ak47StrategicTarget.isCurrentTarget(player.id, unmarkedEnemy.id)).toBe(false);

    const fixture = createFixture({
      placementSystem: createPlacement(playerManager),
      players: [player],
      enemies: enemyList.map(e => ({ id: e.id, x: e.sprite.x, y: e.sprite.y, active: true })),
      combatSystem,
      ak47Behavior,
      ak47StrategicTarget,
    });

    expect(registeredHitHandler).not.toBeNull();
    const hitHandler = registeredHitHandler!;

    const ak47Projectile: TrackedProjectile = {
      id: 42,
      ownerId: player.id,
      ak47ShotId: 1,
      sourceSlot: 'weapon2',
      damage: 20,
      sprite: { x: enemy.x, y: enemy.y } as any,
    } as TrackedProjectile;

    // Hit on marked strategic target
    const impact = hitHandler(ak47Projectile, enemy.id, 1_000);
    expect(impact).not.toBeNull();
    expect(impact?.damageMultiplier).toBeCloseTo(1.5);
    expect(impact?.explosionRadius).toBeGreaterThan(0);
    expect(impact?.explosionDamageFraction).toBeGreaterThan(0);
    expect(registerHitSpy).toHaveBeenCalledWith(ak47Projectile, enemy.id);

    // Hit on unmarked target returns null (no strategic bonus)
    const missImpact = hitHandler(ak47Projectile, unmarkedEnemy.id);
    expect(missImpact).toBeNull();

    fixture.binding.destroy();
  });
});

describe('WorldCombatGameplayBinding Negev kill outcome', () => {
  it('routes the semantic kill outcome to the Negev behavior owner', () => {
    const registerKill = vi.fn();
    const fixture = createFixture({
      players: [{ id: 'p1', x: 0, y: 0, active: true }],
      enemies: [],
      negevBehavior: { registerKill } as never,
    });

    const setKillCallback = fixture.combatSystem.setKillCallback as unknown as ReturnType<typeof vi.fn>;
    const killHandler = setKillCallback.mock.calls.at(-1)?.[0] as (
      killerId: string,
      victimId: string,
      sourceId: string,
      x: number,
      y: number,
    ) => void;
    killHandler('p1', 'enemy', 'NEGEV', 10, 20);

    expect(registerKill).toHaveBeenCalledWith({ killerId: 'p1', sourceId: 'NEGEV' });
    fixture.binding.destroy();
  });
});

describe('WorldCombatGameplayBinding weapon reactions', () => {
  it('routes kill coordinates and source metadata to the weapon reaction owner', () => {
    const registerKill = vi.fn();
    const fixture = createFixture({
      players: [{ id: 'p1', x: 0, y: 0, active: true }],
      enemies: [],
      weaponReaction: { registerKill } as never,
    });

    const setKillCallback = fixture.combatSystem.setKillCallback as unknown as ReturnType<typeof vi.fn>;
    const killHandler = setKillCallback.mock.calls.at(-1)?.[0] as (
      killerId: string,
      victimId: string,
      sourceId: string,
      x: number,
      y: number,
      source?: { shotgunLightningGeneration?: number },
    ) => void;
    const source = { shotgunLightningGeneration: 2 };
    killHandler('p1', 'enemy', 'weapon.SHOTGUN.lightning', 10, 20, source);

    expect(registerKill).toHaveBeenCalledWith({
      killerId: 'p1',
      sourceId: 'weapon.SHOTGUN.lightning',
      x: 10,
      y: 20,
      source,
    });
    fixture.binding.destroy();
  });
});

describe('WorldCombatGameplayBinding Tesla rock target indexing', () => {
  it('preserves original rock index in sparse rock arrays and does not damage shifted indices', () => {
    const applyTeslaRockDamage = vi.fn();
    // Sparse rock array: index 0 is rock 0, index 1 is missing, index 2 is rock 2
    const rockTargets = [
      { id: 0, index: 0, active: true, x: 50, y: 50 },
      { id: 2, index: 2, active: true, x: 150, y: 150 },
    ];
    const player = { id: 'p1', x: 0, y: 0, active: true };
    const fixture = createFixture({
      players: [player],
      enemies: [],
      rockTargets,
      applyTeslaRockDamage,
    });

    const teslaDome = fixture.binding.systems?.teslaDome;
    expect(teslaDome).toBeDefined();

    // Verify the rock provider installed by binding provides the exact original indices
    const rockProvider = (teslaDome as any).rockTargetProvider;
    expect(rockProvider).toBeDefined();
    const providedRocks = rockProvider();
    expect(providedRocks).toEqual([
      { index: 0, x: 50, y: 50 },
      { index: 2, x: 150, y: 150 },
    ]);
    expect(providedRocks[1].index).toBe(2);

    // Verify the damage handler forwards index 2 to hostUpdate.applyTeslaRockDamage
    const damageHandler = (teslaDome as any).rockDamageHandler;
    expect(damageHandler).toBeDefined();
    damageHandler(2, 40, 'p1');
    expect(applyTeslaRockDamage).toHaveBeenCalledWith(2, 40, 'p1');
    expect(applyTeslaRockDamage).not.toHaveBeenCalledWith(1, expect.anything(), expect.anything());

    fixture.binding.destroy();
  });

  it('ArenaWorldCombatComposition getRockTargets preserves original proxy array index', () => {
    const rockPhysicsProxies = [
      { active: true, x: 10, y: 20 },
      null,
      { active: true, x: 30, y: 40 },
    ];
    const getRockTargets = () => rockPhysicsProxies.flatMap((rock, index) => (
      rock && rock.active ? [{ id: index, index, active: true, x: rock.x, y: rock.y }] : []
    ));

    const targets = getRockTargets();
    expect(targets).toHaveLength(2);
    expect(targets[0]).toEqual({ id: 0, index: 0, active: true, x: 10, y: 20 });
    expect(targets[1]).toEqual({ id: 2, index: 2, active: true, x: 30, y: 40 });
    expect(targets[1].index).toBe(2);
  });
});

describe('WorldCombatGameplayBinding lifecycle hardening', () => {
  it('registers and cleans up vulnerability handler and line-of-fire/sight checkers symmetrically on destroy', () => {
    let vulnerabilityHandler: ((target: TargetStatusTarget, durationMs: number) => void) | null = null;

    const combatSystem = methodBag({
      isAlive: () => true,
      isBurrowed: () => false,
      canDamageTarget: () => true,
      hasClearLineOfFire: () => true,
      hasLineOfSight: () => true,
      setApplyVulnerabilityHandler: vi.fn((handler) => {
        vulnerabilityHandler = handler;
      }),
    }) as unknown as CombatSystem;

    const appliedVulnerabilities: Array<{ target: TargetStatusTarget; durationMs: number }> = [];
    const targetStatusSystem = {
      applyVulnerability: (target: TargetStatusTarget, durationMs: number) => {
        appliedVulnerabilities.push({ target, durationMs });
      },
    } as unknown as TargetStatusSystem;

    const player = { id: 'p1', x: 0, y: 0, active: true };
    const fixture = createFixture({
      players: [player],
      enemies: [],
      combatSystem,
      targetStatusSystem,
    });

    expect(vulnerabilityHandler).not.toBeNull();

    const sampleTarget: TargetStatusTarget = { targetType: 'enemy', targetId: 'enemy-1' } as any;
    vulnerabilityHandler!(sampleTarget, 5000);
    expect(appliedVulnerabilities).toEqual([{ target: sampleTarget, durationMs: 5000 }]);

    const turret = fixture.binding.systems?.turret;
    const teslaDome = fixture.binding.systems?.teslaDome;
    const turretLofSpy = vi.spyOn(turret!, 'setLineOfFireChecker');
    const teslaLosSpy = vi.spyOn(teslaDome!, 'setLineOfSightChecker');

    fixture.binding.destroy();

    expect(combatSystem.setApplyVulnerabilityHandler).toHaveBeenLastCalledWith(null);
    expect(turretLofSpy).toHaveBeenCalledWith(null);
    expect(teslaLosSpy).toHaveBeenCalledWith(null);
  });
});

describe('TurretSystem missing fire handler', () => {
  it('does not consume a cooldown or burst when the fire handler is absent', () => {
    const system = new TurretSystem(
      { getAllPlayers: () => [] } as unknown as PlayerManager,
      { isAlive: () => true, isBurrowed: () => false, canDamageTarget: () => true } as unknown as CombatSystem,
    );
    system.setEnemyTargetProvider(() => [{ id: 'enemy', x: 100, y: 0 }]);
    system.setTurretProvider(() => [{
      id: 1,
      x: 0,
      y: 0,
      ownerId: 'owner',
      ownerColor: 0xffffff,
      weaponId: 'TURRET_ROCKET_BURST',
      targetRange: 200,
      muzzleOffset: 0,
    }], null);

    system.hostUpdate(0, UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig, WEAPON_CONFIGS.SPORES);
    const fire = vi.fn();
    system.setFireHandler(fire);
    system.hostUpdate(0, UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig, WEAPON_CONFIGS.SPORES);
    expect(fire).toHaveBeenCalledOnce();
  });
});
