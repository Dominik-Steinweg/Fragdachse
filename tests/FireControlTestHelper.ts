import { vi } from 'vitest';

// Same headless boundary as FireControlProjectileRoute / TurretBaseWeaponMatrix.
// Production geometry is retained so M2 can test real blocked flight segments.
vi.mock('phaser', async () => {
  const phaser = (await import('./fakeArenaRenderScene')).createFakePhaserModule() as unknown as typeof import('phaser');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const root = require.resolve('phaser/package.json').replace(/package\.json$/, '');
  return { ...phaser, Utils: { Array: { Shuffle: <T>(items: T[]) => items } }, Math: { ...phaser.Math, Distance: { ...phaser.Math.Distance, Squared: (a: number, b: number, c: number, d: number) => (a-c)**2 + (b-d)**2 } }, Geom: { ...phaser.Geom,
    Line: require(root + 'src/geom/line/Line.js'),
    Rectangle: require(root + 'src/geom/rectangle/Rectangle.js'),
    Intersects: require(root + 'src/geom/intersects/index.js'),
  } };
});

import { TurretSystem, toLocalTurretFireSource, type AutomatedTurret, type TurretFireSource } from '../src/systems/TurretSystem';
import { fireControlCopySourceId } from '../src/systems/fireControl/FireControlSnapshot';
import { UTILITY_CONFIGS, WEAPON_CONFIGS, type UtilityConfig } from '../src/loadout/LoadoutConfig';
import { WorldProjectileRuntime } from '../src/projectile/WorldProjectileRuntime';
import { ProjectileIdentityScope } from '../src/projectile/ProjectileIdentityScope';
import type { ProjectileSpawnRequest } from '../src/projectile/ProjectileSpawnRequest';
import { AutomatedWeaponExecutionAdapter } from '../src/world/AutomatedWeaponExecutionAdapter';
import { WorldWeaponExecutionRuntime } from '../src/world/WorldWeaponExecutionRuntime';
import { PlayerUtilityActionRuntime } from '../src/world/PlayerUtilityActionRuntime';
import { HostHeldActionSystem } from '../src/systems/HostHeldActionSystem';
import { createPresentation, createTechnicalPhysicsBinding } from './ProjectileRuntimeTestHelper';
import { WorldCombatGameplayBinding, type WorldCombatGameplayBindingOptions } from '../src/world/WorldCombatGameplayBinding';
import { WorldCombatCore } from '../src/combat/WorldCombatCore';
import { PlacementSystem } from '../src/systems/PlacementSystem';
import { RockGridIndex } from '../src/arena/RockGridIndex';
import { COOP_DEFENSE_CONSTRUCTIONS } from '../src/config/coopDefenseConstructions';
import { resolveActiveArenaWorldMetrics } from '../src/world/WorldMetrics';
import { CELL_SIZE } from '../src/config';
import { fakeEntity } from './fakeEntity';
import { healthBarTestScene } from './healthBarTestScene';
import { EnemyManager } from '../src/entities/EnemyManager';
import { COOP_DEFENSE_ENEMY_KINDS, resolveCoopDefenseEnemyConfigs } from '../src/config/coopDefenseEnemies';
import { EnergyInjectorSystem } from '../src/systems/EnergyInjectorSystem';
import { CoopDefenseItemRuntimeSystem } from '../src/systems/CoopDefenseItemRuntimeSystem';

