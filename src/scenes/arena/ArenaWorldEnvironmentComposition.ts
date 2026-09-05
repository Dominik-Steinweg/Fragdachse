import { bridge } from '../../network/bridge';
import { CAPTURE_THE_BEER_MODE } from '../../gameModes';
import { WorldGeometryBinding } from '../../world/WorldGeometryBinding';
import { WorldTargetingRuntime } from '../../world/WorldTargetingRuntime';
import { WorldTrainRuntime } from '../../world/WorldTrainRuntime';
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
    combatSystem: ctx.combatSystem,
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
    onDestroy: (binding) => {
      if (gameplay.geometry === binding) gameplay.geometry = null;
    },
  });
  gameplay.geometry = worldGeometryBinding;
  worldRuntime.bind(worldGeometryBinding);
  // Host und Client halten das System: der Host autoritativ, der Client fuer die Darstellung.
  const targetingRuntime = new WorldTargetingRuntime();
  gameplay.targeting = targetingRuntime;
  worldRuntime.bind(targetingRuntime);
  
  // Eine Basisaenderung trifft alle Felder gemeinsam: Der Coordinator verschickt den Patch
}

/** Der World-Zug: Renderer auf jedem Peer, autoritative Steuerung beim Host. */
export function composeWorldTrain(
  input: ArenaWorldGameplayCompositionInput,
  gameplay: ArenaWorldGameplay,
): void {
  const { scene, ctx, renderers, hostUpdate, flow, worldRuntime, world, presentation } = input;
  // The renderer is World-scoped on every peer; authoritative train setup is owned by the
  // World train runtime after the systems it references have been bound.
  const trainRuntime = new WorldTrainRuntime({
    scene: scene,
    playerManager: ctx.playerManager,
    projectileTrain: gameplay.projectiles!,
    combatSystem: ctx.combatSystem,
    hostPhysics: ctx.hostPhysics,
    worldMetrics: world.metrics,
    presentationRequired: presentation,
    gameAudioSystem: ctx.gameAudioSystem,
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
          bridge.broadcastExplosionEffect(x, y, radius, color, visualStyle)
        ),
      },
    },
    getEnemyManager: () => flow.getCoopMissionRuntime()?.enemyManager ?? null,
    isPlayerBurrowed: (playerId) => gameplay.player?.isBurrowed(playerId) ?? false,
    getTimeBubbleSystem: () => gameplay.combat?.systems?.timeBubble ?? null,
    setTranslocatorTrainManager: (train) => gameplay.player?.setTranslocatorTrainManager(train),
    getPowerUpSystem: () => gameplay.powerUp?.system ?? null,
    setClassicTrainSpawned: (spawned) => { hostUpdate.setClassicTrainSpawned(spawned); },
    onRendererChanged: (renderer) => { renderers.train = renderer; },
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
  if (!gameplay.player) {
    throw new Error('[ArenaWorldComposition] Player gameplay runtime is missing on host');
  }
  if (!gameplay.projectiles) {
    throw new Error('[ArenaWorldComposition] Projectile runtime is missing on host');
  }
  
  const supportGameplayRuntime = new WorldSupportGameplayRuntime({
    playerManager: ctx.playerManager,
    projectileExternalInteraction: gameplay.projectiles,
    combatSystem: ctx.combatSystem,
    setBurrowStinkCloudSystem: (system) => gameplay.player?.setBurrowStinkCloudSystem(system),
    gameAudioSystem: ctx.gameAudioSystem,
    worldMetrics: world.metrics,
    rockGrid: arenaResult.rockGrid,
    stinkCloudSystem: ctx.stinkCloudSystem,
    reportDiagnosticEvent: (type, fields) => flow.onDiagnosticEvent(type, fields),
    broadcastExplosion: (x, y, radius, color, style) => bridge.broadcastExplosionEffect(x, y, radius, color, style),
    applyAirstrikeEnvironmentDamage: (x, y, radius, config, triggeredBy) => (
      hostUpdate.applyAirstrikeEnvironmentDamage(x, y, radius, config, triggeredBy)
    ),
    onDestroy: () => {
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
