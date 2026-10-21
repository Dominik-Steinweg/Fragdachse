import { getConstructionBounds } from '../../systems/ConstructionGeometry';
import { WorldZeusBinding } from '../../world/WorldZeusBinding';
import { WorldStinkPlagueBinding } from '../../world/WorldStinkPlagueBinding';
import { WorldSmokeBinding } from '../../world/WorldSmokeBinding';
import { bridge } from '../../network/bridge';
import { resolveActivityDefinition } from '../../world/WorldDefinitionResolution';
import { CELL_SIZE } from '../../config';
import { GROUND_FIRE_CELL_SIZE } from '../../effects/FireSystem';
import type { SyncedBurningGroundSnapshot } from '../../types';
import { CAPTURE_THE_BEER_MODE } from '../../gameModes';
import { WorldGeometryBinding } from '../../world/WorldGeometryBinding';
import { WorldTargetingRuntime } from '../../world/WorldTargetingRuntime';
import { WorldTrainRuntime } from '../../world/WorldTrainRuntime';
import { WorldBridgeRuntime, type WorldBridgeHostPort } from '../../world/WorldBridgeRuntime';
import { BridgeRenderer } from '../../effects/bridge/BridgeRenderer';
import { stampBridgeTerrainColor } from '../../effects/bridge/BridgeTerrainColor';
import { nearestBridgeDeckPoint } from '../../arena/BridgeGeometry';
import { resolveBridgeChargeDenial } from '../../systems/BridgeDemolitionRules';
import { BRIDGE_COLLAPSE_KILLER_ID, BRIDGE_COLLAPSE_SOURCE_ID, BRIDGE_DEMOLITION_RULES } from '../../config/bridges';
import { COOP_DEFENSE_BASE_TURRET_OWNER_ID } from '../../config';
import {
  WorldSupportGameplayRuntime,
} from '../../world/WorldSupportGameplayRuntime';
import type {
  ArenaWorldGameplay,
  ArenaWorldGameplayCompositionInput,
} from './ArenaWorldGameplayComposition';

/**
 * World-Umgebung einer Instanz: Geometrie-Anbindung, Zielfelder, Zug und Support-Ultimates.
 *
 * Diese Composer erzeugen genau ihre Owner und binden sie an die `WorldRuntime`; sie halten
 * keinen eigenen Zustand und kennen die Reihenfolge der uebrigen Composer nicht.
 */