/** Real placement, deployment, weapon execution, damage receipts and MG owner; renderer ports are inert. */
export function createFireControlWorldFixture(overrides: Partial<Extract<UtilityConfig, { type: 'fire_control_relay' }>> = {},
  portalOverrides: Partial<Extract<UtilityConfig, { type: 'fire_control_portal' }>> = {}) {
  const base = UTILITY_CONFIGS.FIRE_CONTROL_RELAY;
  if (base.type !== 'fire_control_relay') throw Error('Expected relay config');
  const config = { ...base, ...overrides };
  const utility = createFireControlUtilityFixture(config, portalOverrides);
  let now = 1000, manned: number | null = null, pilot = 'ally', fresh = false, free = true, combatAllowed = true, remoteBonus = 0;
  const bag = (values: Record<string, unknown> = {}): any => new Proxy(values, {
    get(target, key) { if (!(key in target)) target[key as string] = vi.fn(); return target[key as string]; },
  });
  const player = fakeEntity({ id: 'inspector', x: 0, y: 0, color: 0xffffff });
  const players = bag({ getAllPlayers: () => [player], getPlayer: () => player });
  const combat = new WorldCombatCore(players, { isHost: () => true, getPlayerProfile: () => player,
    areTeammates: () => false, getLocalPlayerId: () => player.id, isEnemyPair: () => true,
    broadcastEffect: vi.fn(), broadcastAudioFeedback: vi.fn() } as never);
  combat.bindPlayerVitalsScope({ worldRevision: 7300, runtimeGeneration: 1 });
  combat.bindHostExecutionSources({ nowMs: () => now, random: () => .5 }); combat.initPlayer(player.id);
  const enemyConfigs = resolveCoopDefenseEnemyConfigs(1), kind = COOP_DEFENSE_ENEMY_KINDS[0];
  enemyConfigs[kind] = { ...enemyConfigs[kind], glow: undefined, deathSpawns: [], imageKey: 'test-enemy' };
  const enemies = new EnemyManager(healthBarTestScene().scene, enemyConfigs);
  combat.setEnemyManager(enemies);
  const metrics = resolveActiveArenaWorldMetrics();
  const layout = { seed: 1, rocks: [], trees: [], tracks: [], dirt: [], powerUpPedestals: [] };
  const placement = new PlacementSystem(layout, new RockGridIndex(layout.rocks, { cols: metrics.gridCols, rows: metrics.gridRows }), players, metrics);
  const injector = new EnergyInjectorSystem();
  const item = new CoopDefenseItemRuntimeSystem({ getAffixValue: (_id, affix) => affix === 'remote_control' ? remoteBonus : 0,
    getPlayerHp: () => ({ hp: 100, maxHp: 100 }), getPlayerPosition: () => player });
  const stats = new Map<string, number>([['construction.machine_gun_turret.perHitPercent', 3]]);
  const playerCombat = {
    resource: bag(), movement: bag(), state: bag(), utility: utility.action, item,
    modifier: bag({ getNumericStat: (_id: string, key: string) => stats.get(key) ?? 0, getPercentageStat: () => 0,
      getResolvedStat: (_id: string, _key: string, value: number) => value,
      resolveOutgoingDamage: (_id: string, _target: string, amount: number) => ({ amount, isCritical: false }) }),
    loadout: bag({ getDamageMultiplier: () => 1 }), sustainedWeapon: bag(), ak47: null, slimeTrail: null, fireChunks: null,
    reactions: bag({ handlePlayerDamageTaken: () => ({ adrenalineGain: 0, reflectedDamage: 0 }),
      handleDirectPrimaryHit: () => ({ slowFraction: 0, slowDurationMs: 0, shouldCull: false }) }),
  };
  const homing = bag();
  const binding = new WorldCombatGameplayBinding(bag({ playerManager: players, combatSystem: combat, placementSystem: placement, worldMetrics: metrics,
    baseManager: null, hostPhysics: bag(), decoySystem: bag(), fireSystem: bag(), gameAudioSystem: bag(),
    projectileSpawn: { spawnProjectile: utility.projectile.spawn }, projectileEvents: utility.projectile.projectiles,
    projectileUtility: { focusProjectilesInCircle: () => 0,
      destroyProjectile: (id: number) => utility.projectile.projectiles.destroyProjectile(id) },
    projectileTimeField: bag(), projectileHoming: homing, projectileWorldImpact: bag(), projectileSwarm: bag(), projectileInteraction: bag(),
    isCoopMission: () => false, isCoopDefense: () => true, isActivityActive: () => true,
    getSpawnContext: () => undefined, getWorldParticipation: () => 'interactive', getPlayerCapabilities: () => ({ canUseCombat: combatAllowed }),
    getEnemyManager: () => enemies, getPlayerCombatIntegration: () => playerCombat,
    automatedWeaponExecution: utility.projectile.weapons, getPowerUpSystem: () => null, getTargetStatusSystem: () => null,
    getEnergyInjectorSystem: () => injector, getWorldGeometryBinding: () => ({ getQueries: () => ({
      resolveSafeGroundPoint: (x: number, y: number) => ({ x: free ? x : x + 1, y }),
    }) }), getPersistentBaseId: () => undefined, getConstructionMuzzleOffset: () => 0,
    getTargetFootprint: () => null, resolveObstacleDamage: () => 0, getWorldMutation: () => null,
    updateTurretAngle: vi.fn(), getManualTurretControl: (id: number) => id === manned
      ? { playerId: pilot, revision: 1, fresh, fireHeld: fresh, targetX: -200, targetY: 0 } : null,
    readConstructionSlotOrder: () => ['rocket_turret', 'machine_gun_turret'],
    getMissionBarrierObstacles: () => null, getRockTargets: () => [], getWorldTrain: () => null,
    getTimebombSystem: () => null, getNecromancySystem: () => null, hostUpdate: bag(), createEnergyShieldSystem: () => bag(),
    network: { authority: { isHost: () => true, isEnemyPair: () => false, getPlayerProfile: () => player, getConnectedPlayers: () => [player] },
      round: bag({ canPlayerReceiveRoundRewards: () => true }), stats: bag(), effects: bag() },
  }) as unknown as WorldCombatGameplayBindingOptions);
  const add = (id: keyof typeof COOP_DEFENSE_CONSTRUCTIONS = 'machine_gun_turret', owner = 'inspector', gridX = 5, gridY = 5) => {
    const rock = placement.materializePersistentPlaceable(COOP_DEFENSE_CONSTRUCTIONS[id], gridX, gridY, 0, owner, 0xffffff)!;
    if (!rock) throw Error('Fixture construction did not fit');
    // Identity/lifecycle tests isolate timing from authored rotation tuning.
    placement.getRuntimeRock(rock.id)!.rotationSpeedDegPerSec = 10000;
    return rock;
  };
  const spawnEnemy = (x = 180, y = 50) => { const enemy = enemies.hostSpawnAtWorld(x, y, kind);
    enemy.setHp(100000, 100000, true); return enemy; };
  let hitId = 0;
  const setPoint = (x: number, y: number) => { player.x = x; player.y = y; };
  return { ...utility, config, binding, placement, combat, enemies, homing, injector, item, player, stats, add, spawnEnemy, setPoint,
    isFree: () => free,
    point: (rock: { gridX: number; gridY: number }) => ({ x: metrics.offsetX + rock.gridX * CELL_SIZE + CELL_SIZE / 2,
      y: metrics.offsetY + rock.gridY * CELL_SIZE + CELL_SIZE / 2 }),
    setManned: (id: number | null, playerId = 'ally', inputFresh = false) => { manned = id; pilot = playerId; fresh = inputFresh; }, setFree: (value: boolean) => { free = value; },
    setCombatAllowed: (value: boolean) => { combatAllowed = value; }, setRemoteBonus: (value: number) => { remoteBonus = value; },
    tick(time: number, fire = true) {
      now = time; utility.action.update(now); binding.advanceMgTurrets(now); binding.advanceFireControl(now);
      if (fire) binding.systems!.turret.hostUpdate(now, UTILITY_CONFIGS.SPORE_TURRET as never, WEAPON_CONFIGS.SPORES, 1000);
    },
    hit(enemy: ReturnType<typeof spawnEnemy>, request: ProjectileSpawnRequest, damage = 1) {
      return combat.resolveDirectImpact({ projectileId: ++hitId, target: { kind: 'enemy', id: enemy.id },
        impact: { x: enemy.sprite.x, y: enemy.sprite.y }, velocity: { x: 1, y: 0 },
        provenance: request.provenance, directHit: { damage }, augments: [] });
    },
    destroy() { binding.destroy(); utility.destroy(); enemies.destroy(); },
  };
}

