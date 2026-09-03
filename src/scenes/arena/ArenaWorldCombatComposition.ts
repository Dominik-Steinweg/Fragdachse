import { bridge } from '../../network/bridge';
import { EnergyShieldSystem } from '../../systems/EnergyShieldSystem';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE } from '../../config';
import { COOP_DEFENSE_AFFIX_RULES } from '../../config/coopDefenseItems';
import { getCoopDefenseMapConfig, resolveCoopDefenseMapMissionProgress } from '../../config/coopDefenseMaps';
import {
  WorldCombatGameplayBinding,
} from '../../world/WorldCombatGameplayBinding';
import type { WorldPlayerGameplayRuntime } from '../../world/WorldPlayerGameplayRuntime';
import { resolveObstacleDamage, resolveTargetFootprint } from './arenaWorldQueries';
import type { ArenaContext } from './ArenaContext';
import type { SyncedProjectile, TrackedProjectile } from '../../types';
import { UTILITY_CONFIGS, type PlaceableTurretUtilityConfig } from '../../loadout/LoadoutConfig';
import { toMapId } from '../../world/arenaDescriptorAdapter';
import type {
  ArenaWorldGameplay,
  ArenaWorldGameplayCompositionInput,
} from './ArenaWorldGameplayComposition';

/**
 * Die World-Projektion der scene-langlebigen Kampf-, Physik- und Projektilsysteme.
 *
 * Das Binding erzeugt die world-lokalen Kampf-Runtimes, installiert seine Resolver und loest sie
 * beim World-Teardown selbst wieder. Die laufende Activity liefert nur Reads nach; welche
 * Missionssysteme dahinter stehen, weiss diese Grenze nicht.
 */
