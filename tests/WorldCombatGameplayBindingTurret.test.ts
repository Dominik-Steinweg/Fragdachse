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
import { CELL_SIZE, COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID } from '../src/config';
import { COOP_DEFENSE_CONSTRUCTIONS } from '../src/config/coopDefenseConstructions';
import type { BaseManager } from '../src/entities/BaseManager';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { PlayerEntity } from '../src/entities/PlayerEntity';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { ProjectileManager } from '../src/entities/ProjectileManager';
import { LoadoutManager } from '../src/loadout/LoadoutManager';
import { UTILITY_CONFIGS, WEAPON_CONFIGS, type PlaceableTurretUtilityConfig } from '../src/loadout/LoadoutConfig';
import type { ResourceSystem } from '../src/systems/ResourceSystem';
import type { CombatSystem } from '../src/systems/CombatSystem';
import type { DecoySystem } from '../src/systems/DecoySystem';
import type { FireSystem } from '../src/effects/FireSystem';
import type { GameAudioSystem } from '../src/audio/GameAudioSystem';
import type { HostPhysicsSystem } from '../src/systems/HostPhysicsSystem';
import { PlacementSystem } from '../src/systems/PlacementSystem';
import { TurretSystem } from '../src/systems/TurretSystem';
import type { ArenaLayout, PlayerProfile } from '../src/types';
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

interface TurretFixture {
  readonly binding: WorldCombatGameplayBinding;
  readonly projectileManager: ProjectileManager;
  readonly playerLoadout: LoadoutManager;
  readonly playerManager: PlayerManager;
  readonly metrics: ReturnType<typeof resolveActiveArenaWorldMetrics>;
}

function createFixture(options: {
  readonly placementSystem: PlacementSystem;
  readonly players: readonly { id: string; x: number; y: number; active: boolean }[];
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
}): TurretFixture {
  const playerManager = {
    getAllPlayers: () => options.players as readonly PlayerEntity[] as PlayerEntity[],
    getPlayer: (id: string) => options.players.find((player) => player.id === id) as PlayerEntity | undefined,
    setSpawnContextProvider: vi.fn(),
  } as unknown as PlayerManager;
  const projectileManager = methodBag({
    spawnProjectile: vi.fn(),
  }) as unknown as ProjectileManager;
  const combatSystem = methodBag({
    isAlive: vi.fn(() => true),
    isBurrowed: vi.fn(() => false),
    canDamageTarget: vi.fn(() => true),
    hasClearLineOfFire: vi.fn(() => true),
  }) as unknown as CombatSystem;
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
    ak47StrategicTarget: null,
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
  const binding = new WorldCombatGameplayBinding({
    playerManager,
    projectileManager,
    combatSystem,
    hostPhysics: methodBag() as unknown as HostPhysicsSystem,
    decoySystem: methodBag() as unknown as DecoySystem,
    fireSystem: methodBag() as unknown as FireSystem,
    gameAudioSystem: methodBag() as unknown as GameAudioSystem,
    placementSystem: options.placementSystem,
    baseManager,
    worldMetrics: metrics,
    isCoopMission: () => false,
    isActivityActive: () => true,
    getSpawnContext: () => undefined,
    getWorldParticipation: () => ({}) as never,
    getPlayerCapabilities: () => ({ canUseCombat: true }),
    getEnemyManager: () => enemyManager,
    getPlayerSystems: () => playerSystems,
    getPowerUpSystem: () => options.powerUpDamageMultiplier === undefined
      ? null
      : { getDamageMultiplier: () => options.powerUpDamageMultiplier } as never,
    getTargetStatusSystem: () => null,
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
    getRockTargets: () => [],
    getWorldTrain: () => null,
    getTimebombSystem: () => null,
    getNecromancySystem: () => null,
    hostUpdate: methodBag() as never,
    createEnergyShieldSystem: () => methodBag() as never,
    network,
    respawnPlayer: () => true,
  } satisfies WorldCombatGameplayBindingOptions);
  return { binding, projectileManager, playerLoadout, playerManager, metrics };
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
