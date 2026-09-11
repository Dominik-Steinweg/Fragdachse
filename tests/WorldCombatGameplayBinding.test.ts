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
import type { CombatTargetRef } from '../src/combat/CombatScope';
import {
  CELL_SIZE,
  COOP_DEFENSE_BASE_TURRET_OWNER_ID,
  COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID,
} from '../src/config';
import { COOP_DEFENSE_CONSTRUCTIONS } from '../src/config/coopDefenseConstructions';
import type { BaseManager } from '../src/entities/BaseManager';
import type { BaseEntity } from '../src/entities/BaseEntity';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { PlayerEntity } from '../src/entities/PlayerEntity';
import type { PlayerManager } from '../src/entities/PlayerManager';
import { LoadoutManager } from '../src/loadout/LoadoutManager';
import { Ak47BehaviorRuntime } from '../src/world/Ak47BehaviorRuntime';
import { WorldWeaponExecutionRuntime } from '../src/world/WorldWeaponExecutionRuntime';
import type { ProjectileSpawnRequest } from '../src/projectile/ProjectileSpawnRequest';
import { AutomatedWeaponExecutionAdapter } from '../src/world/AutomatedWeaponExecutionAdapter';
import { UTILITY_CONFIGS, WEAPON_CONFIGS, type PlaceableTurretUtilityConfig } from '../src/loadout/LoadoutConfig';
import type { ResourceSystem } from '../src/systems/ResourceSystem';
import type { WorldCombatCore as CombatSystem } from '../src/combat/WorldCombatCore';
import type { DecoySystem } from '../src/systems/DecoySystem';
import type { FireSystem } from '../src/effects/FireSystem';
import type { GameAudioSystem } from '../src/audio/GameAudioSystem';
import type { HostPhysicsSystem } from '../src/systems/HostPhysicsSystem';
import { PlacementSystem } from '../src/systems/PlacementSystem';
import { TurretSystem } from '../src/systems/TurretSystem';
import { Ak47StrategicTargetSystem } from '../src/systems/Ak47StrategicTargetSystem';
import type { TargetStatusSystem, TargetStatusTarget } from '../src/systems/TargetStatusSystem';
import type { ArenaLayout, PlayerProfile } from '../src/types';
import type { ProjectileAk47HitContext } from '../src/projectile/ProjectileCombatPort';
import { resolveActiveArenaWorldMetrics } from '../src/world/WorldMetrics';
import {
  WorldCombatGameplayBinding,
  type WorldCombatGameplayBindingOptions,
} from '../src/world/WorldCombatGameplayBinding';
import type { PlayerCombatIntegrationPort } from '../src/world/PlayerCombatIntegrationPort';
import { mgTarget } from './MgTurretTestHelper';
import { resolveMgTurretStats } from '../src/config/mgTurret';

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
        method = property === 'observeEnemyDamageCommitted' ? vi.fn(() => vi.fn()) : vi.fn();
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
  readonly projectileEvents: Record<string, unknown>;
  readonly decoySystem: DecoySystem;
  readonly fireSystem: FireSystem;
  readonly binding: WorldCombatGameplayBinding;
  readonly hostPhysics: HostPhysicsSystem;
  readonly playerCombat: PlayerCombatIntegrationPort;
  readonly projectileSpawn: { spawnProjectile: ReturnType<typeof vi.fn> };
  readonly projectileUtility: { focusProjectilesInCircle: ReturnType<typeof vi.fn>; destroyProjectile: ReturnType<typeof vi.fn> };
  readonly projectileInteraction: Record<string, ReturnType<typeof vi.fn>>;
  readonly playerLoadout: LoadoutManager;
  readonly playerManager: PlayerManager;
  readonly baseManager: BaseManager;
  readonly combatSystem: CombatSystem;
  readonly metrics: ReturnType<typeof resolveActiveArenaWorldMetrics>;
}