/** Synthetic geometry/readiness, deliberately independent of authored balance values. */
export function fireControlConstruction(overrides: Partial<AutomatedTurret> = {}): AutomatedTurret {
  return { id: 7, ownerId: 'inspector', ownerColor: 0xffffff, x: 0, y: 0, angle: 0,
    weaponId: 'TURRET_MG', targetRange: 500, cooldownMs: 1000, muzzleOffset: 0, ...overrides };
}

/** Provider input only: this does not simulate activation or a deployment owner. */
export function fireControlCopy(original: AutomatedTurret, parallel = false): TurretFireSource {
  const id = fireControlCopySourceId(1, 0);
  return { ...original, id, x: 300, identityId: original.id, visualId: id, fireState: 'active',
    sequenceKey: parallel ? id : original.id, ...(parallel ? { sequenceSeedKey: original.id } : {}) };
}

export function createFireControlSourceFixture() {
  let constructions: readonly AutomatedTurret[] = [];
  let sources: readonly TurretFireSource[] = [];
  let enemies = [{ id: 'enemy', x: 150, y: 100 }];
  const system = new TurretSystem({ getAllPlayers: () => [] } as never,
    { isAlive: () => true, isBurrowed: () => false, canDamageTarget: () => true } as never);
  const fire = vi.fn(), angles = vi.fn();
  system.setTurretProvider(() => constructions, angles);
  system.setFireSourceProvider(() => sources);
  system.setEnemyTargetProvider(() => enemies);
  system.setFireHandler(fire);
  return { system, fire, angles,
    set(constructionList: readonly AutomatedTurret[], fireSources = constructionList.map(toLocalTurretFireSource)) {
      constructions = constructionList; sources = fireSources;
    },
    setEnemies(next: typeof enemies) { enemies = next; },
    tick(now: number, deltaMs = 16) {
      const config = UTILITY_CONFIGS.SPORE_TURRET;
      if (config.type !== 'placeable_turret') throw new Error('Expected turret fixture config');
      system.hostUpdate(now, config, WEAPON_CONFIGS.SPORES, deltaMs);
    },
    destroy() { system.setFireSourceProvider(null); system.setTurretProvider(null, null);
      system.setEnemyTargetProvider(null); system.setFireHandler(null); },
  };
}