/** Geometrie-Consumer und Zielfeldsysteme der laufenden World. */
export function composeWorldGeometry(
  input: ArenaWorldGameplayCompositionInput,
  gameplay: ArenaWorldGameplay,
): void {
  const {
    scene, ctx, renderers, flow, worldRuntime, world, layout, layoutMode,
    arenaResult, placementSystem, baseManager, worldBases, presentation,
  } = input;
  const combatSystem = gameplay.combatSystem;
  if (!combatSystem) throw new Error('[ArenaWorldComposition] Combat runtime is missing');
  placementSystem.setClosedBarrierCellResolver((gridX, gridY) => (
    flow.getCoopMissionRuntime()?.coopDefenseMissionBarrierManager?.isCellClosed(gridX, gridY) ?? false
  ));
  // Eine vorbereitete Gefahrenflaeche sperrt das Bauen erst ab ihrer Ankuendigung. Host und
  // Client lesen dafuer denselben replizierten Event-Snapshot, damit Bauvorschau und
  // Host-Pruefung nicht auseinanderlaufen.
  placementSystem.setHazardEventArmedResolver((eventId) => {
    const entry = bridge.getCoopDefenseMapEventPresentationState()
      ?.find((candidate) => candidate.eventId === eventId);
    return entry === undefined ? true : entry.state !== 'dormant';
  });
  let indexedGround: SyncedBurningGroundSnapshot | undefined;
  const dangerCells = new Set<string>();
  const progressiveCellDanger = (eventId: string, gridX: number, gridY: number): boolean | null => {
    const mission = flow.getCoopMissionRuntime();
    const event = mission && resolveActivityDefinition(mission.descriptor, world.descriptor)?.mapEvents
      ?.find(candidate => candidate.id === eventId);
    if (!event || event.type !== 'ground-hazard' || !event.spread) return null;
    const ground = bridge.isHost() ? ctx.fireSystem.getGroundState() : bridge.getLatestGameState()?.burningGround;
    if (ground !== indexedGround) {
      indexedGround = ground;
      dangerCells.clear();
      for (const cell of [...(ground?.cells ?? []), ...(ground?.warnings ?? [])]) {
        const x = Math.floor(((cell.gridX + 0.5) * GROUND_FIRE_CELL_SIZE - world.metrics.offsetX) / CELL_SIZE);
        const y = Math.floor(((cell.gridY + 0.5) * GROUND_FIRE_CELL_SIZE - world.metrics.offsetY) / CELL_SIZE);
        dangerCells.add(`${x}_${y}`);
      }
    }
    return dangerCells.has(`${gridX}_${gridY}`);
  };
  placementSystem.setGroundHazardCellDangerResolver(progressiveCellDanger);
  ctx.playerManager.setGroundHazardCellDangerResolver(progressiveCellDanger);
  worldRuntime.bind({ destroy: () => {
    placementSystem.setGroundHazardCellDangerResolver(null);
    ctx.playerManager.setGroundHazardCellDangerResolver(null);
  } });
  const worldGeometryBinding = new WorldGeometryBinding({
    scene: scene,
    world,
    layout,
    bases: worldBases,
    arena: arenaResult,
    placement: placementSystem,
    baseManager,
    presentationRequired: presentation,
    playerManager: ctx.playerManager,
    combatSystem,
    decoySystem: ctx.decoySystem,
    projectileGeometry: gameplay.projectiles!,
    hostPhysics: ctx.hostPhysics,
    fireSystem: ctx.fireSystem,
    leafBlower: renderers.leafBlower,
    lighting: renderers.lighting,
    isCaptureTheBeer: layoutMode === CAPTURE_THE_BEER_MODE,
    getBarrierCellBlocked: (gridX, gridY) => (
      flow.getCoopMissionRuntime()?.coopDefenseMissionBarrierManager?.isCellClosed(gridX, gridY) ?? false
    ),
    resolveTargetGeometry: (targetId, targetType) => {
      if (targetType === 'player') {
        const player = ctx.playerManager.getPlayer(targetId);
        return player?.active ? { x: player.x, y: player.y, hitRadius: player.getHitRadius() } : null;
      }
      if (targetType === 'enemy') {
        const enemy = (gameplay.shootingRange?.enemies ?? flow.getCoopMissionRuntime()?.enemyManager)?.getEnemy(targetId);
        return enemy?.sprite.active
          ? { x: enemy.sprite.x, y: enemy.sprite.y, hitRadius: enemy.getCollisionRadius() }
          : null;
      }
      return null;
    },
    onDestroy: (binding) => {
      if (gameplay.geometry === binding) gameplay.geometry = null;
    },
  });
  worldGeometryBinding.setStructurePlatformResolver(id => {
    if (bridge.isHost()) return gameplay.player?.getStructurePlatform(id) ?? null;
    const state = bridge.getLatestGameState()?.players[id]?.structureOccupancy;
    const rock = state ? placementSystem.getRuntimeRock(state.structureId) : null;
    if (!rock || rock.kind !== 'watchtower' || rock.hp <= 0) return null;
    const bounds = getConstructionBounds(rock, world.metrics);
    return { id: rock.id, x: bounds.x, y: bounds.y, footprint: bounds };
  });
  worldRuntime.bind({ destroy: () => ctx.hostPhysics.setStructureObstacleResolver(null) });
  gameplay.geometry = worldGeometryBinding;
  worldRuntime.bind(worldGeometryBinding);
  // Host und Client halten das System: der Host autoritativ, der Client fuer die Darstellung.
  const targetingRuntime = new WorldTargetingRuntime();
  gameplay.targeting = targetingRuntime;
  worldRuntime.bind(targetingRuntime);
  
  // Eine Basisaenderung trifft alle Felder gemeinsam: Der Coordinator verschickt den Patch
}