export function composeWorldCombatGameplay(
  input: ArenaWorldGameplayCompositionInput,
  gameplay: ArenaWorldGameplay,
): void {
  const {
    ctx, rockVisualHelper, hostUpdate, flow, worldRuntime, world,
    arenaResult, placementSystem, baseManager,
  } = input;
  // Eine Basisaenderung trifft alle Felder gemeinsam: Der Coordinator verschickt den Patch
  // prioritaer und sperrt die entfallenen Zielzellen sofort, bis das neue Feld aktiv ist.
  const syncActiveBaseIds = (): void => {
    flow.getCoopMissionRuntime()?.flowFieldCoordinator?.setActiveBaseIds(
      baseManager?.getActiveBaseIds() ?? new Set<string>(),
    );
  };
  const combatGameplayBinding = new WorldCombatGameplayBinding({
    playerManager: ctx.playerManager,
    projectileManager: ctx.projectileManager,
    combatSystem: ctx.combatSystem,
    hostPhysics: ctx.hostPhysics,
    decoySystem: ctx.decoySystem,
    fireSystem: ctx.fireSystem,
    gameAudioSystem: ctx.gameAudioSystem,
    placementSystem,
    baseManager,
    worldMetrics: world.metrics,
    isCoopMission: () => flow.isCoopMissionActivity(),
    isActivityActive: () => flow.isActivityActive(),
    getSpawnContext: (playerId) => {
      const latestState = bridge.getLatestGameState();
      const missionState = bridge.getCoopDefenseMissionProgressPresentationState();
      const worldContext = worldRuntime.context;
      const worldMapId = toMapId(worldContext.descriptor.definitionId);
      const missionConfig = worldMapId === null
        ? null
        : resolveCoopDefenseMapMissionProgress(getCoopDefenseMapConfig(worldMapId));
      const respawnCheckpoint = missionConfig?.checkpoints.find(
        ({ id }) => id === missionState?.respawnCheckpointId,
      );
      const spawnFocusCell = respawnCheckpoint ?? missionConfig?.startArea;
      const runtimePlaceables = placementSystem.getAllRuntimeRocks();
      const turretRange = (UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig).placeable.targetRange;

      return {
        fires: latestState?.fires ?? [],
        stinkClouds: latestState?.stinkClouds ?? [],
        teslaDomes: latestState?.teslaDomes ?? [],
        nukes: latestState?.nukes ?? [],
        meteors: latestState?.meteors ?? [],
        turrets: runtimePlaceables
          .filter((placeable) => (
            placeable.kind === 'turret'
            && playerId !== null
            && ctx.combatSystem.canDamageTarget(placeable.ownerId, playerId)
          ))
          .map((placeable) => ({
            x: ARENA_OFFSET_X + placeable.gridX * CELL_SIZE + CELL_SIZE * 0.5,
            y: ARENA_OFFSET_Y + placeable.gridY * CELL_SIZE + CELL_SIZE * 0.5,
            ownerId: placeable.ownerId,
            range: placeable.targetRange ?? turretRange,
          })),
        projectiles: (latestState?.projectiles ?? [])
          .filter((projectile) => playerId !== null && ctx.combatSystem.canDamageTarget(projectile.ownerId, playerId, projectile.allowTeamDamage))
          .map((projectile) => ({
            x: projectile.x,
            y: projectile.y,
            ownerId: projectile.ownerId,
            radius: resolveSpawnProjectileDangerRadius(projectile),
          })),
        enemyThreats: (() => {
          const livingBases = baseManager?.getBasesByFaction('friendly')
            ?.filter((base) => !(base.isInert?.() ?? false) && base.getHp() > 0) ?? [];
          return (flow.getCoopMissionRuntime()?.enemyManager?.getAllEnemies() ?? [])
            .filter((enemy) => enemy.faction === 'hostile' && enemy.sprite.active && ctx.combatSystem.isAlive(enemy.id))
            .map((enemy) => {
              let targetBaseId: string | undefined;
              let targetBaseDistance = Number.POSITIVE_INFINITY;
              for (const base of livingBases) {
                const surface = base.getNearestSurfacePoint(enemy.sprite.x, enemy.sprite.y);
                if (surface && surface.distance < targetBaseDistance) {
                  targetBaseId = base.id;
                  targetBaseDistance = surface.distance;
                }
              }
              return {
                x: enemy.sprite.x,
                y: enemy.sprite.y,
                attackRange: Math.max(
                  0,
                  ...enemy.getAttackWeapons().map((attackWeapon) => (
                    attackWeapon.weapon.config.fire.type === 'tesla_dome'
                      ? attackWeapon.weapon.config.fire.radius
                      : attackWeapon.weapon.config.range
                  )),
                ),
                targetBaseId,
                targetBaseDistance,
              };
            });
        })(),
        livingCoopBaseIds: baseManager?.getActiveMainBaseIds('friendly'),
        preferredSpawnFocus: spawnFocusCell
          ? {
            x: ARENA_OFFSET_X + (spawnFocusCell.gridX + 0.5) * CELL_SIZE,
            y: ARENA_OFFSET_Y + (spawnFocusCell.gridY + 0.5) * CELL_SIZE,
          }
          : undefined,
        isRelevantOpponent: (otherPlayerId) => playerId === null
          ? ctx.combatSystem.isAlive(otherPlayerId)
          : ctx.combatSystem.isAlive(otherPlayerId) && bridge.isEnemyPair(playerId, otherPlayerId),
        hasLineOfSight: (sx, sy, ex, ey) => ctx.combatSystem.hasLineOfSight(sx, sy, ex, ey),
      };
    },
    getWorldParticipation: (playerId) => flow.getWorldParticipation(playerId),
    getPlayerCapabilities: (playerId) => flow.getPlayerCapabilities(playerId),
    getEnemyManager: () => flow.getCoopMissionRuntime()?.enemyManager ?? null,
    getPlayerSystems: () => gameplay.player?.systems ?? null,
    automatedWeaponExecution: gameplay.automatedWeaponExecution,
    getPowerUpSystem: () => gameplay.powerUp?.system ?? null,
    getTargetStatusSystem: () => gameplay.targeting?.systems.targetStatus ?? null,
    getEnergyInjectorSystem: () => gameplay.targeting?.systems.energyInjector ?? null,
    getWorldGeometryBinding: () => gameplay.geometry,
    getPersistentBaseId: () => world.persistentBaseSite?.baseId,
    getConstructionMuzzleOffset: (constructionId) => gameplay.construction?.getMuzzleOffset(constructionId),
    getTargetFootprint: (target) => resolveTargetFootprint(
      ctx.playerManager,
      flow.getCoopMissionRuntime(),
      input.worldRuntime,
      rockVisualHelper,
      target,
    ),
    resolveObstacleDamage: (rockId, damage, attackerId) => resolveObstacleDamage(
      ctx.combatSystem,
      placementSystem,
      rockId,
      damage,
      attackerId,
    ),
    applyObstacleDamageById: (rockId, damage, attackerId) => rockVisualHelper.applyObstacleDamageById(rockId, damage, attackerId),
    handleDestroyedRock: (rockId, reason, attackerId) => rockVisualHelper.handleDestroyedRock(rockId, reason, attackerId),
    updateTurretAngle: (rockId, angle) => rockVisualHelper.updateTurretAngle(rockId, angle),
    spawnImpactCloud: (projectile, x, y) => spawnImpactCloudFromProjectile(ctx, projectile, x, y),
    resetPlayerPosition: (playerId, x, y) => flow.getCoopMissionRuntime()?.coopDefenseMissionProgressSystem?.resetPlayerPosition(playerId, x, y),
    dropBeer: (playerId, x, y) => flow.getCaptureTheBeerSystem()?.dropBeerForPlayer(playerId, x, y),
    dropCarryForPlayer: (playerId, x, y) => flow.getCoopMissionRuntime()?.coopDefenseCarrySystem?.dropForPlayer(playerId, x, y),
    handlePlayerUnavailable: (playerId) => flow.getCoopMissionRuntime()?.coopDefenseObjectivePlacementRewardSystem?.handlePlayerUnavailable(playerId),
    handlePlayerDeath: (playerId) => flow.getPlayerActivityRuntime()?.handlePlayerDeath(playerId),
    handleCoopItemKill: (killerId, victimId, x, y) => hostHandleCoopDefenseItemKill(
      ctx,
      gameplay.player,
      killerId,
      victimId,
      x,
      y,
    ),
    getSecondaryObjectiveState: (objectiveId) => {
      const state = bridge.getCoopDefenseSecondaryObjectivePresentationState();
      return state?.find(entry => entry.objectiveId === objectiveId)?.state ?? null;
    },
    reportTargetContribution: (objectiveId, baseId) => flow.getCoopMissionRuntime()?.coopDefenseSecondaryObjectiveSystem?.reportTargetContribution(objectiveId, baseId),
    reportTargetDestroyed: (objectiveId, baseId) => flow.getCoopMissionRuntime()?.coopDefenseSecondaryObjectiveSystem?.reportTargetDestroyed(objectiveId, baseId) ?? 0,
    reconcilePersistentBaseWorld: () => flow.reconcilePersistentBaseWorld(),
    syncActiveBaseIds,
    getMissionBarrierObstacles: () => flow.getCoopMissionRuntime()?.coopDefenseMissionBarrierManager?.getObstacleRectangles() ?? null,
    getRockTargets: () => arenaResult.rockPhysicsProxies.flatMap((rock, index) => (
      rock && rock.active ? [{ id: index, index, active: true, x: rock.x, y: rock.y }] : []
    )),
    getWorldTrain: () => gameplay.train,
    getTimebombSystem: () => flow.getCoopMissionRuntime()?.coopDefenseTimebombSystem ?? null,
    getNecromancySystem: () => flow.getCoopMissionRuntime()?.necromancySystem ?? null,
    hostUpdate: hostUpdate,
    createEnergyShieldSystem: (resource, shield) => new EnergyShieldSystem(ctx.playerManager, resource, bridge, shield),
    network: {
      authority: {
        isHost: () => bridge.isHost(),
        isEnemyPair: (first, second) => bridge.isEnemyPair(first, second),
        getPlayerProfile: (playerId) => bridge.getPlayerProfile(playerId),
        getConnectedPlayers: () => bridge.getConnectedPlayers(),
      },
      round: {
        canPlayerInitialSpawn: (playerId) => bridge.canPlayerInitialSpawn(playerId),
        canPlayerRespawn: (playerId) => bridge.canPlayerRespawn(playerId),
        canPlayerReceiveRoundRewards: (playerId) => bridge.canPlayerReceiveRoundRewards(playerId),
        addCoopDefenseRoundXp: (amount) => { bridge.addCoopDefenseRoundXp(amount); },
      },
      stats: {
        recordPlayerDamageTaken: (playerId, hpLost, armorLost) => bridge.recordPlayerDamageTaken(playerId, hpLost, armorLost),
        addPlayerRoomDamage: (playerId, amount) => bridge.addPlayerRoomDamage(playerId, amount),
        recordHealingReceived: (playerId, amount) => bridge.recordHealingReceived(playerId, amount),
        recordArmorReceived: (playerId, amount) => bridge.recordArmorReceived(playerId, amount),
        recordPlayerDeath: (playerId) => bridge.recordPlayerDeath(playerId),
        recordPlayerKill: (playerId, kind) => bridge.recordPlayerKill(playerId, kind),
        incrementPlayerFrags: (playerId) => bridge.incrementPlayerFrags(playerId),
      },
      effects: {
        broadcastSlimeBloomEffect: (x, y, targets) => bridge.broadcastSlimeBloomEffect(x, y, targets),
        broadcastExplosionEffect: (x, y, radius, color, style) => bridge.broadcastExplosionEffect(x, y, radius, color, style),
        broadcastBfgLaserBatch: (lines, color, preset, projectileId) => bridge.broadcastBfgLaserBatch([...lines], color, preset, projectileId),
        broadcastMiniRocketCollectionEffect: (x, y, color) => bridge.broadcastMiniRocketCollectionEffect(x, y, color),
        broadcastMiniRocketDestructionEffect: (x, y, color) => bridge.broadcastMiniRocketDestructionEffect(x, y, color),
        broadcastKillEvent: (event) => bridge.broadcastKillEvent(event),
      },
    },
    respawnPlayer: (playerId) => flow.getPlayerActivityRuntime()?.consumeRespawn(playerId) ?? true,
    getTeamHpRegenBonus: (playerId) => flow.getCoopMissionRuntime()?.coopDefenseTeamBuffSystem?.getHpRegenBonus(Date.now(), bridge.canPlayerReceiveRoundRewards(playerId), ctx.combatSystem.isAlive(playerId)) ?? 0,
    getMatrixDamageReduction: (footprint, applies) => gameplay.targeting?.systems.reinforcementMatrix.getDamageReductionForFootprint(footprint, Date.now(), applies) ?? 0,
    getMatrixDamageMultiplier: (footprint, applies) => gameplay.targeting?.systems.reinforcementMatrix.getDamageMultiplierForFootprint(footprint, Date.now(), applies) ?? 1,
    isHomingTargetValid: (id, type, ownerId) => {
      void ownerId;
      if (type !== 'players' && type !== 'decoys') return true;
      const catalog = flow.getCoopMissionRuntime()?.enemyAiTargetCatalog;
      if (!catalog) return true;
      return catalog.isTargetValid({ kind: type === 'players' ? 'player' : 'decoy', id });
    },
  });
  gameplay.combat = combatGameplayBinding;
  worldRuntime.bind(combatGameplayBinding);
}