/** Real automatic weapon -> spawn -> projectile lifetime, with observable technical physics. */
export function createFireControlProjectileFixture() {
  let now = 1000;
  const physics = createTechnicalPhysicsBinding();
  const presentation = createPresentation();
  const projectiles = new WorldProjectileRuntime({ physicsBinding: physics.binding, presentation,
    identityScope: new ProjectileIdentityScope(1), hostNowMs: () => now });
  const spawn = vi.fn((request: ProjectileSpawnRequest) => projectiles.spawnProjectile(request));
  const projectileSpawn = { spawnProjectile: spawn };
  const execution = new WorldWeaponExecutionRuntime({ projectileSpawn, combatSystem: {
    resolveSafeHitscanStart() { throw new Error('Fire-control fixture supports projectile/flamethrower only'); },
    resolveImmediateAttack() { throw new Error('Unexpected immediate weapon'); },
  } });
  const weapons = new AutomatedWeaponExecutionAdapter(execution, projectileSpawn);
  return { physics, presentation, projectiles, spawn, weapons,
    get now() { return now; },
    advance(deltaMs: number) {
      now += deltaMs;
      for (const [id, handle] of physics.handles) {
        if (!handle.sprite.active || !handle.body.enable) continue;
        const { x: vx, y: vy } = handle.body.velocity;
        const x = handle.sprite.x + vx * deltaMs / 1000, y = handle.sprite.y + vy * deltaMs / 1000;
        handle.body.reset(x, y); physics.observe(id, x, y, vx, vy);
      }
      return projectiles.runHostProjectileStage(deltaMs, now);
    },
    destroy() { projectiles.destroy(); execution.destroy(); },
  };
}