/**
 * Authored bridges of this World: the state owner on every peer (writer on the host, projection
 * on clients) and their presentation. Worlds without bridges get neither.
 */
export function composeWorldBridges(
  input: ArenaWorldGameplayCompositionInput,
  gameplay: ArenaWorldGameplay,
): void {
  const { scene, ctx, renderers, flow, worldRuntime, world, layout, presentation } = input;
  const bridges = layout.bridges ?? [];
  if (bridges.length === 0) return;
  const geometry = gameplay.geometry;
  const combatSystem = gameplay.combatSystem;
  if (!geometry || !combatSystem) throw new Error('[ArenaWorldComposition] Bridges need World geometry and combat');
  const enemies = () => (gameplay.shootingRange?.enemies ?? flow.getCoopMissionRuntime()?.enemyManager) ?? null;
  const inside = (deck: { x: number; y: number; width: number; height: number }, x: number, y: number) => (
    x >= deck.x && x < deck.x + deck.width && y >= deck.y && y < deck.y + deck.height
  );
  // A planter who left still earns the kills for the team, like a base turret.
  const credit = (playerId: string | null) => (
    playerId && bridge.getConnectedPlayers().some((profile) => profile.id === playerId)
      ? playerId : COOP_DEFENSE_BASE_TURRET_OWNER_ID
  );
  const host: WorldBridgeHostPort | undefined = bridge.isHost() ? {
    now: () => bridge.getSynchronizedNow(),
    isFuseClockRunning: () => flow.isActivityActive(),
    listDeckVictims: (deck) => {
      const players = ctx.playerManager.getAllPlayers()
        .filter((player) => combatSystem.isAlive(player.id) && inside(deck, player.x, player.y))
        .map((player) => player.id);
      const ordinary: string[] = [];
      const bosses: string[] = [];
      enemies()?.forEachEnemy((enemy) => {
        if (!enemy.sprite.active || !inside(deck, enemy.sprite.x, enemy.sprite.y)) return;
        // Swimmers stay afloat; burrowed or submerged bodies are not on the planks.
        if (enemy.isAmphibious() || enemy.isBurrowed() || enemy.isSubmerged()) return;
        (enemy.isBoss() || enemy.isKrakenLandBody() ? bosses : ordinary).push(enemy.id);
      });
      return { players, enemies: ordinary, bosses };
    },
    killPlayer: (playerId) => combatSystem.killPlayer(playerId, BRIDGE_COLLAPSE_SOURCE_ID, BRIDGE_COLLAPSE_KILLER_ID),
    killEnemy: (enemyId, creditTo, x, y) => {
      const enemy = enemies()?.getEnemy(enemyId);
      if (!enemy) return;
      const revivedAlly = enemy.faction === 'allied';
      combatSystem.applyDamage(enemyId, Math.max(9999, enemy.getHp()), true, credit(creditTo),
        BRIDGE_COLLAPSE_SOURCE_ID, { sourceX: x, sourceY: y }, { allowTeamDamage: revivedAlly });
    },
    damageBoss: (enemyId, fraction, creditTo, x, y) => {
      const enemy = enemies()?.getEnemy(enemyId);
      if (!enemy) return;
      combatSystem.applyDamage(enemyId, Math.ceil(enemy.getMaxHp() * fraction), true, credit(creditTo),
        BRIDGE_COLLAPSE_SOURCE_ID, { sourceX: x, sourceY: y });
    },
    detonate: (x, y, creditTo) => {
      const { blastRadiusPx, blastDamage } = BRIDGE_DEMOLITION_RULES;
      combatSystem.applyAoeDamage(x, y, blastRadiusPx, blastDamage, credit(creditTo), false, {
        sourceId: BRIDGE_COLLAPSE_SOURCE_ID, damageKind: 'explosion',
      });
      ctx.hostPhysics.applyRadialImpulse(x, y, blastRadiusPx, 260);
      // Ordinary thermal burst: dynamite, not a faction weapon.
      bridge.broadcastExplosionEffect(x, y, blastRadiusPx, undefined, 'default', undefined, BRIDGE_COLLAPSE_SOURCE_ID);
    },
    relocateGroundItems: (deck) => flow.getCoopMissionRuntime()?.coopDefenseCarrySystem?.relocateGroundItems(deck),
  } : undefined;
  const runtime = new WorldBridgeRuntime({
    bridges,
    origin: world.metrics,
    geometry,
    host,
    onDestroy: (destroyed) => { if (gameplay.bridges === destroyed) gameplay.bridges = null; },
  });
  gameplay.bridges = runtime;
  worldRuntime.bind(runtime);
  if (host) {
    // Planting re-checks the shared rule on the host before the explosive is used up.
    bridge.registerBridgeChargeHandler((playerId, request) => {
      const target = runtime.getBridge(request.bridgeId);
      const state = runtime.getState(request.bridgeId);
      const player = ctx.playerManager.getPlayer(playerId);
      if (!target || !state || !player || bridge.isArenaCountdownActive()) return false;
      const carry = flow.getCoopMissionRuntime()?.coopDefenseCarrySystem ?? null;
      const capabilities = flow.getPlayerCapabilities(playerId);
      const point = nearestBridgeDeckPoint(target, world.metrics, player.x, player.y);
      const denial = resolveBridgeChargeDenial({
        phase: state.phase,
        carryingExplosive: carry?.isCarrying(playerId, 'explosive') ?? false,
        distancePx: Math.hypot(point.x - player.x, point.y - player.y),
        allowed: bridge.getWorldParticipation(playerId) === 'interactive'
          && capabilities.canInteract && capabilities.canUseMissionActions
          && combatSystem.isAlive(playerId)
          && !(gameplay.player?.isBurrowed(playerId) ?? false)
          && !gameplay.player?.getStructureOccupancyState(playerId)
          && !gameplay.player?.getTurretControlState(playerId),
      });
      if (denial || !carry?.consumeCarried(playerId, 'explosive')) return false;
      return runtime.charge(request.bridgeId, playerId) === 'charged';
    });
    worldRuntime.bind({ destroy: () => bridge.registerBridgeChargeHandler(null) });
  }
  if (presentation) {
    const renderer = new BridgeRenderer(scene, bridges, world.metrics, {
      onFuseCue: (x, y) => ctx.gameAudioSystem.playSound('sfx_airstrike_countdown', x, y, undefined, 0.7),
    });
    let stampedSnapshot: unknown = null;
    worldRuntime.bind({
      update: () => {
        const collapseChanged = renderer.sync((id) => runtime.getState(id), bridge.getSynchronizedNow());
        if (collapseChanged) renderers.shadow.setCollapsedBridges(runtime.getCollapsedIds());
        // The terrain colour snapshot arrives asynchronously after the World and bakes authored water.
        const snapshot = renderers.movement.getTerrainColorSnapshot();
        if (snapshot && (collapseChanged || snapshot !== stampedSnapshot)) {
          stampBridgeTerrainColor(snapshot, bridges, world.metrics, runtime.getCollapsedIds());
          stampedSnapshot = snapshot;
        }
      },
      destroy: () => {
        renderer.destroy();
        renderers.shadow.setCollapsedBridges(new Set());
      },
    });
  }
}