function resolveSpawnProjectileDangerRadius(projectile: SyncedProjectile): number {
  const baseRadius = Math.max(CELL_SIZE * 2, projectile.size * 4);

  switch (projectile.style) {
    case 'rocket':
    case 'bfg':
      return Math.max(baseRadius, CELL_SIZE * 4);
    case 'grenade':
    case 'holy_grenade':
      return Math.max(baseRadius, CELL_SIZE * 3.5);
    case 'energy_ball':
    case 'hydra':
    case 'spore':
      return Math.max(baseRadius, CELL_SIZE * 3);
    case 'flame':
      return Math.max(baseRadius, CELL_SIZE * 1.5);
    default:
      return baseRadius;
  }
}

/** Item-Affix-Wolke eines eingeschlagenen Projektils; reine Host-Folge des Treffers. */
function spawnImpactCloudFromProjectile(
  ctx: ArenaContext,
  proj: TrackedProjectile,
  x: number,
  y: number,
): void {
  if (!proj.impactCloud) return;
  const ownerColor = proj.ownerColor ?? bridge.getPlayerColor(proj.ownerId) ?? proj.color;
  ctx.stinkCloudSystem.hostCreateStationaryCloud(
    proj.ownerId, ownerColor, x, y,
    proj.impactCloud.radius,
    proj.impactCloud.duration,
    proj.impactCloud.damagePerTick,
    proj.impactCloud.tickInterval,
    proj.impactCloud.rockDamageMult ?? 1,
    proj.impactCloud.trainDamageMult ?? 1,
    proj.impactCloud.baseDamageMult ?? 1,
    proj.impactCloud.visualVariant,
  );
}