/** Existing action/resource harness; M1 supplies the authored config and connects the utility port. */
export function createFireControlUtilityFixture(config: UtilityConfig,
  portalOverrides: Partial<Extract<UtilityConfig, { type: 'fire_control_portal' }>> = {}) {
  const portalBase = UTILITY_CONFIGS.FIRE_CONTROL_PORTAL;
  if (portalBase.type !== 'fire_control_portal') throw Error('Expected portal config');
  const portalConfig = { ...portalBase, ...portalOverrides };
  let alive = true, attempt = 0;
  let actorPosition = { x: 0, y: 0 };
  let equipped = config;
  const projectile = createFireControlProjectileFixture();
  const cooldown = vi.fn(), inventory = vi.fn(), used = vi.fn(), noteUsed = vi.fn();
  const action = new PlayerUtilityActionRuntime({
    captureSmokeDamage: () => ({ sourceDamageMultiplier: 1 }), projectileSpawn: { spawnProjectile: projectile.spawn },
    combatSystem: {} as never,
    actor: { getPlayer: () => ({ ...actorPosition, color: 0xffffff }), canInteract: () => true,
      isAlive: () => alive, isUtilityBlocked: () => false },
    loadout: { getEquippedUtilityConfig: () => equipped, resolveUtilityConfig: (_p, c) => c, noteUtilityUsed: noteUsed },
    heldAction: new HostHeldActionSystem(), translocator: null, decoy: null, stinkCloud: null,
    gameAudioSystem: {} as never, dropBeer() {}, nukeStrike: () => false, placeable: null,
    network: { loadout: { publishUtilityCooldownUntil: cooldown, publishTemporaryUtilityInstances: inventory,
      publishHeldUtilityId() {} }, roundStats: { recordUtilityUsed: used, recordConstructionBuilt() {} } },
    isToolAuthorized: () => true, resolveToolUtilityConfig: ref => ref.id === portalConfig.id ? portalConfig : config,
  });
  const portalTool = { kind: 'utility', id: portalConfig.id } as const;
  return { action, projectile, cooldown, inventory, used, noteUsed, portalConfig,
    setActorPosition(x: number, y: number) { actorPosition = { x, y }; },
    /** Real held throw through the tool path: charge in ms of holding, released at `now`. */
    throwPortal(now: number, angle = 0, chargeMs = portalConfig.activation.type === 'charged_throw' ? portalConfig.activation.fullChargeDuration : 0) {
      const heldActionId = `portal-${++attempt}`;
      action.startHeldAction('inspector', heldActionId, 'charged_throw', now - chargeMs, portalTool);
      return action.execute({ category: 'utility', playerId: 'inspector', angle, targetX: Math.cos(angle) * 300,
        targetY: Math.sin(angle) * 300, hostNowMs: now, attemptId: heldActionId,
        source: { kind: 'tool', toolRef: portalTool, config: portalConfig }, params: { heldActionId, toolRef: portalTool } });
    },
    equip(value: UtilityConfig) { equipped = value; action.syncEquippedUtility('inspector'); },
    setAlive(value: boolean) { alive = value; },
    place(now: number, x = 300, y = 0) {
      return action.execute({ category: 'utility', playerId: 'inspector', angle: 0, targetX: x, targetY: y,
        hostNowMs: now, attemptId: `placement-${++attempt}`, params: {} });
    },
    cast(now: number) {
      const heldActionId = `throw-${++attempt}`;
      action.startHeldAction('inspector', heldActionId, 'charged_throw', now);
      return action.execute({ category: 'utility', playerId: 'inspector', angle: 0, targetX: 300, targetY: 0,
        hostNowMs: now, attemptId: heldActionId, params: { heldActionId } });
    },
    destroy() { action.destroy(); projectile.destroy(); },
  };
}