/** Der World-Zug: Renderer auf jedem Peer, autoritative Steuerung beim Host. */
export function composeWorldTrain(
  input: ArenaWorldGameplayCompositionInput,
  gameplay: ArenaWorldGameplay,
): void {
  const { scene, ctx, renderers, hostUpdate, flow, worldRuntime, world, presentation } = input;
  const combatSystem = gameplay.combatSystem;
  if (!combatSystem) throw new Error('[ArenaWorldComposition] Combat runtime is missing');
  // The renderer is World-scoped on every peer; authoritative train setup is owned by the
  // World train runtime after the systems it references have been bound.
  const trainRuntime = new WorldTrainRuntime({
    scene: scene,
    playerManager: ctx.playerManager,
    projectileTrain: gameplay.projectiles!,
    combatSystem,
    hostPhysics: ctx.hostPhysics,
    worldMetrics: world.metrics,
    presentationRequired: presentation,
    gameAudioSystem: ctx.gameAudioSystem,
    vfx: presentation ? { gpu: renderers.gpuVfx, camera: ctx.visualFeedback.camera,
      lighting: renderers.lighting,
      sampleGround: (x, y) => renderers.movement.sampleGroundColor(x, y) } : undefined,
    network: {
      clock: {
        getArenaStartTime: () => bridge.getArenaStartTime(),
        now: () => bridge.getSynchronizedNow(),
      },
      trainEvents: {
        isHost: () => bridge.isHost(),
        get: () => bridge.getTrainEvent(),
        publish: (event) => bridge.publishTrainEvent(event),
        clear: () => bridge.clearTrainEvent(),
      },
      matchEvents: {
        addPlayerFrags: (playerId, amount) => bridge.addPlayerFrags(playerId, amount),
        getConnectedPlayers: () => bridge.getConnectedPlayers(),
        broadcastKillEvent: (event) => bridge.broadcastKillEvent(event),
        broadcastTrainDestroyed: () => bridge.broadcastTrainDestroyed(),
      },
      effects: {
        broadcastTrainBurrowSparks: (x, y) => bridge.broadcastTrainBurrowSparks(x, y),
        broadcastExplosionEffect: (x, y, radius, color, visualStyle) => (
          bridge.broadcastExplosionEffect(x, y, radius, color, visualStyle, undefined, 'silent')
        ),
      },
    },
    getEnemyManager: () => (gameplay.shootingRange?.enemies ?? flow.getCoopMissionRuntime()?.enemyManager) ?? null,
    getFireChunkPort: () => gameplay.player?.getPlayerFireChunkPort() ?? null,
    isPlayerBurrowed: (playerId) => gameplay.player?.isBurrowed(playerId) ?? false,
    resolveBurrowDamage: (playerId, baseDamage) => gameplay.player?.getPlayerModifierReadPort()
      .getResolvedStat(playerId, 'player.burrowTrainDamage', baseDamage) ?? baseDamage,
    getTimeBubbleSystem: () => gameplay.combat?.systems?.timeBubble ?? null,
    setTranslocatorTrainManager: (train) => gameplay.player?.setTranslocatorTrainManager(train),
    getPowerUpSystem: () => gameplay.powerUp?.system ?? null,
    setClassicTrainSpawned: (spawned) => { hostUpdate.setClassicTrainSpawned(spawned); },
    onRendererChanged: (renderer) => {
      renderers.train = renderer;
      ctx.effectSystem.setTrainExplosionRenderer(renderer ? (x, y, radius) => renderer.playExplosion(x, y, radius) : null);
    },
  });
  gameplay.train = trainRuntime;
  worldRuntime.bind(trainRuntime);
}