function createFixture(options: {
  readonly coop?: boolean;
  readonly activity?: () => boolean;
  readonly participants?: () => readonly string[];
  readonly observer?: (id: string) => boolean;
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
  readonly ak47Behavior?: PlayerCombatIntegrationPort['ak47'];
  readonly negevBehavior?: { registerKill(outcome: { killerId: string; sourceId: string }): void };
  readonly sustainedWeaponBehavior?: PlayerCombatIntegrationPort['sustainedWeapon'];
  readonly weaponReaction?: { registerKill(outcome: Parameters<PlayerCombatIntegrationPort['reactions']['registerKill']>[0]): void };
  readonly ak47StrategicTarget?: Ak47StrategicTargetSystem | null;
  readonly rockTargets?: readonly { id?: number; index: number; active: boolean; x: number; y: number }[];
  readonly applyTeslaRockDamage?: (index: number, damage: number, ownerId: string) => void;
  readonly targetStatusSystem?: TargetStatusSystem | null;
  readonly baseManager?: BaseManager;
}): TurretFixture {
  const playerManager = {
    getAllPlayers: () => options.players as readonly PlayerEntity[] as PlayerEntity[],
    getPlayer: (id: string) => options.players.find((player) => player.id === id) as PlayerEntity | undefined,
    setSpawnContextProvider: vi.fn(),
  } as unknown as PlayerManager;
  const projectileEvents = methodBag();
  const projectileTimeField = methodBag();
  const projectileHoming = methodBag();
  const projectileWorldImpact = methodBag();
  const projectileSwarm = methodBag();
  const combatSystem = options.combatSystem ?? (methodBag({
    observeEnemyDamageCommitted: vi.fn(() => () => {}),
    getCombatScope: vi.fn(() => ({ worldRevision: 1, runtimeGeneration: 1 })),
    isAlive: vi.fn(() => true),
    isBurrowed: vi.fn(() => false),
    canDamageTarget: vi.fn(() => true),
    hasClearLineOfFire: vi.fn(() => true),
    hasLineOfSight: vi.fn(() => true),
  }) as unknown as CombatSystem);
  const enemyManager = {
    getCombatTargetRef: (id: string) => mgTarget(id).ref,
    getHostileEnemies: () => options.enemies.map(enemy => ({ id: enemy.id, sprite: { active: enemy.active, x: enemy.x, y: enemy.y }, getHp: () => 1000 })),
    getAllEnemies: () => options.enemies.map((enemy) => ({
      id: enemy.id,
      sprite: { active: enemy.active, x: enemy.x, y: enemy.y },
    })),
    getEnemy: () => undefined,
    hasEnemy: () => false,
  } as unknown as EnemyManager;
  const baseManager = options.baseManager ?? methodBag({
    getBases: () => [],
    getTurrets: () => options.baseTurrets ?? [],
    getBasesByFaction: () => [],
    getBase: () => undefined,
    getObstacleRectangles: () => null,
  }) as unknown as BaseManager;
  const resource = methodBag() as unknown as ResourceSystem;
  const playerLoadout = new LoadoutManager(
    resource,
    {} as never,
  );
  // Die gemeinsame Immediate-Fire-Capability und der explizite Automatik-Adapter werden beide
  // an der World-Grenze erzeugt; Player- und Turmquellen teilen nur die Ausführung.
  // Der world-owned Owner ist hier ein reiner Spawn-Port: das Wiring, nicht die Registry, steht auf dem Pruefstand.
  const projectileSpawn = { spawnProjectile: vi.fn((_request: ProjectileSpawnRequest) => 1) };
  // Der world-owned Owner nimmt hier nur die gebundenen Collision-/Defense-Ports entgegen.
  const projectileInteraction = {
    setProjectileTargetabilityPort: vi.fn(),
    setProjectileCollisionTargetQueryPort: vi.fn(),
    setProjectileWorldBlockerPort: vi.fn(),
    setProjectileBarrierPort: vi.fn(),
    setProjectileCombatPort: vi.fn(),
    setTimeBubbleChargePort: vi.fn(),
    setProjectileMiniRocketStatePort: vi.fn(),
  };
  const weaponExecution = new WorldWeaponExecutionRuntime({
    projectileSpawn,
    combatSystem: combatSystem as unknown as ConstructorParameters<typeof WorldWeaponExecutionRuntime>[0]['combatSystem'],
  });
  const automatedWeaponExecution = new AutomatedWeaponExecutionAdapter(weaponExecution, projectileSpawn);
  if (options.loadoutDamageMultiplier !== undefined) {
    vi.spyOn(playerLoadout, 'getDamageMultiplier').mockReturnValue(options.loadoutDamageMultiplier);
  }
  const playerCombat: PlayerCombatIntegrationPort = {
    resource,
    movement: { tryExitBurrowForDash: vi.fn(() => false) },
    modifier: methodBag() as never,
    item: methodBag({
      getRemoteControlDamageMultiplier: vi.fn(() => 1),
    }) as never,
    state: {
      isBurrowed: vi.fn(() => false),
      isStunned: vi.fn(() => false),
      isDashBlocked: vi.fn(() => false),
      getMovementSpeedFactor: vi.fn(() => 1),
      isWeaponBlocked: vi.fn(() => false),
    },
    loadout: {
      getEquippedWeaponConfig: (playerId, slot) => playerLoadout.getEquippedWeaponConfig(playerId, slot),
      getDamageMultiplier: (playerId, nowMs) => playerLoadout.getDamageMultiplier(playerId, nowMs),
      getWeaponDamageMultiplier: (playerId, slot, nowMs) => playerLoadout.getWeaponDamageMultiplier(playerId, slot, nowMs),
      getSpeedMultiplier: (playerId, nowMs) => playerLoadout.getSpeedMultiplier(playerId, nowMs),
      getHeldSelfPushVelocity: (playerId, nowMs) => playerLoadout.getHeldSelfPushVelocity(playerId, nowMs),
    },
    utility: methodBag() as never,
    ak47: options.ak47Behavior ?? null,
    sustainedWeapon: options.sustainedWeaponBehavior ?? methodBag({
      setTeslaDomeSystem: vi.fn(),
      setEnergyShieldSystem: vi.fn(),
    }) as never,
    slimeTrail: null,
    reactions: {
      handleDirectPrimaryHit: vi.fn(() => ({ slowFraction: 0, slowDurationMs: 0, shouldCull: false })),
      handlePlayerDamageTaken: vi.fn(() => ({ adrenalineGain: 0, reflectedDamage: 0 })),
      handleDirectAk47EnemyHit: (projectile, enemyId, nowMs) => (
        options.ak47StrategicTarget?.handleDirectAk47EnemyHit(projectile, enemyId, nowMs) ?? null
      ),
      handleNaturalFlameExpiry: vi.fn(),
      handleEnemyDeath: vi.fn(() => null),
      removeEnemy: vi.fn(),
      handlePlayerDeath: vi.fn(),
      resolveProjectile: (projectile) => options.ak47Behavior?.resolveProjectile(projectile),
      registerKill: (outcome) => {
        options.negevBehavior?.registerKill({ killerId: outcome.killerId, sourceId: outcome.sourceId });
        options.weaponReaction?.registerKill(outcome);
      },
    },
  };
  const metrics = resolveActiveArenaWorldMetrics();
  const network = {
    authority: {
      isHost: () => true,
      isEnemyPair: (a: string, b: string) => a !== b && !options.coop,
      getPlayerProfile: (id: string) => options.players.find(player => player.id === id) as unknown as PlayerProfile | undefined,
      getConnectedPlayers: (): readonly PlayerProfile[] => (options.participants?.() ?? []).map(id => ({ id } as PlayerProfile)),
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
  const hostPhysics = methodBag() as unknown as HostPhysicsSystem;
  const decoySystem = methodBag() as unknown as DecoySystem;
  const projectileUtility = { focusProjectilesInCircle: vi.fn(() => 1), destroyProjectile: vi.fn() };
  const fireSystem = methodBag() as unknown as FireSystem;
  const binding = new WorldCombatGameplayBinding({
    playerManager,
    projectileSpawn,
    projectileUtility,
    projectileEvents,
    projectileTimeField,
    projectileHoming,
    projectileWorldImpact,
    projectileSwarm,
    projectileInteraction,
    combatSystem,
    hostPhysics,
    decoySystem,
    fireSystem,
    gameAudioSystem: methodBag() as unknown as GameAudioSystem,
    placementSystem: placement,
    baseManager,
    worldMetrics: metrics,
    isCoopMission: () => false,
    isActivityActive: options.activity ?? (() => true),
    isCoopDefense: () => options.coop ?? false,
    getSpawnContext: () => undefined,
    getWorldParticipation: id => options.observer?.(id) ? 'observer' : 'interactive',
    getPlayerCapabilities: () => ({ canUseCombat: true }),
    getEnemyManager: () => enemyManager,
    getPlayerCombatIntegration: () => playerCombat,
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
    getWorldMutation: () => null,
    updateTurretAngle: vi.fn(),
    spawnImpactCloud: vi.fn(),
    resetPlayerPosition: vi.fn(),
    dropBeer: vi.fn(),
    dropCarryForPlayer: vi.fn(),
    handlePlayerUnavailable: vi.fn(),
    handlePlayerDeath: vi.fn(),
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
  return { binding, hostPhysics, playerCombat, projectileSpawn, projectileUtility, projectileInteraction, projectileEvents, playerLoadout, playerManager, combatSystem, metrics, baseManager, decoySystem, fireSystem };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('personal MG profile and World lifetime', () => {
  it('prioritizes valid focus, active attrition, distance and stable identity and reevaluates between shots', () => {
    const turret = new TurretSystem({ getAllPlayers: () => [] } as never,
      { isAlive: () => true, isBurrowed: () => false, canDamageTarget: () => true });
    turret.setTurretProvider(() => [{ id: 't', x: 0, y: 0, ownerId: 'owner', ownerColor: 0xffffff, weaponId: 'TURRET_MG', targetRange: 400, muzzleOffset: 0 }], null);
    const scores = new Map<string, number>([['far', 10]]);
    let enemies = [{ id: 'near', x: 50, y: 0 }, { id: 'far', x: 200, y: 0 }];
    let focus: { targetType: 'enemy' | 'base'; targetId: string } | null = null;
    let blockedX: number | null = null;
    turret.setEnemyTargetProvider(() => enemies); turret.setTargetScoreProvider((_turret,_kind,id) => scores.get(id) ?? 0);
    turret.setFocusTargetProvider(() => focus); turret.setFocusedBaseTargetProvider(() => ({ id: 'base', x: 300, y: 0 }));
    turret.setLineOfFireChecker((_sx,_sy,ex) => ex !== blockedX);
    const fire = vi.fn(); turret.setFireHandler(fire); let now = 0;
    const target = () => { turret.hostUpdate(now += 1000, UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig, WEAPON_CONFIGS.SPORES); return fire.mock.calls.at(-1)!.slice(6,8); };
    expect(target()).toEqual([200,0]); focus = { targetType: 'enemy', targetId: 'near' }; expect(target()).toEqual([50,0]);
    focus = { targetType: 'base', targetId: 'base' }; expect(target()).toEqual([300,0]);
    blockedX = 300; expect(target()).toEqual([200,0]);
    focus = null; scores.clear(); expect(target()).toEqual([50,0]);
    enemies = [{ id: 'z', x: -100, y: 0 }, { id: 'a', x: 100, y: 0 }]; expect(target()).toEqual([100,0]);
    enemies.reverse(); expect(target()).toEqual([100,0]);
  });
  it('updates restored personal MGs immediately, preserves fire cooldown and leaves base-owned MGs unchanged', () => {
    const placement = createPlacement({ getAllPlayers: () => [] } as never);
    const personal = placement.materializePersistentPlaceable(COOP_DEFENSE_CONSTRUCTIONS.machine_gun_turret, 10, 10, 0, 'owner', 0xffffff, 'host-persistent')!;
    const independent = placement.materializePersistentPlaceable(COOP_DEFENSE_CONSTRUCTIONS.machine_gun_turret, 12, 10, 0, 'base', 0xffffff, 'base-owned')!;
    const metrics = resolveActiveArenaWorldMetrics(), x = metrics.offsetX + 10 * CELL_SIZE + CELL_SIZE / 2, y = metrics.offsetY + 10 * CELL_SIZE + CELL_SIZE / 2;
    const f = createFixture({ coop: true, placementSystem: placement, players: [{ id: 'owner', x: 0, y: 0, active: true }],
      enemies: [{ id: 'enemy', x: x + 100, y, active: true }] });
    let range = 0, frequency = 0;
    vi.mocked(f.playerCombat.modifier.getNumericStat).mockReturnValue(0);
    vi.mocked(f.playerCombat.modifier.getPercentageStat).mockImplementation((_id, stat) => stat.endsWith('.range') ? range : stat.endsWith('.frequency') ? frequency : 0);
    const fire = (now: number) => f.binding.systems!.turret.hostUpdate(now, UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig, WEAPON_CONFIGS.SPORES);
    const baseline = resolveMgTurretStats(); fire(0);
    const first = f.projectileSpawn.spawnProjectile.mock.calls.map(([request]) => request).find(request => request.provenance.sourceTurretId === String(personal.id))!;
    expect(first.interaction.directHit!.damage).toBe(baseline.damage);
    expect(first.provenance).toMatchObject({ personalMgOwnerId: 'owner', personalMgScope: { worldRevision: 1, runtimeGeneration: 1 }, attributionKind: 'player' });
    expect(f.projectileSpawn.spawnProjectile.mock.calls.find(([r]) => r.provenance.sourceTurretId === String(independent.id))![0].provenance.personalMgOwnerId).toBeUndefined();
    range = .6; frequency = .3;
    const personalRead = f.binding.systems!.turret.getTurrets().find(t => t.id === personal.id)!;
    const baseRead = f.binding.systems!.turret.getTurrets().find(t => t.id === independent.id)!;
    expect(personalRead.targetRange).toBeCloseTo(baseline.targetRange * 1.6);
    expect(personalRead.projectileRange).toBeCloseTo(baseline.projectileRange * 1.6);
    expect(personalRead.cooldownMs).toBeCloseTo(baseline.cooldownMs / 1.3);
    expect(baseRead.targetRange).toBe(independent.targetRange); expect(baseRead.cooldownMs).toBeUndefined();
    const before = f.projectileSpawn.spawnProjectile.mock.calls.length;
    fire(1); expect(f.projectileSpawn.spawnProjectile).toHaveBeenCalledTimes(before);
    fire(baseline.cooldownMs);
    const shotsFor = (id: number) => f.projectileSpawn.spawnProjectile.mock.calls.filter(([r]) => r.provenance.sourceTurretId === String(id));
    expect(shotsFor(personal.id)).toHaveLength(2);
    expect(shotsFor(independent.id)).toHaveLength(baseline.cooldownMs >= WEAPON_CONFIGS.TURRET_MG.cooldown ? 2 : 1);
    f.binding.destroy();
  });
  it('keeps lobby networks without a built MG, excludes observers and retains progress when participants change', () => {
    let participants = ['b']; const observers = new Set<string>(['spectator']);
    const f = createFixture({ coop: true, activity: () => false, participants: () => participants, observer: id => observers.has(id),
      players: [], enemies: [{ id: 'enemy', x: 300, y: 100, active: true }] });
    vi.mocked(f.playerCombat.modifier.getClassDefinition).mockReturnValue({ id: 'dachs_of_steel' } as never);
    vi.mocked(f.playerCombat.modifier.getNumericStat).mockImplementation((_id, stat) => stat.endsWith('.network') ? 1 : stat.endsWith('.perHitPercent') ? 2 : 0);
    const mg = f.binding.mgTurret!, target = mgTarget('enemy', 300);
    f.binding.advanceMgTurrets(0); mg.runtime.hit('b', 'removed', target, 0);
    participants = ['a', 'b', 'spectator']; f.binding.advanceMgTurrets(10);
    expect(mg.runtime.getPercent('a', 'anything', target.ref, 10)).toBe(2);
    expect(mg.runtime.getPercent('spectator', 'anything', target.ref, 10)).toBe(0);
    participants = ['b']; vi.mocked(f.combatSystem.isAlive).mockReturnValue(false); f.binding.advanceMgTurrets(20);
    expect(mg.runtime.getPercent('b', 'anything', target.ref, 20)).toBe(2);
    f.binding.clearActivityBindings(); expect(mg.runtime.snapshot(20).targets).toEqual([]);
    f.binding.advanceMgTurrets(21); expect(mg.runtime.getPercent('b', 'anything', target.ref, 21)).toBe(0);
    f.binding.destroy();
  });
});

describe('WorldCombatGameplayBinding projectile target geometry', () => {
  it('silently removes a charged utility bubble outside host execution during teardown', () => {
    const f = createFixture({ players: [], enemies: [] });
    const port = vi.mocked(f.playerCombat.utility.setTimeBubblePort!).mock.calls[0][0]!;
    const effect = { type: 'time_bubble' as const, chargeCapacity: 30, radius: 50, duration: 1000,
      playerSlowFactor: 0.1, projectileSlowFactor: 0.2, trainSlowFactor: 0.1 };
    const id = port.create('owner', 0, 0, effect, 1000);
    const bubbles = f.binding.systems!.timeBubble;
    bubbles.observeProjectile(1, 0, 0, 7, 1001);
    vi.mocked(f.combatSystem.getHostTime).mockImplementation(() => {
      throw Error('Missing active Host execution context');
    });
    expect(bubbles.isBubbleActive(id, 1100)).toBe(true);
    expect(() => port.remove(id)).not.toThrow();
    expect(bubbles.isBubbleActive(id, 1100)).toBe(false);
    bubbles.flushReleases(1100);
    expect(f.combatSystem.applyAoeDamage).not.toHaveBeenCalled();
    expect(f.playerCombat.utility.onTimeBubbleEnded).not.toHaveBeenCalled();
    expect(() => port.remove(id)).not.toThrow();
    f.binding.destroy();
  });

  it('resolves a consumed utility projectile between host frames in a host clock scope', () => {
    const f = createFixture({ players: [], enemies: [] });
    let inHostExecution = false;
    vi.mocked(f.combatSystem.runHostExecution).mockImplementation(work => {
      inHostExecution = true;
      try { return work(); } finally { inHostExecution = false; }
    });
    vi.mocked(f.combatSystem.getHostTime).mockImplementation(() => {
      if (!inHostExecution) throw Error('Missing active Host execution context');
      return 1234;
    });
    const callback = vi.mocked(f.projectileEvents.setProjectileResolvedCallback as (...args: any[]) => void).mock.calls[0][0];
    expect(() => callback({ kind: 'resolved', projectileId: 7 })).not.toThrow();
    expect(f.playerCombat.utility.onUtilityProjectileResolved).toHaveBeenCalledExactlyOnceWith(7, 1234, false);
    expect(inHostExecution).toBe(false);
    f.binding.destroy();
  });

  it.each([false, true])('removes before optional focus (%s), releases once and detaches lifetime callbacks', redirectProjectiles => {
    const f = createFixture({ players: [], enemies: [] });
    const port = vi.mocked(f.playerCombat.utility.setTimeBubblePort!).mock.calls[0][0]!;
    const effect = { type: 'time_bubble' as const, chargeCapacity: 30, radius: 50, duration: 1000, playerSlowFactor: 0.1, projectileSlowFactor: 0.2, trainSlowFactor: 0.1 };
    const id = port.create('owner', 0, 0, effect, 1000);
    f.binding.systems!.timeBubble.observeProjectile(1, 0, 0, 7, 1001);
    vi.mocked(f.combatSystem.runHostExecution).mockImplementation(work => work());
    f.projectileUtility.focusProjectilesInCircle.mockImplementation(() => {
      expect(f.combatSystem.applyAoeDamage).not.toHaveBeenCalled();
      expect(f.binding.systems!.timeBubble.getProjectileMovementFactorAt(0, 0, 1100)).toBe(1);
      return 1;
    });
    expect(port.collapse(id, { targetX: 100, targetY: 200, ownerId: 'owner', ownerColor: 0xffffff, nowMs: 1100, redirectProjectiles })).toBe(true);
    expect(f.playerCombat.utility.onTimeBubbleEnded).toHaveBeenCalledWith(id, 1100);
    expect(f.projectileUtility.focusProjectilesInCircle).toHaveBeenCalledTimes(redirectProjectiles ? 1 : 0);
    expect(f.combatSystem.applyAoeDamage).toHaveBeenCalledExactlyOnceWith(0, 0, effect.radius, 7, 'owner', false,
      expect.objectContaining({ sourceId: 'TIME_BUBBLE', sourceSlot: 'utility', allowCritical: false,
        damageBasis: expect.objectContaining({ kind: 'source-resolved', amount: 7 }) }));
    expect(port.collapse(id, { targetX: 0, targetY: 0, ownerId: 'owner', ownerColor: 0xffffff, nowMs: 1100, redirectProjectiles })).toBe(false);
    f.binding.destroy();
    expect(f.playerCombat.utility.setTimeBubblePort).toHaveBeenLastCalledWith(null);
    expect(f.projectileInteraction.setTimeBubbleChargePort).toHaveBeenLastCalledWith(null);
    expect(f.combatSystem.setTimeBubbleChargePort).toHaveBeenLastCalledWith(null);
  });
  it('rebuilds cached base bounds after a same-id base replacement revision', () => {
    let generation = 0;
    const makeBase = (left: number): BaseEntity => ({
      id: 'base-same-id',
      isInert: () => false,
      getCellBodies: () => [{
        getBounds: () => ({ left, top: 10, right: left + 20, bottom: 30 }),
      }],
    } as unknown as BaseEntity);
    let bases: readonly BaseEntity[] = [makeBase(10)];
    const baseManager = methodBag({
      getBases: () => bases,
      getObstacleGeneration: () => generation,
      getTurrets: () => [],
      getBasesByFaction: () => [],
      getBase: () => undefined,
      getObstacleRectangles: () => [],
    }) as unknown as BaseManager;
    const fixture = createFixture({ players: [], enemies: [], baseManager });
    const query = vi.mocked(fixture.projectileInteraction.setProjectileCollisionTargetQueryPort)
      .mock.calls.at(-1)![0]!;
    const readBase = (): { x: number; y: number; left: number } => {
      let target: { x: number; y: number; left: number } | undefined;
      query.readCollisionTargets((kind, _id, _ownerId, x, y, _radius, left) => {
        if (kind === 'base') target = { x, y, left };
      });
      if (!target) throw new Error('Expected active base target');
      return target;
    };

    expect(readBase()).toEqual({ x: 20, y: 20, left: 10 });
    const rebuilt = makeBase(110);
    bases = [rebuilt];
    generation += 1;
    expect(readBase()).toEqual({ x: 120, y: 20, left: 110 });
    fixture.binding.destroy();
  });
});

describe('Decoy combat and fire ports', () => {
  it('uses ordinary radial falloff, hostile impulse filtering and the generic chunk port', () => {
    const f = createFixture({ players: [], enemies: [] });
    const burst = vi.fn();
    Object.assign(f.playerCombat, { fireChunks: { hostCreateFireChunkBurst: burst } });
    const event = { decoy: { id: 7, ownerId: 'owner', config: { id: 'DECOY', explosionRadius: 150,
      explosionDamage: 100, explosionMinDamage: 25, explosionKnockback: 500,
      fireChunkBurst: { count: 3, searchRadius: 96, flightMs: 320, durationMs: 2000,
        burnDurationMs: 2000, burnDamagePerTick: 0.25 } } }, x: 300, y: 320 };
    const end = vi.mocked(f.decoySystem.setEndEffectHandler).mock.calls[0][0]!;
    end(event as never, 1234);
    expect(f.combatSystem.applyAoeDamage).toHaveBeenCalledExactlyOnceWith(300, 320, 150, 100, 'owner', false,
      expect.objectContaining({ damageFalloff: { minDamage: 25 }, allowTeamDamage: false, sourceSlot: 'utility' }));
    const impulse = vi.mocked(f.hostPhysics.applyRadialImpulse).mock.calls[0];
    expect(impulse.slice(0, 6)).toEqual([300, 320, 150, 500, 'owner', 0]);
    vi.mocked(f.combatSystem.canDamageTarget).mockImplementation((_owner, id) => id === 'hostile');
    expect(impulse[7]!('ally')).toBe(false); expect(impulse[7]!('owner')).toBe(false);
    expect(impulse[7]!('hostile')).toBe(true);
    expect(burst).toHaveBeenCalledExactlyOnceWith('owner', 300, 320, event.decoy.config.fireChunkBurst, 'decoy:7', 1234);
    const trail = vi.mocked(f.decoySystem.setTrailHandler).mock.calls[0][0]!;
    Object.assign(event.decoy.config, { fireTrailDurationMs: 4000 });
    trail(event.decoy as never, 300, 300, 364, 316, 1400);
    expect(f.fireSystem.hostRefreshGroundCellsAlongSegment).toHaveBeenCalledExactlyOnceWith(300, 300, 364, 316,
      expect.objectContaining({ sourceKey: 'decoy-trail:7', durationMs: 4000, visualStyle: 'normal',
        burn: { durationMs: 2000, damagePerTick: 0.25 } }), 1400);
    f.binding.destroy();
    expect(f.decoySystem.setEndEffectHandler).toHaveBeenLastCalledWith(null);
    expect(f.decoySystem.setTrailHandler).toHaveBeenLastCalledWith(null);
  });
});

describe('WorldCombatGameplayBinding turret fire wiring', () => {
  it('routes Burrow dash exits to the player movement owner and detaches the command on teardown', () => {
    const f = createFixture({ players: [], enemies: [] });
    const handler = vi.mocked(f.hostPhysics.setBurrowDashExitHandler).mock.calls.at(-1)![0]!;
    const exit = vi.mocked(f.playerCombat.movement.tryExitBurrowForDash);
    expect(handler('p1')).toBe(false);
    exit.mockReturnValue(true);
    expect(handler('p1')).toBe(true);
    expect(exit).toHaveBeenLastCalledWith('p1');
    f.binding.destroy();
    expect(f.hostPhysics.setBurrowDashExitHandler).toHaveBeenLastCalledWith(null);
  });

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

    const spawn = fixture.projectileSpawn.spawnProjectile;
    expect(spawn).toHaveBeenCalledOnce();
    const request = spawn.mock.calls[0][0] as ProjectileSpawnRequest;
    expect(request.provenance).toMatchObject({
      attributionId: player.id,
      sourceTurretId: String(placed.id),
      sourceSlot: 'utility',
    });
    expect(request.flight.collisionFilter).toMatchObject({
      ignoreRockIndex: placed.id,
      ignoreBaseCollisions: false,
    });
    expect(request.interaction.directHit?.damage)
      .toBe(WEAPON_CONFIGS.TURRET_ROCKET_BURST.damage * 1.25);
    expect(request.interaction.explosion?.maxDamage).toBe(14 * 1.25 * 1.5 * 2);
    expect(request.interaction.explosion?.appliedSourceDamageFactors).toEqual([
      { kind: 'automated-source', multiplier: 1.25, resolvedAt: 'execution' },
      { kind: 'runtime-power', multiplier: 1.5 * 2, resolvedAt: 'execution' },
    ]);
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

    const spawn = fixture.projectileSpawn.spawnProjectile;
    expect(spawn).toHaveBeenCalledOnce();
    const request = spawn.mock.calls[0][0] as ProjectileSpawnRequest;
    expect(request.provenance).toMatchObject({
      attributionId: COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID,
      sourceTurretId: 'hostile-base:front',
    });
    expect(request.flight.collisionFilter?.ignoreBaseCollisions).toBe(true);
    expect(request.flight.homing).toMatchObject({ targetTypes: ['players'] });
    expect(request.provenance.sourceSlot).toBeUndefined();
    expect(request.flight.collisionFilter?.ignoreRockIndex).toBeUndefined();
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

    const spawn = fixture.projectileSpawn.spawnProjectile;
    expect(spawn).toHaveBeenCalledOnce();
    const request = spawn.mock.calls[0][0] as ProjectileSpawnRequest;
    expect(request.provenance).toMatchObject({
      attributionId: COOP_DEFENSE_BASE_TURRET_OWNER_ID,
      sourceTurretId: String(placed.id),
    });
    expect(request.provenance.sourceSlot).toBeUndefined();
    expect(request.flight.collisionFilter).toMatchObject({
      ignoreBaseCollisions: true,
      ignoreRockIndex: placed.id,
    });
    expect(request.interaction.directHit?.damage).toBe(WEAPON_CONFIGS.SPORES.damage);
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

    let registeredHitHandler: ((proj: ProjectileAk47HitContext, enemyId: string, nowMs: number) => any) | null = null;
    const combatSystem = methodBag({
      isAlive: () => true,
      isBurrowed: () => false,
      canDamageTarget: () => true,
      hasLineOfSight: () => true,
      setAk47DirectEnemyHitHandler: vi.fn((handler) => {
        registeredHitHandler = handler;
      }),
    }) as unknown as CombatSystem;

    const resource = methodBag() as unknown as ResourceSystem;
    const playerLoadout = new LoadoutManager(
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

    const ak47Projectile: ProjectileAk47HitContext = {
      ownerId: player.id,
      shotId: 1,
      fireSuperiorityShot: false,
    };

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
      victimId: 'enemy',
      sourceId: 'weapon.SHOTGUN.lightning',
      x: 10,
      y: 20,
      source: { ...source, enemyXp: 0 },
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
    let vulnerabilityHandler: ((target: TargetStatusTarget, durationMs: number, nowMs: number) => void) | null = null;
    let lifeEnded: ((target: CombatTargetRef) => void) | null = null;
    let currentLife = true;

    const combatSystem = methodBag({
      isAlive: () => true,
      isBurrowed: () => false,
      canDamageTarget: () => true,
      hasClearLineOfFire: () => true,
      hasLineOfSight: () => true,
      setApplyVulnerabilityHandler: vi.fn((handler) => {
        vulnerabilityHandler = handler;
      }),
      isCurrentCombatantTarget: () => currentLife,
      setPlayerLifeEndedHandler: vi.fn(handler => { lifeEnded = handler; }),
    }) as unknown as CombatSystem;

    const appliedVulnerabilities: Array<{ target: TargetStatusTarget; durationMs: number; nowMs: number }> = [];
    const targetStatusSystem = {
      removeTarget: vi.fn(),
      applyVulnerability: (target: TargetStatusTarget, durationMs: number, nowMs: number) => {
        appliedVulnerabilities.push({ target, durationMs, nowMs });
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
    vulnerabilityHandler!(sampleTarget, 5000, 12_345);
    expect(appliedVulnerabilities).toEqual([{ target: sampleTarget, durationMs: 5000, nowMs: 12_345 }]);
    const oldLife: CombatTargetRef = { kind: 'player', id: 'p1', scope: { worldRevision: 1, runtimeGeneration: 1 },
      instance: { entityGeneration: 1, lifeRevision: 1 } };
    lifeEnded!(oldLife);
    expect(targetStatusSystem.removeTarget).toHaveBeenCalledExactlyOnceWith({ targetType: 'player', targetId: 'p1' });
    currentLife = false; lifeEnded!(oldLife);
    expect(targetStatusSystem.removeTarget).toHaveBeenCalledTimes(1);

    const turret = fixture.binding.systems?.turret;
    const teslaDome = fixture.binding.systems?.teslaDome;
    const turretLofSpy = vi.spyOn(turret!, 'setLineOfFireChecker');
    const teslaLosSpy = vi.spyOn(teslaDome!, 'setLineOfSightChecker');

    fixture.binding.destroy();

    expect(combatSystem.setApplyVulnerabilityHandler).toHaveBeenLastCalledWith(null);
    expect(combatSystem.setPlayerLifeEndedHandler).toHaveBeenLastCalledWith(null);
    expect(combatSystem.setEnemyLifeEndedHandler).toHaveBeenLastCalledWith(null);
    expect(combatSystem.setMovementStatusPort).toHaveBeenLastCalledWith(null);
    expect(combatSystem.setPlasmaSwarmMechanicPort).toHaveBeenLastCalledWith(null);
    expect(turretLofSpy).toHaveBeenCalledWith(null);
    expect(teslaLosSpy).toHaveBeenCalledWith(null);
  });
});

describe('TurretSystem readiness and projectile pose', () => {
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

  it('carries the runtime angle through limited aiming, world execution and projectile spawn', () => {
    const placement = createPlacement({ getAllPlayers: () => [] } as unknown as PlayerManager);
    const definition = COOP_DEFENSE_CONSTRUCTIONS.rocket_turret;
    const placed = placement.materializePersistentPlaceable(definition, 10, 10, -Math.PI / 2, 'builder', 1)!;
    const metrics = resolveActiveArenaWorldMetrics();
    const x = metrics.offsetX + placed.gridX * CELL_SIZE + CELL_SIZE / 2;
    const y = metrics.offsetY + placed.gridY * CELL_SIZE + CELL_SIZE / 2;
    const fixture = createFixture({ placementSystem: placement, players: [],
      enemies: [{ id: 'enemy', x: x + 100, y, active: true }] });
    const system = fixture.binding.systems!.turret;
    expect(system.getTurrets()[0]).toMatchObject({ angle: placed.angle,
      rotationSpeedDegPerSec: definition.rotationSpeedDegPerSec, aimToleranceDeg: definition.aimToleranceDeg });
    system.hostUpdate(0, UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig, WEAPON_CONFIGS.SPORES, 0);
    expect(fixture.projectileSpawn.spawnProjectile).not.toHaveBeenCalled();
    const residualDegrees = definition.aimToleranceDeg / 2;
    const delta = (90 - residualDegrees) / definition.rotationSpeedDegPerSec * 1000;
    system.hostUpdate(delta, UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig, WEAPON_CONFIGS.SPORES, delta);
    expect(fixture.projectileSpawn.spawnProjectile).toHaveBeenCalledOnce();
    const request = fixture.projectileSpawn.spawnProjectile.mock.calls[0][0];
    const angle = placement.getRuntimeRock(placed.id)!.angle;
    expect(angle).toBeCloseTo(-residualDegrees * Math.PI / 180);
    expect(request.origin.angle).toBeCloseTo(angle);
    expect(request.origin.x).toBeCloseTo(x + Math.cos(angle) * definition.muzzleOffset);
    expect(request.origin.y).toBeCloseTo(y + Math.sin(angle) * definition.muzzleOffset);
    fixture.binding.destroy();
  });
});

describe('grenade contact classification', () => {
  it('excludes own/allied/dead characters and terrain and admits hostile bases and constructions', () => {
    const rocks = new Map([
      [1, { hp: 100, kind: 'rock', ownerId: '__world__' }],
      [2, { hp: 100, kind: 'turret', constructionId: 'rocket_turret', ownerId: 'p1' }],
      [3, { hp: 100, kind: 'turret', constructionId: 'rocket_turret', ownerId: COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID }],
      [4, { hp: 100, kind: 'turret', constructionId: 'rocket_turret', ownerId: COOP_DEFENSE_BASE_TURRET_OWNER_ID }],
    ]);
    const fixture = createFixture({ players: [{ id: 'p1', x: 0, y: 0, active: true }], enemies: [],
      placementSystem: methodBag({ getRuntimeRock: (id: number) => rocks.get(id), getAllRuntimeRocks: () => [] }) as never,
      baseManager: methodBag({ getBases: () => [], getBasesByFaction: () => [], getGeometryRevision: () => 1,
        getBase: (id: string) => ({ faction: id === 'hostile' ? 'hostile' : 'friendly', isInert: () => false, getHp: () => 100 }),
      }) as never,
    });
    vi.mocked(fixture.combatSystem.isAlive).mockImplementation(id => id !== 'dead');
    vi.mocked(fixture.combatSystem.canProjectileDamageTarget).mockImplementation((_p, id) => id !== 'ally');
    const classify = vi.mocked(fixture.projectileInteraction.setProjectileTargetabilityPort).mock.calls.at(-1)![0]!.getGrenadeContactRole!;
    const source = { gameplaySourceId: 'p1', attributionId: 'p1', allegiance: { ownerId: 'p1' } };
    for (const id of ['p1', 'ally', 'dead']) expect(classify(source, { kind: 'player', id })).toBeNull();
    expect(classify(source, { kind: 'enemy', id: 'enemy' })).toBe('character');
    expect(classify(source, { kind: 'decoy', id: 7 })).toBeNull();
    expect(classify(source, { kind: 'base', id: 'hostile' })).toBe('structure');
    expect(classify(source, { kind: 'base', id: 'friendly' })).toBeNull();
    for (const id of [1, 2, 4]) expect(classify(source, { kind: 'rock', id })).toBeNull();
    expect(classify(source, { kind: 'rock', id: 3 })).toBe('structure');
    fixture.binding.destroy();
  });
});