/**
 * Item-Affixe, die an einem eigenen Gegner-Kill haengen: Kampfaufladung und Brandzerfall.
 *
 * Laeuft aus dem Kill-Callback, weil dort sowohl der Killer feststeht als auch
 * `getLastDamageOrigin` noch gefuellt ist - aufgeraeumt wird erst danach.
 */
function hostHandleCoopDefenseItemKill(
  ctx: ArenaContext,
  playerRuntime: WorldPlayerGameplayRuntime | null,
  killerId: string,
  victimId: string,
  x: number,
  y: number,
): void {
  const runtime = playerRuntime?.systems.itemRuntime;
  // Nur der tatsaechliche Killer, nicht das ganze Team: Kills durch Verbuendete zaehlen nicht.
  if (!runtime || bridge.getPlayerProfile(killerId) === undefined) return;

  runtime.registerOwnKill(killerId);

  // Brandzerfall verlangt einen Kill durch *direkten* Primaerwaffenschaden; Explosionen,
  // Brand, Kettenblitze und Bodenflaechen loesen ihn nicht aus.
  const origin = ctx.combatSystem.getLastDamageOrigin(victimId);
  if (origin?.kind !== 'direct' || origin.slot !== 'weapon1') return;
  if (!runtime.rollFireChunksOnKill(killerId)) return;

  playerRuntime?.systems.flamethrowerUpgrade?.hostCreateFireChunkBurst(killerId, x, y, {
    count: COOP_DEFENSE_AFFIX_RULES.fireChunkCount,
    searchRadius: COOP_DEFENSE_AFFIX_RULES.fireChunkRadius,
    flightMs: 320,
    igniteCenter: false,
    durationMs: COOP_DEFENSE_AFFIX_RULES.fireChunkGroundDurationMs,
    burnDurationMs: COOP_DEFENSE_AFFIX_RULES.fireChunkBurnDurationMs,
    burnDamagePerTick: COOP_DEFENSE_AFFIX_RULES.fireChunkBurnDamagePerTick,
    sourceId: 'ground_fire.fire_decay',
  }, `item-fire-chunks:${killerId}`);
}