/**
 * Host-seitige Support-Ultimates und der klassische Zugrhythmus der Nicht-Coop-Modi.
 */
export function composeWorldSupportGameplay(
  input: ArenaWorldGameplayCompositionInput,
  gameplay: ArenaWorldGameplay,
): void {
  const { ctx, hostUpdate, flow, worldRuntime, world, layout, arenaResult, isCoopMission } = input;
  const combatSystem = gameplay.combatSystem;
  if (!combatSystem) throw new Error('[ArenaWorldComposition] Combat runtime is missing');
  if (!gameplay.player) {
    throw new Error('[ArenaWorldComposition] Player gameplay runtime is missing on host');
  }
  if (!gameplay.projectiles) {
    throw new Error('[ArenaWorldComposition] Projectile runtime is missing on host');
  }
  
  const slime = gameplay.player.getPlayerCombatIntegrationPort().slimeTrail;
  slime?.setValidCellChecker((x, y, size) => {
    const m = world.metrics;
    return x - size / 2 >= m.offsetX && y - size / 2 >= m.offsetY
      && x + size / 2 <= m.maxX && y + size / 2 <= m.maxY
      && ((gameplay.shootingRange?.ground ?? flow.getCoopMissionRuntime()?.enemyFlowFieldService)?.isCircleGroundFreeAt(x, y, size / 2) ?? false);
  });
  const supportGameplayRuntime = new WorldSupportGameplayRuntime({
    zeus: new WorldZeusBinding(combatSystem, ctx.playerManager, () => (gameplay.shootingRange?.enemies ?? flow.getCoopMissionRuntime()?.enemyManager) ?? null,
      ctx.hostPhysics, gameplay.projectiles, gameplay.player.getPlayerCombatIntegrationPort().utility),
    plague: new WorldStinkPlagueBinding({
      combat: combatSystem, getEnemies: () => (gameplay.shootingRange?.enemies ?? flow.getCoopMissionRuntime()?.enemyManager) ?? null,
      getNavigation: () => gameplay.shootingRange?.ground ?? flow.getCoopMissionRuntime()?.enemyFlowFieldService ?? null,
      status: gameplay.targeting!.systems.targetStatus,
      slimeTrail: slime,
      isPlayerPresent: playerId => ctx.playerManager.getPlayer(playerId) !== undefined,
      areAllies: (left, right) => left === right || !bridge.isEnemyPair(left, right),
      deathBurst: (enemyId, x, y, now, contribution) => slime?.handleEnemyDeath(enemyId, x, y, now, contribution) ?? null,
      publishBurst: burst => bridge.broadcastSlimeBloomEffect(burst.x, burst.y, burst.targets),
    }),
    smoke: new WorldSmokeBinding(combatSystem, () => (gameplay.shootingRange?.enemies ?? flow.getCoopMissionRuntime()?.enemyManager) ?? null,
      gameplay.targeting!.systems.targetStatus, gameplay.projectiles),
    playerManager: ctx.playerManager,
    projectileExternalInteraction: gameplay.projectiles,
    combatSystem,
    setBurrowStinkCloudSystem: (system) => gameplay.player?.setBurrowStinkCloudSystem(system),
    gameAudioSystem: ctx.gameAudioSystem,
    worldMetrics: world.metrics,
    rockGrid: arenaResult.rockGrid,
    stinkCloudSystem: ctx.stinkCloudSystem,
    reportDiagnosticEvent: (type, fields) => flow.onDiagnosticEvent(type, fields),
    broadcastExplosion: (x, y, radius, color, style) => bridge.broadcastExplosionEffect(x, y, radius, color, style, undefined, 'environment.airstrike'),
    applyAirstrikeEnvironmentDamage: (x, y, radius, config, triggeredBy) => (
      hostUpdate.applyAirstrikeEnvironmentDamage(x, y, radius, config, triggeredBy)
    ),
    onDestroy: () => {
      slime?.setValidCellChecker(null);
      gameplay.player?.setArmageddonCapability(null);
      gameplay.player?.setAirstrikeCapability(null);
    },
  });
  gameplay.support = supportGameplayRuntime;
  // Der Buff-/Armageddon-Behavior-Owner bekommt nur die world-scoped Capability. Die
  // Armageddon-Sessions selbst bleiben beim Support-Owner und werden nicht im Loadout verdrahtet.
  gameplay.player?.setArmageddonCapability(supportGameplayRuntime.systems.armageddon);
  gameplay.player?.setAirstrikeCapability(supportGameplayRuntime);
  worldRuntime.bind(supportGameplayRuntime);
  
  
  const trackCell = layout.tracks?.[0];
  if (!isCoopMission && trackCell !== undefined) {
    // Nicht-Coop-Modi behalten ihren klassischen, wiederholbaren Zugrhythmus.
    gameplay.train?.setupClassicTrain(trackCell.gridX);
  } else if (!isCoopMission) {
    // Das Zug-Event ist reliable und überlebt den Rundenwechsel; ohne aktives Löschen
    // würde eine zuglose Map das HUD der Vorrunde weiterspielen.
    bridge.clearTrainEvent();
  }
  
}
