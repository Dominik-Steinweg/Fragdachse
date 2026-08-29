import type Phaser from 'phaser';
import { bridge }          from '../../network/bridge';
import type { GameState }  from '../../network/NetworkBridge';
import { dequantizeAngle } from '../../utils/angle';
import { NET_SMOOTH_TIME_MS, DASH_T2_S, PLAYER_COLORS, PLAYER_SIZE, getTopDownMuzzleOrigin } from '../../config';
import { isVelocityMoving } from '../../loadout/SpreadMath';
import { getUtilityConfigForMode, WEAPON_CONFIGS, UTILITY_CONFIGS, ULTIMATE_CONFIGS } from '../../loadout/LoadoutConfig';
import { applyCoopDefenseModifiersToUtilityConfig } from '../../loadout/CoopDefenseLoadoutModifiers';
import { createCoopDefensePlaceablePedestalUtility } from '../../loadout/CoopDefenseMissionUtility';
import { resolveEffectiveLoadoutSelection } from '../../loadout/LoadoutRules';
import { getHitscanRangeToCursor } from '../../loadout/WeaponFireExecutor';
import { getHeldWeaponGameplayMuzzleOrigin, getHeldWeaponMuzzleOrigin } from '../../loadout/HeldItemVisuals';
import type { UtilityConfig, WeaponConfig } from '../../loadout/LoadoutConfig';
import { DEFAULT_LOADOUT }   from '../../loadout/LoadoutConfig';
import { buildLocalArenaHudData } from '../../ui/LocalArenaHudData';
import { bfgFlightRumble } from '../../effects/camera/cameraFeedbackPresets';
import type { ArenaContext }     from './ArenaContext';
import type { LocalPlayerState } from './LocalPlayerState';
import type { RockVisualHelper } from './RockVisualHelper';
import type { BurrowPhase, CoopDefenseClassId, CoopDefenseItem, CoopDefenseUpgradeProfile, LoadoutCommitSnapshot, LoadoutToolRef, LoadoutUseParams, LoadoutUseResult, PlayerProfile, SyncedPowerUp, WeaponSlot } from '../../types';
import { PICKUP_RADIUS }     from '../../powerups/PowerUpConfig';
import type { PlayerEntity } from '../../entities/PlayerEntity';
import { ROCK_HP_MAX } from '../../config';
import {
  getStoredCoopDefenseProgress,
  getStoredEquippedCoopDefenseItems,
  setStoredCoopDefenseUpgradeProfile,
} from '../../utils/localPreferences';
import { getCoopDefenseCommittedEffectTotals } from '../../utils/coopDefenseItemEffects';
import { EMPTY_COOP_DEFENSE_EFFECT_TOTALS, resolveCoopDefenseStat } from '../../utils/coopDefenseStats';
import { COOP_DEFENSE_CONSTRUCTION_CAPACITY_STAT, getCoopDefenseConstructionDefinition, getToolCapacityCost, resolveConstructionCapacity } from '../../config/coopDefenseConstructions';
import { getActiveConstructionToolRefs, getConstructionAccessContext } from '../../systems/ConstructionAccessResolver';
import { isCoopDefenseMode } from '../../gameModes';
import { EnemyDashVisualTracker } from '../../effects/EnemyDashVisuals';
import { getLocale } from '../../i18n';
import { getHudBuffValueText } from '../../i18n/hudPresentation';
import { emitArenaMapGridChanged } from './ArenaEvents';
import type { WorldPresentationRequirement } from '../../world/WorldPresentation';
import { consumesWorldReplication } from '../../world/WorldReplication';
import { resolveEffectiveAdrenalineCost } from '../../systems/AdrenalineCost';

/** Geteilte Leer-Instanz: vermeidet eine Allokation pro Aufruf ohne Coop-Profil. */
const EMPTY_EFFECT_TOTALS = EMPTY_COOP_DEFENSE_EFFECT_TOTALS;

export type LocalWeaponPredictionResult =
  | { fired: false }
  | { fired: true; predictionId: number; shotId?: number };

export interface PredictedWeapon2Request {
  angle: number;
  targetX: number;
  targetY: number;
  shotId?: number;
  params?: LoadoutUseParams;
  clientX?: number;
  clientY?: number;
  clientNow?: number;
}

type PendingWeapon2Prediction = {
  worldRevision: number;
  predictionId: number;
  amount: number;
  request: PredictedWeapon2Request;
  status: 'pending' | 'uncertain' | 'acknowledged';
  retryInFlight: boolean;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryDelayMs: number;
  onReject?: (result: LoadoutUseResult) => void;
};

type LocalFirePrediction = {
  worldRevision: number;
  predictionId?: number;
  firedAt: number;
  status: 'pending' | 'processed' | 'accepted' | 'rejected';
};

export interface ClientUpdatePerformanceMetrics {
  totalMs: number;
  snapshotMs: number;
  playersMs: number;
  projectilesEffectsMs: number;
  worldStateMs: number;
  interpolationMs: number;
  hudMs: number;
  postSyncMs: number;
  newSnapshot: boolean;
}

/**
 * Runs every frame on non-host clients.
 *
 * Owns all client-side interpolation state and predictive local feedback
 * (weapon cooldown, hitscan tracer, pickup spam protection).
 */
export class ClientUpdateCoordinator {
  private lastGameStateVersion = -1;
  private readonly damagedStaticRockIds = new Set<number>();
  private readonly prevAliveStates      = new Map<string, boolean>();
  private readonly prevDashPhases       = new Map<string, number>();
  private readonly prevBurrowPhases     = new Map<string, BurrowPhase>();
  private readonly burrowLoopHandles    = new Map<string, string>();
  private readonly prevStealthStates    = new Map<string, boolean>();
  private readonly dashPhase2StartTimes = new Map<string, number>();
  private readonly dashTrailTimers      = new Map<string, number>();
  private weaponLastFired: Record<'weapon1' | 'weapon2', number> = { weapon1: 0, weapon2: 0 };
  /**
   * Caches fuer die Loadout-Aufloesung. Beide sind ueber die Objektreferenz ihrer Eingabe
   * geschluesselt und damit selbstinvalidierend – ein neuer Snapshot liefert eine neue
   * Referenz. Siehe {@link resolveCommittedLoadoutSelection}.
   */
  private committedSelectionCache: {
    key: object;
    mode: ReturnType<typeof bridge.getGameMode>;
    playerId: string;
    value: ReturnType<typeof resolveEffectiveLoadoutSelection>;
  } | null = null;
  private storedProfileFallback: CoopDefenseUpgradeProfile | null = null;
  private storedItemsFallback: readonly CoopDefenseItem[] | null = null;
  private storedClassIdFallback: CoopDefenseClassId | null = null;
  private authoritativeAdrenaline: {
    worldRevision: number;
    value: number;
    revision: number;
    weapon2PredictionAck: number;
  } | null = null;
  private readonly pendingAdrenalineSpends = new Map<number, PendingWeapon2Prediction>();
  private readonly localFirePredictions: Record<'weapon1' | 'weapon2', LocalFirePrediction[]> = {
    weapon1: [],
    weapon2: [],
  };
  private nextPredictionId = 1;
  private nextPredictedHitscanShotId = 1;
  private pickupCooldownUntil = 0;
  private moveLoopHandle: string | null = null;
  private readonly pendingPickupUids = new Set<number>();
  private lastPerformance: ClientUpdatePerformanceMetrics = {
    totalMs: 0, snapshotMs: 0, playersMs: 0, projectilesEffectsMs: 0,
    worldStateMs: 0, interpolationMs: 0, hudMs: 0, postSyncMs: 0, newSnapshot: false,
  };
  private performanceMetricsEnabled = false;
  private coarsePerformanceMetricsEnabled = false;

  /** Locally reconstructed utility override from the host-published descriptor. */
  clientUtilityOverride: UtilityConfig | null = null;
  private inspectorSelectedTool: LoadoutToolRef | null = null;

  private readonly enemyDashVisuals: EnemyDashVisualTracker;
  private attachPlayerToWorld:
    ((profile: PlayerProfile, spawn: { readonly x: number; readonly y: number }) => boolean) | null = null;
  private detachPlayerFromWorld: ((playerId: string) => void) | null = null;
  private getWorldPresentation: (() => WorldPresentationRequirement) | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ctx: ArenaContext,
    private readonly localPlayerState: LocalPlayerState,
    private readonly rockVisualHelper: RockVisualHelper,
  ) {
    // Auf dem Client gibt es keine Physik – die Ausweich-Skalierung kommt hier aus der
    // uebertragenen Dash-Phase.
    this.enemyDashVisuals = new EnemyDashVisualTracker(
      this.scene,
      this.ctx.effectSystem,
      this.ctx.gameAudioSystem,
      true,
    );
    this.refreshStoredProgressFallback();
  }

  /** Verbindet den Client-Snapshot mit demselben PlayerWorldRuntime wie Host-Spawns. */
  setPlayerWorldRuntime(
    attach: (profile: PlayerProfile, spawn: { readonly x: number; readonly y: number }) => boolean,
    detach: (playerId: string) => void,
  ): void {
    this.attachPlayerToWorld = attach;
    this.detachPlayerFromWorld = detach;
  }

  /** Verbindet Snapshot-Konsum mit derselben kanonischen Presentation wie die Scene. */
  setWorldPresentationResolver(resolve: () => WorldPresentationRequirement): void {
    this.getWorldPresentation = resolve;
  }

  setPerformanceMetricsEnabled(enabled: boolean): void {
    if (this.coarsePerformanceMetricsEnabled === enabled) return;
    this.coarsePerformanceMetricsEnabled = enabled;
    // The companion HUD needs the complete client-sync cost, not a timestamp pair around every
    // renderer and interpolation subsection.
    this.performanceMetricsEnabled = false;
    if (!enabled) {
      this.lastPerformance = {
        totalMs: 0, snapshotMs: 0, playersMs: 0, projectilesEffectsMs: 0,
        worldStateMs: 0, interpolationMs: 0, hudMs: 0, postSyncMs: 0, newSnapshot: false,
      };
    }
  }

  /**
   * Gleicht den clientseitigen Entity-Lifecycle mit der autoritativen WorldParticipation ab.
   *
   * Der Abbau braucht keinen GameState: genau dadurch kann ein Leave verarbeitet werden, auch
   * wenn anschliessend weder Gameplay noch eine lokale Player-Presentation aktiv ist. Fuer neue
   * Entities bleibt der aktuelle World-Snapshot die zweite notwendige Quelle.
   */
  private syncPlayerWorldRuntimes(state: GameState | undefined): void {
    const participationKnown = bridge.getWorldParticipationState() !== null;
    if (!participationKnown) return;
    for (const player of [...this.ctx.playerManager.getAllPlayers()]) {
      if (bridge.getWorldParticipation(player.id) === 'interactive') continue;
      this.detachPlayerFromWorld?.(player.id);
    }
    if (!state) return;
    for (const [id, ps] of Object.entries(state.players)) {
      if (bridge.getWorldParticipation(id) !== 'interactive') continue;
      if (this.ctx.playerManager.hasPlayer(id)) continue;
      const profile = bridge.getConnectedPlayers().find((candidate) => candidate.id === id);
      // Der Snapshot ist hier die einzige Spawn-Quelle: die Figur entsteht genau dort, wo der
      // Host sie gesetzt hat, samt Materialisierungseffekt an derselben Stelle.
      if (profile) this.attachPlayerToWorld?.(profile, { x: ps.x, y: ps.y });
    }
  }

  runClientUpdate(delta: number): void {
    const countdownActive = bridge.isArenaCountdownActive();
    if (!this.ctx.world) {
      this.lastPerformance = {
        totalMs: 0,
        snapshotMs: 0,
        playersMs: 0,
        projectilesEffectsMs: 0,
        worldStateMs: 0,
        interpolationMs: 0,
        hudMs: 0,
        postSyncMs: 0,
        newSnapshot: false,
      };
      return;
    }
    const state = bridge.getLatestGameState();
    // Participation-Transitions sind ein eigener reliable Kanal. Sie muessen vor jedem
    // Replication-/Presentation-Gate laufen, damit insbesondere `interactive -> none` die lokale
    // Runtime noch abbaut, bevor der Peer nur noch eine Preview konsumiert.
    this.syncPlayerWorldRuntimes(state);
    const presentation = this.getWorldPresentation?.();
    if (!presentation || !consumesWorldReplication({
      worldActive: true,
      participation: bridge.getLocalWorldParticipation(),
      presentation,
    })) {
      this.lastPerformance = {
        totalMs: 0,
        snapshotMs: 0,
        playersMs: 0,
        projectilesEffectsMs: 0,
        worldStateMs: 0,
        interpolationMs: 0,
        hudMs: 0,
        postSyncMs: 0,
        newSnapshot: false,
      };
      return;
    }
    const startedAt = this.coarsePerformanceMetricsEnabled ? performance.now() : 0;
    this.reconcileClientUtilityOverride();
    this.ctx.coopDefenseMissionBarrierManager?.syncPresentationState(
      bridge.getCoopDefenseMissionProgressPresentationState(),
    );
    // B1's reliable presentation snapshot is independent of the ticked GameState. Sync it first
    // so a dormant structure can materialize even when no base HP delta arrived this frame.
    this.ctx.baseManager?.syncDormantStates();
    if (!state) {
      if (this.coarsePerformanceMetricsEnabled) {
        this.lastPerformance = {
          totalMs: performance.now() - startedAt,
          snapshotMs: performance.now() - startedAt,
          playersMs: 0, projectilesEffectsMs: 0, worldStateMs: 0,
          interpolationMs: 0, hudMs: 0, postSyncMs: 0, newSnapshot: false,
        };
      }
      return;
    }

    // Ressourcen-Baseline und replaybarer Weapon2-ACK werden unabhängig von der Renderphase
    // verarbeitet. Ein Reconnect kann dabei einen ACK liefern, ohne eine RPC-Antwort zu liefern.
    this.reconcileAuthoritativeAdrenalineFromSnapshot();

    const lerpFactor = 1 - Math.exp(-delta / NET_SMOOTH_TIME_MS);

    const currentVersion = bridge.getGameStateVersion();
    const isNewData = currentVersion !== this.lastGameStateVersion;
    if (isNewData) this.lastGameStateVersion = currentVersion;
    const snapshotMs = this.performanceMetricsEnabled ? performance.now() - startedAt : 0;
    let playersMs = 0;
    let projectilesEffectsMs = 0;
    let worldStateMs = 0;
    const participationKnown = bridge.getWorldParticipationState() !== null;

    if (isNewData) {
      const playersStartedAt = this.performanceMetricsEnabled ? performance.now() : 0;
      const localId = bridge.getLocalPlayerId();
      for (const [id, ps] of Object.entries(state.players)) {
        if (participationKnown && bridge.getWorldParticipation(id) !== 'interactive') continue;
        const player = this.ctx.playerManager.getPlayer(id);
        if (!player) continue;

        const wasAlive = this.prevAliveStates.get(id) ?? false;
        if (ps.alive && !wasAlive && !countdownActive) {
          player.setPosition(ps.x, ps.y);
          this.ctx.gameAudioSystem.playSound('sfx_player_spawn', ps.x, ps.y, id);
        }
        if (!countdownActive) this.prevAliveStates.set(id, ps.alive);

        player.setTargetPosition(ps.x, ps.y);
        if (id !== localId) {
          player.setTargetRotation(dequantizeAngle(ps.rot));
        }
        player.updateHP(ps.hp, ps.maxHp);
        player.updateArmor(ps.armor);
        player.updateBurnStacks(ps.burnStacks ?? 0, ps.burnVisualStyle ?? 'normal');
        player.setVisible(ps.alive);
        player.setWalking(ps.aim.isMoving && ps.alive && !ps.isBurrowed);
        player.setRageTint(ps.isRaging && ps.activeUltimateId === 'HONEY_BADGER_RAGE');
        const isStealthed = ps.isDecoyStealthed ?? false;
        const wasStealthed = this.prevStealthStates.get(id) ?? false;
        if (isStealthed !== wasStealthed) {
          this.ctx.effectSystem.playStealthTransitionEffect(player.x, player.y, !isStealthed, player.color);
        }
        player.setDecoyStealth(isStealthed);
        this.prevStealthStates.set(id, isStealthed);
        player.setHeldItemId(bridge.getPlayerHeldItemId(id));

        const curPhase = ps.dashPhase ?? 0;
        if (curPhase === 1 && (this.prevDashPhases.get(id) ?? 0) === 0) {
          this.ctx.gameAudioSystem.playSound('sfx_dash', player.x, player.y, id);
        }
        if (curPhase === 2 && (this.prevDashPhases.get(id) ?? 0) !== 2) {
          this.dashPhase2StartTimes.set(id, this.scene.time.now);
        }
        if (curPhase === 0) {
          this.dashPhase2StartTimes.delete(id);
          this.dashTrailTimers.delete(id);
        }
        this.prevDashPhases.set(id, curPhase);
        this.applyBurrowVisual(player, ps.burrowPhase);
      }

      if (this.performanceMetricsEnabled) playersMs = performance.now() - playersStartedAt;
      const effectsStartedAt = this.performanceMetricsEnabled ? performance.now() : 0;
      this.ctx.projectileManager.clientSyncVisuals(state.projectiles, bridge.getLocalPlayerId());
      this.ctx.decoySystem.syncSnapshots(state.decoys ?? []);
      this.ctx.smokeSystem.syncVisuals(state.smokes);
      this.ctx.fireSystem.syncVisuals(state.fires ?? []);
      this.ctx.stinkCloudSystem.syncVisuals(state.stinkClouds ?? []);
      if (this.performanceMetricsEnabled) projectilesEffectsMs = performance.now() - effectsStartedAt;

      // teslaDomeRenderer is accessed via the bundle (passed from ArenaScene)
      // → handled by ArenaScene.update() which calls renderers.teslaDome.syncVisuals

      const worldStartedAt = this.performanceMetricsEnabled ? performance.now() : 0;
      if (state.rocks && this.ctx.arenaResult && this.ctx.currentLayout) {
        const nextDamagedStaticRockIds = new Set<number>();
        for (const rockId of state.rockRemovals) {
          if (!this.ctx.placementSystem?.getRuntimeRock(rockId)) {
            this.rockVisualHelper.handleDestroyedRock(rockId, 'damage');
            this.damagedStaticRockIds.delete(rockId);
          }
        }
        for (const rs of state.rocks) {
          if (rs.hp <= 0) {
            this.rockVisualHelper.handleDestroyedRock(rs.id, 'damage');
            this.damagedStaticRockIds.delete(rs.id);
            continue;
          }
          if (!this.ctx.placementSystem?.getRuntimeRock(rs.id)) {
            nextDamagedStaticRockIds.add(rs.id);
          }
          this.rockVisualHelper.updateRockVisualById(rs.id, rs.hp);
        }

        for (const rockId of this.damagedStaticRockIds) {
          if (!nextDamagedStaticRockIds.has(rockId)) {
            this.rockVisualHelper.updateRockVisualById(rockId, ROCK_HP_MAX);
          }
        }

        this.damagedStaticRockIds.clear();
        for (const rockId of nextDamagedStaticRockIds) {
          this.damagedStaticRockIds.add(rockId);
        }
      }

      if (this.ctx.placementSystem) {
        const placementChanges = this.ctx.placementSystem.syncFromSnapshot(state.placeableRocks ?? []);
        this.rockVisualHelper.materializePlaceableRockBatch(placementChanges.added, true);
        for (const rock of placementChanges.added) {
          emitArenaMapGridChanged(this.scene.game.events, {
            reason: 'placeable_added',
            source: rock.kind === 'rock'
              ? 'placeable_rock'
              : rock.kind === 'pedestal' ? 'placeable_pedestal' : 'placeable_turret',
            obstacleId: rock.id,
            gridX: rock.gridX,
            gridY: rock.gridY,
            collisionMode: rock.collisionMode,
          });
        }
        for (const rock of placementChanges.updated) {
          this.rockVisualHelper.materializePlaceableRock(rock, false);
          this.rockVisualHelper.updateRockVisualById(rock.id, rock.hp);
        }
        for (const rock of placementChanges.removed) {
          const expired = bridge.getSynchronizedNow() >= rock.expiresAt;
          this.rockVisualHelper.removePlaceableRockVisual(
            rock,
            rock.kind === 'rock' || expired,
          );
          emitArenaMapGridChanged(this.scene.game.events, {
            reason: expired ? 'placeable_expired' : 'placeable_removed',
            source: rock.kind === 'rock'
              ? 'placeable_rock'
              : rock.kind === 'pedestal' ? 'placeable_pedestal' : 'placeable_turret',
            obstacleId: rock.id,
            gridX: rock.gridX,
            gridY: rock.gridY,
          });
        }
      }

      this.ctx.reinforcementMatrixSystem?.syncFromSnapshot(state.reinforcementMatrices ?? []);
      this.ctx.energyInjectorSystem?.syncEffectsFromSnapshot(state.energyInjectorEffects ?? []);
      this.ctx.energyInjectorSystem?.syncFocusFromSnapshot(state.energyInjectorFocus ?? []);
      this.ctx.targetStatusSystem?.syncFromSnapshot(state.targetVulnerabilities ?? []);

      const trainState = state.train;
      this.ctx.combatSystem.setClientTrainBounds(
        trainState?.alive ? { x: trainState.x, y: trainState.y, dir: trainState.dir } : null,
      );

      this.ctx.baseManager?.applySnapshot(state.bases ?? []);
      this.ctx.enemyManager?.applySnapshot(state.enemies);
      const vulnerabilityNow = bridge.getSynchronizedNow();
      for (const base of this.ctx.baseManager?.getBases() ?? []) {
        base.setVulnerable(
          this.ctx.targetStatusSystem?.isVulnerable(
            { targetType: 'base', targetId: base.id },
            vulnerabilityNow,
          ) ?? false,
        );
      }

      this.checkLocalPickup(state.powerups ?? []);
      if (this.performanceMetricsEnabled) worldStateMs = performance.now() - worldStartedAt;
    }

    const interpolationStartedAt = this.performanceMetricsEnabled ? performance.now() : 0;
    for (const player of this.ctx.playerManager.getAllPlayers()) {
      player.lerpStep(lerpFactor);
      const dashPhase = this.prevDashPhases.get(player.id) ?? 0;
      if (dashPhase !== 0) {
        this.applyDashVisual(player, player.id, dashPhase as 1 | 2);
      } else {
        player.setDashScale(1.0);
      }
    }

    this.ctx.enemyManager?.updateClientInterpolation(lerpFactor);
    // Der Host repliziert absolute Ablaufzeitpunkte, deshalb laeuft der Marker hier auch dann
    // sauber ab, wenn zwischendurch kein Snapshot ankommt.
    const vulnerableNow = bridge.getSynchronizedNow();
    for (const enemy of this.ctx.enemyManager?.getAllEnemies() ?? []) {
      this.enemyDashVisuals.sync(enemy);
      enemy.setVulnerable(this.ctx.targetStatusSystem?.isVulnerable({ targetType: 'enemy', targetId: enemy.id }, vulnerableNow) ?? false);
    }

    this.ctx.decoySystem.updateVisuals(lerpFactor);

    this.ctx.projectileManager.clientExtrapolate();
    this.ctx.stinkCloudSystem.clientUpdate(delta);

    const localId2 = bridge.getLocalPlayerId();
    const localPlayerClient = this.ctx.playerManager.getPlayer(localId2);
    if (localPlayerClient) {
      localPlayerClient.setRotation(this.ctx.inputSystem.getAimAngle());
    }
    const interpolationMs = this.performanceMetricsEnabled ? performance.now() - interpolationStartedAt : 0;

    const hudStartedAt = this.performanceMetricsEnabled ? performance.now() : 0;
    const localState = bridge.getLocalWorldParticipation() === 'interactive'
      ? state.players[localId2]
      : undefined;
    if (localState) {
      this.ctx.aimSystem?.setAuthoritativeState(localState.aim);
      this.ctx.inputSystem.setLocalState(localState.isStunned, localState.isBurrowed, localState.burrowPhase);

      // Movement loop for local player
      const isMovingLocal = localState.aim.isMoving;
      if (isMovingLocal && localState.alive && !localState.isBurrowed && !this.moveLoopHandle) {
        this.moveLoopHandle = this.ctx.gameAudioSystem.startLoop('sfx_player_move') ?? null;
      } else if ((!isMovingLocal || !localState.alive || localState.isBurrowed) && this.moveLoopHandle) {
        this.ctx.gameAudioSystem.stopLoop(this.moveLoopHandle);
        this.moveLoopHandle = null;
      }

      const localUtilityConfig  = this.getLocalUtilityConfig();
      const localUltimateConfig = this.getLocalUltimateConfig();
      const ultimateThresholds  = this.getLocalUltimateThresholds();
      const overrideId = bridge.getPlayerUtilityOverrideId(localId2);
      const hasUtilityOverride = overrideId !== '' || this.clientUtilityOverride !== null;
      const inspectorUtilityAction = hasUtilityOverride
        ? null
        : this.ctx.inputSystem.getSelectedInspectorUtilityActionForHud();
      const selectedInspectorTool = inspectorUtilityAction ? null : this.getLocalInspectorSelectedTool();
      const currentLoadout = bridge.getPlayerCurrentLoadoutSnapshot(localId2);
      const activeConstructionTool = selectedInspectorTool?.kind === 'construction'
        ? selectedInspectorTool
        : currentLoadout?.coopDefenseClassId === 'inspector_gadachs'
          ? null
          : getActiveConstructionToolRefs(getConstructionAccessContext(
            bridge.getActiveGameMode(),
            currentLoadout,
          ))
            .find((tool) => tool.kind === 'construction') ?? null;
      const inspectorConfig = selectedInspectorTool?.kind === 'utility'
        ? getUtilityConfigForMode(
          selectedInspectorTool.id,
          bridge.getActiveGameMode(),
        )
        : undefined;
      const inspectorConstruction = selectedInspectorTool?.kind === 'construction'
        ? getCoopDefenseConstructionDefinition(selectedInspectorTool.id)
        : undefined;
      // Konstrukte belegen Baukapazitaet (BK) und zeigen ihre Kosten am Namen; reine
      // Utilities kosten nichts ausser ihrem Cooldown.
      const inspectorCapacityCost = activeConstructionTool ? getToolCapacityCost(activeConstructionTool) : 0;
      const baseUtilityId = inspectorUtilityAction
        ? undefined
        : overrideId
          || this.clientUtilityOverride?.id
          || (inspectorConstruction ? `construction.${inspectorConstruction.id}` : undefined)
          || inspectorConfig?.id
          || localUtilityConfig.id;
      const activePowerUps = bridge.getPlayerActiveBuffs(localId2).map((buff) => ({
        ...buff,
        valueText: getHudBuffValueText(buff, getLocale()),
      }));
      const hudData = buildLocalArenaHudData({
        hp:                      localState.hp,
        maxHp:                   localState.maxHp,
        armor:                   localState.armor,
        maxArmor:                this.getLocalMaxArmor(),
        adrenaline:              this.getLocalAdrenaline(),
        maxAdrenaline:           this.getLocalMaxAdrenaline(),
        rage:                    localState.rage,
        maxRage:                 this.getLocalMaxRage(),
        isUltimateActive:        localState.isRaging,
        ultimateRequiredRage:    localUltimateConfig.rageRequired,
        ultimateThresholds,
        ultimateId:              localUltimateConfig.id,
        weapon1CooldownFrac:     this.getClientWeaponCooldownFrac('weapon1'),
        weapon2CooldownFrac:     this.getClientWeaponCooldownFrac('weapon2'),
        utilityCooldownFrac:     this.getLocalUtilityCooldownFrac(),
        utilityId:               baseUtilityId,
        utilityAction:            inspectorUtilityAction ?? undefined,
        utilityCapacityCost:     inspectorCapacityCost,
        adrenalineSyringeActive: bridge.getPlayerAdrSyringeActive(localId2),
        isUtilityOverridden:     overrideId !== '' || this.clientUtilityOverride !== null,
        activePowerUps,
        shieldBuff:              bridge.getPlayerShieldBuffHud(localId2),
        weapon2AdrenalineCost:   this.getLocalWeaponAdrenalineCost('weapon2'),
        constructionCapacityUsed: this.ctx.placementSystem?.getUsedCapacity(localId2) ?? 0,
        constructionCapacityMax:  getActiveConstructionToolRefs(
          getConstructionAccessContext(
            bridge.getActiveGameMode(),
            currentLoadout,
          ),
        ).length > 0
          ? this.getLocalConstructionCapacity()
          : 0,
      });
      this.localPlayerState.alive    = localState.alive;
      this.localPlayerState.burrowed = localState.isBurrowed;
      this.ctx.leftPanel.updateArenaHUD(hudData);
      this.ctx.centerHUD.updateBottomStatus(
        hudData,
        this.ctx.inputSystem.isUtilityHudDisplayActive(),
      );
      this.ctx.playerStatusRing?.update(hudData);
    }
    const hudMs = this.performanceMetricsEnabled ? performance.now() - hudStartedAt : 0;

    const postSyncStartedAt = this.performanceMetricsEnabled ? performance.now() : 0;
    if (state.projectiles.some(p => p.style === 'bfg')) {
      this.ctx.visualFeedback.camera.request(bfgFlightRumble());
    }
    const postSyncMs = this.performanceMetricsEnabled ? performance.now() - postSyncStartedAt : 0;
    if (this.performanceMetricsEnabled) {
      this.lastPerformance = {
        totalMs: performance.now() - startedAt,
        snapshotMs,
        playersMs,
        projectilesEffectsMs,
        worldStateMs,
        interpolationMs,
        hudMs,
        postSyncMs,
        newSnapshot: isNewData,
      };
    } else if (this.coarsePerformanceMetricsEnabled) {
      this.lastPerformance = {
        totalMs: performance.now() - startedAt,
        snapshotMs: 0,
        playersMs: 0,
        projectilesEffectsMs: 0,
        worldStateMs: 0,
        interpolationMs: 0,
        hudMs: 0,
        postSyncMs: 0,
        newSnapshot: isNewData,
      };
    }
  }

  getPerformanceMetrics(): ClientUpdatePerformanceMetrics {
    return this.lastPerformance;
  }

  /**
   * Called from the input listener in ArenaScene when the local player fires.
   * A rejected local cooldown attempt is deliberately distinct from a predicted fire.
   */
  notifyLoadoutFired(slot: WeaponSlot, angle: number, targetX: number, targetY: number): LocalWeaponPredictionResult {
    if (slot !== 'weapon1' && slot !== 'weapon2') return { fired: false };
    const now = Date.now();
    const lastFired = this.weaponLastFired[slot];
    const wepConfig = this.getLocalWeaponConfig(slot);
    if (lastFired > 0 && now - lastFired < wepConfig.cooldown) return { fired: false };

    this.ensureCurrentPredictionWorld();
    this.ctx.aimSystem?.notifyShot(slot);
    const shotId = this.playPredictedLocalHitscanTracer(slot, angle, targetX, targetY);
    if (shotId === undefined && !bridge.isHost()) {
      // Projektil-Waffen: Audio sofort lokal abspielen (Prediction). Melee wird hier NICHT
      // behandelt – der Swing-RPC übernimmt das Audio.
      const config = this.getLocalWeaponConfig(slot);
      const fireType = config.fire.type;
      if (fireType === 'projectile' || fireType === 'flamethrower') {
        const localId = bridge.getLocalPlayerId();
        const localState = bridge.getLatestGameState()?.players[localId];
        const isDashing = (localState?.dashPhase ?? 0) === 1;
        const hasAdrenaline = this.getLocalAdrenaline() >= this.getLocalWeaponAdrenalineCost(slot);
        if (!isDashing && hasAdrenaline) {
          this.ctx.effectSystem.playLocalShotAudio(config.shotAudio?.successKey);
        }
      }
    }

    const predictionId = slot === 'weapon2' ? this.nextPredictionId++ : undefined;
    this.localFirePredictions[slot].push({
      worldRevision: this.getPredictionWorldRevision(),
      predictionId,
      firedAt: now,
      status: 'pending',
    });
    this.weaponLastFired[slot] = now;
    this.ctx.leftPanel.flashSlot(slot);
    return predictionId === undefined
      ? { fired: true, predictionId: 0, shotId }
      : { fired: true, predictionId, shotId };
  }

  rollbackRejectedLoadoutFire(slot: WeaponSlot, predictionId?: number): void {
    if (slot !== 'weapon1' && slot !== 'weapon2') return;
    const predictions = this.localFirePredictions[slot];
    const candidate = predictionId === undefined
      ? [...predictions].reverse().find((prediction) => prediction.status === 'pending')
      : predictions.find((prediction) => prediction.predictionId === predictionId);
    if (candidate) candidate.status = 'rejected';
    this.recomputeWeaponLastFired(slot);
  }

  private recomputeWeaponLastFired(slot: 'weapon1' | 'weapon2'): void {
    const latest = [...this.localFirePredictions[slot]]
      .reverse()
      .find((prediction) => prediction.status !== 'rejected');
    this.weaponLastFired[slot] = latest?.firedAt ?? 0;
  }

  notifyUtilityFired(): void {
    // The host clears the descriptor only after the use is accepted. This keeps every temporary
    // utility, including mission placement rewards, authoritative across rejected uses.
    this.ctx.leftPanel.flashSlot('utility');
  }

  /** Update burrow phase for a player (called from RpcCoordinator).
   *  Also handles the sfx_burrowed loop so the transition is not missed
   *  when the RPC pre-updates prevBurrowPhases before applyBurrowVisual runs. */
  setBurrowPhase(playerId: string, phase: BurrowPhase): void {
    const previousPhase = this.prevBurrowPhases.get(playerId) ?? 'idle';

    if (phase === 'underground' && previousPhase !== 'underground') {
      const player = this.ctx.playerManager.getPlayer(playerId);
      if (player) {
        const handle = this.ctx.gameAudioSystem.startLoop('sfx_burrowed', player.x, player.y, playerId);
        if (handle) this.burrowLoopHandles.set(playerId, handle);
      }
    } else if (phase !== 'underground' && previousPhase === 'underground') {
      const handle = this.burrowLoopHandles.get(playerId);
      if (handle) { this.ctx.gameAudioSystem.stopLoop(handle); this.burrowLoopHandles.delete(playerId); }
    }

    this.prevBurrowPhases.set(playerId, phase);
  }

  removePlayerState(playerId: string): void {
    const burrowLoop = this.burrowLoopHandles.get(playerId);
    if (burrowLoop) this.ctx.gameAudioSystem.stopLoop(burrowLoop);
    this.burrowLoopHandles.delete(playerId);
    this.prevBurrowPhases.delete(playerId);
    this.prevAliveStates.delete(playerId);
    this.prevDashPhases.delete(playerId);
    this.prevStealthStates.delete(playerId);
    this.dashPhase2StartTimes.delete(playerId);
    this.dashTrailTimers.delete(playerId);
    if (playerId !== bridge.getLocalPlayerId()) return;

    if (this.moveLoopHandle) this.ctx.gameAudioSystem.stopLoop(this.moveLoopHandle);
    this.moveLoopHandle = null;
    this.weaponLastFired = { weapon1: 0, weapon2: 0 };
    for (const pending of this.pendingAdrenalineSpends.values()) this.removePendingWeapon2Prediction(pending);
    this.localFirePredictions.weapon1.length = 0;
    this.localFirePredictions.weapon2.length = 0;
    this.authoritativeAdrenaline = null;
    this.nextPredictionId = 1;
    this.pickupCooldownUntil = 0;
    this.pendingPickupUids.clear();
    this.committedSelectionCache = null;
    this.clientUtilityOverride = null;
    this.inspectorSelectedTool = null;
    this.localPlayerState.alive = false;
    this.localPlayerState.burrowed = false;
  }

  weaponLastFiredRecord(): Record<'weapon1' | 'weapon2', number> {
    return this.weaponLastFired;
  }

  getLocalWeaponConfig(slot: WeaponSlot): WeaponConfig {
    const localId = bridge.getLocalPlayerId();
    const equipped = this.ctx.loadoutManager?.getEquippedWeaponConfig(localId, slot);
    if (equipped) return equipped;
    const selection = this.resolveCommittedLoadoutSelection(localId);
    return selection[slot] ?? (slot === 'weapon1' ? WEAPON_CONFIGS.GLOCK : WEAPON_CONFIGS.P90);
  }

  getLocalUtilityConfig(): UtilityConfig {
    const localId = bridge.getLocalPlayerId();
    if (this.clientUtilityOverride) {
      return applyCoopDefenseModifiersToUtilityConfig(this.clientUtilityOverride, this.getLocalEffectTotals());
    }
    const equipped = this.ctx.loadoutManager?.getEquippedUtilityConfig(localId);
    if (bridge.getPlayerUtilityOverrideId(localId) && equipped) return equipped;
    const inspectorConfig = this.getLocalInspectorUtilityConfig();
    if (inspectorConfig) return inspectorConfig;
    if (equipped) return equipped;
    const selection = this.resolveCommittedLoadoutSelection(localId);
    return selection.utility ?? UTILITY_CONFIGS.HE_GRENADE;
  }

  getLocalUltimateConfig() {
    const localId = bridge.getLocalPlayerId();
    const equipped = this.ctx.loadoutManager?.getEquippedUltimateConfig(localId);
    if (equipped) return equipped;
    const selection = this.resolveCommittedLoadoutSelection(localId);
    return selection.ultimate ?? ULTIMATE_CONFIGS.HONEY_BADGER_RAGE;
  }

  getLocalUltimateThresholds(): number[] {
    const localId = bridge.getLocalPlayerId();
    const fromManager = this.ctx.loadoutManager?.getUltimateThresholds(localId);
    if (fromManager && fromManager.length > 0) return fromManager;
    const config = this.getLocalUltimateConfig();
    if (config.type === 'gauss') {
      const thresholds: number[] = [];
      const maxRage = this.getLocalMaxRage();
      for (let value = config.rageCost; value < maxRage; value += config.rageCost) {
        thresholds.push(value);
      }
      return thresholds;
    }
    return [config.rageRequired];
  }

  getLocalMaxAdrenaline(): number {
    return this.getResolvedLocalPlayerStat('player.maxAdrenaline', 100);
  }

  getLocalMaxArmor(): number {
    return this.getResolvedLocalPlayerStat('player.maxArmor', 100);
  }

  getLocalMaxRage(): number {
    return this.getResolvedLocalPlayerStat('ultimate.maxRage', 600);
  }

  getLocalRage(): number {
    const localId = bridge.getLocalPlayerId();
    return bridge.getLatestGameState()?.players[localId]?.rage ?? 0;
  }

  getLocalAdrenaline(): number {
    const localId = bridge.getLocalPlayerId();
    if (bridge.isHost() && this.ctx.resourceSystem) {
      return this.ctx.resourceSystem.getAdrenaline(localId);
    }
    this.ensureCurrentPredictionWorld();
    this.reconcileAuthoritativeAdrenalineFromSnapshot();
    const baseline = this.authoritativeAdrenaline;
    if (!baseline) return 0;
    let pending = 0;
    for (const reservation of this.pendingAdrenalineSpends.values()) {
      if (reservation.worldRevision === baseline.worldRevision && reservation.status !== 'acknowledged') {
        pending += reservation.amount;
      }
    }
    return Math.max(0, baseline.value - pending);
  }

  getLocalWeaponAdrenalineCost(slot: 'weapon1' | 'weapon2' = 'weapon2'): number {
    const config = this.getLocalWeaponConfig(slot);
    if (slot === 'weapon2' && this.isLocalAk47FireSuperiorityAvailable()) return 0;
    const multiplier = 1 + (this.getLocalEffectTotals().percentage['player.adrenalineCost'] ?? 0);
    return resolveEffectiveAdrenalineCost(config.adrenalinCost ?? 0, multiplier);
  }

  beginPredictedWeapon2Use(
    predictionId: number,
    request: PredictedWeapon2Request,
    amount: number,
    onReject: (result: LoadoutUseResult) => void,
  ): void {
    if (bridge.isHost() || amount < 0) return;
    const worldRevision = this.getPredictionWorldRevision();
    const pending: PendingWeapon2Prediction = {
      worldRevision,
      predictionId,
      amount,
      request: {
        ...request,
        params: request.params ? { ...request.params } : undefined,
      },
      status: 'pending',
      retryInFlight: false,
      retryTimer: null,
      retryDelayMs: 250,
      onReject,
    };
    this.pendingAdrenalineSpends.set(predictionId, pending);
    void this.sendPendingWeapon2Prediction(pending, false, onReject);
  }

  /** Wird nach einer Resume-Meldung aufgerufen; ACK-abgedeckte IDs werden nicht erneut gesendet. */
  retryUnresolvedWeapon2Predictions(): void {
    this.reconcileAuthoritativeAdrenalineFromSnapshot();
    const worldRevision = this.getCurrentSnapshotWorldRevision();
    const ack = this.authoritativeAdrenaline?.worldRevision === worldRevision
      ? this.authoritativeAdrenaline.weapon2PredictionAck
      : 0;
    for (const pending of [...this.pendingAdrenalineSpends.values()]) {
      if (pending.worldRevision !== worldRevision) {
        this.removePendingWeapon2Prediction(pending);
        continue;
      }
      if (pending.predictionId <= ack) {
        this.acknowledgePendingPrediction(pending);
        continue;
      }
      if (pending.retryTimer !== null) {
        clearTimeout(pending.retryTimer);
        pending.retryTimer = null;
      }
      void this.sendPendingWeapon2Prediction(pending, true);
    }
  }

  private sendPendingWeapon2Prediction(
    pending: PendingWeapon2Prediction,
    isRetry: boolean,
    onReject?: (result: LoadoutUseResult) => void,
  ): Promise<void> {
    if (pending.retryInFlight || this.pendingAdrenalineSpends.get(pending.predictionId) !== pending) {
      return Promise.resolve();
    }
    if (this.getPredictionWorldRevision() !== pending.worldRevision) {
      this.removePendingWeapon2Prediction(pending);
      return Promise.resolve();
    }
    this.reconcileAuthoritativeAdrenalineFromSnapshot();
    if (this.authoritativeAdrenaline?.worldRevision === pending.worldRevision
      && pending.predictionId <= this.authoritativeAdrenaline.weapon2PredictionAck) {
      this.acknowledgePendingPrediction(pending);
      return Promise.resolve();
    }

    pending.retryInFlight = true;
    if (isRetry) pending.status = 'uncertain';
    const request = pending.request;
    return bridge.sendLoadoutUse(
      'weapon2',
      request.angle,
      request.targetX,
      request.targetY,
      request.shotId,
      request.params,
      request.clientX,
      request.clientY,
      request.clientNow,
      true,
      pending.predictionId,
    ).then((result) => {
      if (result) this.resolvePredictedWeapon2Use(pending.worldRevision, pending.predictionId, result, onReject ?? pending.onReject);
      else this.markPredictedWeapon2Timeout(pending);
    }).catch(() => {
      this.markPredictedWeapon2Timeout(pending);
    }).finally(() => {
      pending.retryInFlight = false;
    });
  }

  private markPredictedWeapon2Timeout(pending: PendingWeapon2Prediction): void {
    if (this.pendingAdrenalineSpends.get(pending.predictionId) !== pending) return;
    pending.status = 'uncertain';
    if (pending.retryTimer !== null) clearTimeout(pending.retryTimer);
    const delay = pending.retryDelayMs;
    pending.retryDelayMs = Math.min(1_000, delay * 2);
    pending.retryTimer = setTimeout(() => {
      pending.retryTimer = null;
      void this.sendPendingWeapon2Prediction(pending, true);
    }, delay);
  }

  private resolvePredictedWeapon2Use(
    worldRevision: number,
    predictionId: number,
    result: LoadoutUseResult,
    onReject?: (result: LoadoutUseResult) => void,
  ): void {
    if (this.getPredictionWorldRevision() !== worldRevision) return;
    if (result.worldRevision !== undefined && result.worldRevision !== worldRevision) return;
    this.applyAuthoritativeAdrenalineResult(result, worldRevision);
    const prediction = this.localFirePredictions.weapon2.find((entry) => (
      entry.worldRevision === worldRevision && entry.predictionId === predictionId
    ));
    if (result.ok) {
      if (prediction) prediction.status = 'accepted';
    } else {
      if (prediction) prediction.status = 'rejected';
      this.recomputeWeaponLastFired('weapon2');
      onReject?.(result);
    }
    const pending = this.pendingAdrenalineSpends.get(predictionId);
    if (pending) this.acknowledgePendingPrediction(pending);
  }

  private reconcileAuthoritativeAdrenalineFromSnapshot(): void {
    const state = bridge.getLatestGameState();
    const localId = bridge.getLocalPlayerId();
    const player = state?.players[localId];
    if (!state || !player) return;
    const bridgeWorldRevision = (bridge as unknown as {
      getCurrentWorldRevision?: () => number | null;
    }).getCurrentWorldRevision?.();
    // During a World transition the bridge may still expose the previous cached snapshot. It is
    // not a valid baseline for the new World and therefore must not reinitialize old state.
    if (bridgeWorldRevision !== null && bridgeWorldRevision !== undefined
      && state.worldRevision !== bridgeWorldRevision) return;
    const incomingWorldRevision = state.worldRevision
      ?? bridgeWorldRevision
      ?? 0;
    if (!Number.isSafeInteger(incomingWorldRevision)) return;
    const incomingRevision = Number.isSafeInteger(player.adrenalineRevision)
      ? player.adrenalineRevision!
      : 0;
    const incomingAck = Number.isSafeInteger(player.weapon2PredictionAck)
      ? player.weapon2PredictionAck!
      : 0;
    const current = this.authoritativeAdrenaline;
    if (current && incomingWorldRevision < current.worldRevision) return;
    if (!current) {
      this.authoritativeAdrenaline = {
        worldRevision: incomingWorldRevision,
        value: player.adrenaline,
        revision: incomingRevision,
        weapon2PredictionAck: incomingAck,
      };
    } else if (incomingWorldRevision > current.worldRevision) {
      this.resetPredictionStateForWorld(incomingWorldRevision);
      this.authoritativeAdrenaline = {
        worldRevision: incomingWorldRevision,
        value: player.adrenaline,
        revision: incomingRevision,
        weapon2PredictionAck: incomingAck,
      };
    } else {
      if (incomingRevision > current.revision) {
        current.value = player.adrenaline;
        current.revision = incomingRevision;
      }
      current.weapon2PredictionAck = Math.max(current.weapon2PredictionAck, incomingAck);
    }
    this.resolvePendingPredictionsThroughAck();
  }

  private applyAuthoritativeAdrenalineResult(result: LoadoutUseResult, fallbackWorldRevision: number): void {
    const worldRevision = result.worldRevision ?? fallbackWorldRevision;
    if (this.getPredictionWorldRevision() !== worldRevision) return;
    const current = this.authoritativeAdrenaline;
    if (result.authoritativeAdrenaline === undefined && result.adrenalineRevision === undefined
      && result.weapon2PredictionAck === undefined) return;
    if (!current || current.worldRevision < worldRevision) {
      this.authoritativeAdrenaline = {
        worldRevision,
        value: result.authoritativeAdrenaline ?? 0,
        revision: result.adrenalineRevision ?? 0,
        weapon2PredictionAck: result.weapon2PredictionAck ?? 0,
      };
    } else if (current.worldRevision === worldRevision) {
      if ((result.adrenalineRevision ?? -1) > current.revision) {
        current.value = result.authoritativeAdrenaline ?? current.value;
        current.revision = result.adrenalineRevision!;
      }
      if (result.weapon2PredictionAck !== undefined) {
        current.weapon2PredictionAck = Math.max(current.weapon2PredictionAck, result.weapon2PredictionAck);
      }
    }
    this.resolvePendingPredictionsThroughAck();
  }

  private resolvePendingPredictionsThroughAck(): void {
    const ack = this.authoritativeAdrenaline?.weapon2PredictionAck ?? 0;
    for (const pending of [...this.pendingAdrenalineSpends.values()]) {
      if (pending.worldRevision === this.authoritativeAdrenaline?.worldRevision
        && pending.predictionId <= ack) {
        this.acknowledgePendingPrediction(pending);
      }
    }
  }

  private acknowledgePendingPrediction(pending: PendingWeapon2Prediction): void {
    if (pending.retryTimer !== null) clearTimeout(pending.retryTimer);
    pending.retryTimer = null;
    pending.status = 'acknowledged';
    pending.retryInFlight = false;
    this.pendingAdrenalineSpends.delete(pending.predictionId);
    const prediction = this.localFirePredictions.weapon2.find((entry) => (
      entry.worldRevision === pending.worldRevision && entry.predictionId === pending.predictionId
    ));
    if (prediction && prediction.status === 'pending') prediction.status = 'processed';
  }

  private removePendingWeapon2Prediction(pending: PendingWeapon2Prediction): void {
    if (pending.retryTimer !== null) clearTimeout(pending.retryTimer);
    pending.retryTimer = null;
    pending.retryInFlight = false;
    this.pendingAdrenalineSpends.delete(pending.predictionId);
  }

  private resetPredictionStateForWorld(worldRevision: number): void {
    for (const pending of this.pendingAdrenalineSpends.values()) this.removePendingWeapon2Prediction(pending);
    this.localFirePredictions.weapon1.length = 0;
    this.localFirePredictions.weapon2.length = 0;
    this.weaponLastFired = { weapon1: 0, weapon2: 0 };
    this.nextPredictionId = 1;
    this.authoritativeAdrenaline = null;
    void worldRevision;
  }

  private getCurrentSnapshotWorldRevision(): number {
    const bridgeWorldRevision = (bridge as unknown as {
      getCurrentWorldRevision?: () => number | null;
    }).getCurrentWorldRevision?.();
    return bridgeWorldRevision
      ?? bridge.getLatestGameState()?.worldRevision
      ?? this.authoritativeAdrenaline?.worldRevision
      ?? 0;
  }

  private getPredictionWorldRevision(): number {
    return this.getCurrentSnapshotWorldRevision();
  }

  private ensureCurrentPredictionWorld(): void {
    const worldRevision = this.getPredictionWorldRevision();
    if (this.authoritativeAdrenaline && this.authoritativeAdrenaline.worldRevision !== worldRevision) {
      this.resetPredictionStateForWorld(worldRevision);
      return;
    }
    for (const pending of [...this.pendingAdrenalineSpends.values()]) {
      if (pending.worldRevision !== worldRevision) this.removePendingWeapon2Prediction(pending);
    }
  }

  getLocalUtilityCooldownFrac(): number {
    const localId = bridge.getLocalPlayerId();
    const hasOverride = bridge.getPlayerUtilityOverrideId(localId) !== '' || this.clientUtilityOverride !== null;
    if (!hasOverride && this.ctx.inputSystem.getSelectedInspectorUtilityActionForHud() !== null) return 0;
    const selected = this.getLocalInspectorSelectedTool();
    const config = this.getLocalUtilityConfig();
    // Konstruktionen und Utilities laufen ueber denselben Cooldown-Kanal; nur die
    // Bezugsdauer unterscheidet sich.
    const isConstruction = selected?.kind === 'construction' && !hasOverride;
    const itemId = isConstruction ? selected.id : config.id;
    const cooldown = isConstruction
      ? getCoopDefenseConstructionDefinition(selected.id).buildCooldownMs
      : config.cooldown;
    if (cooldown <= 0) return 0;
    const remaining = bridge.getPlayerUtilityCooldownUntil(localId, itemId) - bridge.getSynchronizedNow();
    return remaining <= 0 ? 0 : Math.min(1, remaining / cooldown);
  }

  /**
   * Delegiert an dieselbe reine Funktion wie der Host, damit die HUD-Maxima die
   * Klassenmultiplikatoren nicht unterschlagen.
   */
  private getResolvedLocalPlayerStat(stat: string, baseValue: number): number {
    return resolveCoopDefenseStat(
      this.getLocalEffectTotals(),
      this.getLocalCoopDefenseClassId(),
      stat,
      baseValue,
    );
  }

  /**
   * Derselbe Einstiegspunkt wie auf dem Host, damit HUD und Host nicht unterschiedliche
   * Teilmengen aus Upgrades und Ausruestung kombinieren. Die Memoisierung liegt in
   * {@link getCoopDefenseCommittedEffectTotals} und greift ueber die Referenzen, die die
   * Fallbacks unten stabil halten.
   */
  private getLocalEffectTotals() {
    if (!isCoopDefenseMode(bridge.getActiveGameMode())) return EMPTY_EFFECT_TOTALS;
    const profile = this.getLocalCoopDefenseProfile();
    const items = this.getLocalCoopDefenseItems();
    if (!profile && items.length === 0) return EMPTY_EFFECT_TOTALS;
    return getCoopDefenseCommittedEffectTotals(profile ?? null, this.getLocalCoopDefenseClassId(), items);
  }

  /**
   * Muss denselben Wert liefern wie das Host-Gate in
   * `ArenaLifecycleCoordinator.getConstructionCapacity`, sonst zeigt die Bauvorschau Plaetze an,
   * die der Host anschliessend ablehnt. Das `CoopDefensePlayerModifierSystem` ist auf dem Client
   * nicht verfuegbar, deshalb laeuft es hier ueber dieselben Effekt-Summen.
   */
  getLocalConstructionCapacity(): number {
    const localId = bridge.getLocalPlayerId();
    const currentLoadout = bridge.getPlayerCurrentLoadoutSnapshot(localId);
    return resolveConstructionCapacity({
      gameMode: bridge.getActiveGameMode(),
      classId: currentLoadout?.coopDefenseClassId ?? this.getLocalCoopDefenseClassId(),
      modifiers: this.getLocalEffectTotals().additive[COOP_DEFENSE_CONSTRUCTION_CAPACITY_STAT] ?? 0,
    });
  }

  /** Liest den aktuellen Build; Commit und Lobby-Projektion bleiben getrennte Quellen. */
  private getLocalCoopDefenseProfile() {
    const localId = bridge.getLocalPlayerId();
    if (!isCoopDefenseMode(bridge.getActiveGameMode())) return null;
    if (bridge.getActivityDescriptor() !== null) {
      return bridge.getPlayerCommittedLoadout(localId)?.coopDefenseProfile ?? this.storedProfileFallback;
    }
    const preview = bridge.getPlayerLobbyLoadoutPreview(localId);
    if (preview) return preview.coopDefenseProfile;
    return this.storedProfileFallback;
  }

  /**
   * Ausruestung des lokalen Spielers. Der Fallback greift wie beim Profil nur, solange der
   * Commit-Snapshot noch nicht angekommen ist – sonst zeigte die HUD waehrend des Countdowns
   * kurzzeitig zu niedrige Maxima. Die Referenz wird gehalten, damit der Totals-Cache greift.
   */
  private getLocalCoopDefenseItems(): readonly CoopDefenseItem[] {
    if (!isCoopDefenseMode(bridge.getActiveGameMode())) return [];
    const localId = bridge.getLocalPlayerId();
    if (bridge.getActivityDescriptor() !== null) {
      return bridge.getPlayerCommittedLoadout(localId)?.equippedItems ?? this.storedItemsFallback ?? [];
    }
    const preview = bridge.getPlayerLobbyLoadoutPreview(localId);
    if (preview) return preview.equippedItems ?? [];
    return this.storedItemsFallback ?? [];
  }

  getLocalInspectorTools(): readonly LoadoutToolRef[] {
    const localId = bridge.getLocalPlayerId();
    const classId = this.getLocalCoopDefenseClassId();
    if (classId !== 'inspector_gadachs') return [];
    const current = bridge.getActivityDescriptor() !== null
      ? bridge.getPlayerCurrentLoadoutSnapshot(localId)
      : bridge.getPlayerLobbyLoadoutPreview(localId);
    return current?.tools ?? this.getLocalCoopDefenseProfile()?.toolLoadout ?? [];
  }

  getLocalInspectorSelectedTool(): LoadoutToolRef | null {
    const tools = this.getLocalInspectorTools();
    const localId = bridge.getLocalPlayerId();
    const classId = this.getLocalCoopDefenseClassId();
    const current = bridge.getPlayerCurrentLoadoutSnapshot(localId);
    const resolvedLoadout: LoadoutCommitSnapshot | null = current
      ? {
        ...current,
        coopDefenseClassId: classId,
        coopDefenseProfile: this.getLocalCoopDefenseProfile() ?? null,
        tools: [...this.getLocalInspectorTools()],
        equippedItems: current.equippedItems ?? [],
      }
      : null;
    if (classId !== 'inspector_gadachs') {
      return getActiveConstructionToolRefs(
        getConstructionAccessContext(
          bridge.getActiveGameMode(),
          resolvedLoadout,
        ),
      ).find((tool) => tool.kind === 'construction') ?? null;
    }
    if (this.inspectorSelectedTool && tools.some((tool) => (
      tool.kind === this.inspectorSelectedTool?.kind && tool.id === this.inspectorSelectedTool?.id
    ))) return this.inspectorSelectedTool;
    const profileSelected = this.getLocalCoopDefenseProfile()?.selectedTool;
    const selected = profileSelected && tools.some((tool) => tool.kind === profileSelected.kind && tool.id === profileSelected.id)
      ? profileSelected
      : tools[0] ?? null;
    this.inspectorSelectedTool = selected ? { ...selected } : null;
    return this.inspectorSelectedTool;
  }

  setLocalInspectorSelectedTool(tool: LoadoutToolRef): void {
    if (this.getLocalInspectorTools().some((entry) => entry.kind === tool.kind && entry.id === tool.id)) {
      this.inspectorSelectedTool = { ...tool };
      const progress = getStoredCoopDefenseProgress();
      const profile = progress.profilesByClass.inspector_gadachs;
      setStoredCoopDefenseUpgradeProfile({ ...profile, selectedTool: { ...tool } }, 'inspector_gadachs');
      this.refreshStoredProgressFallback();
    }
  }

  getLocalInspectorUtilityConfig(): UtilityConfig | undefined {
    const tool = this.getLocalInspectorSelectedTool();
    if (tool?.kind !== 'utility') return undefined;
    const base = this.clientUtilityOverride ?? getUtilityConfigForMode(
      tool.id,
      bridge.getActiveGameMode(),
    );
    if (!base) return undefined;
    const modified = applyCoopDefenseModifiersToUtilityConfig(base, this.getLocalEffectTotals());
    return modified;
  }

  /** Concrete utility ID used for the host-published cooldown channel. */
  getLocalUtilityCooldownId(): string {
    const localId = bridge.getLocalPlayerId();
    const config = this.getLocalUtilityConfig();
    const hasOverride = bridge.getPlayerUtilityOverrideId(localId) !== '' || this.clientUtilityOverride !== null;
    const selected = this.getLocalInspectorSelectedTool();
    if (selected?.kind === 'construction' && !hasOverride) return selected.id;
    return config.id;
  }

  private getLocalCoopDefenseClassId() {
    const localId = bridge.getLocalPlayerId();
    if (!isCoopDefenseMode(bridge.getActiveGameMode())) return null;
    if (bridge.getActivityDescriptor() !== null) {
      return bridge.getPlayerCommittedLoadout(localId)?.coopDefenseClassId ?? this.storedClassIdFallback;
    }
    const preview = bridge.getPlayerLobbyLoadoutPreview(localId);
    if (preview) return preview.coopDefenseClassId;
    return this.storedClassIdFallback;
  }

  /**
   * Einziger Persistenz-Lesepunkt des Coordinators. Er wird beim Scene-Aufbau und nach dem
   * Lobby-zu-Runde-Uebergang aufgerufen, niemals aus `runClientUpdate()` oder dessen Gettern.
   */
  refreshStoredProgressFallback(): void {
    const progress = getStoredCoopDefenseProgress();
    this.storedProfileFallback = progress.classesUnlocked
      ? progress.profilesByClass[progress.selectedClassId]
      : progress.defaultProfile;
    this.storedClassIdFallback = progress.classesUnlocked ? progress.selectedClassId : null;
    this.storedItemsFallback = getStoredEquippedCoopDefenseItems();
    this.committedSelectionCache = null;
  }

  resetPerRound(): void {
    this.lastGameStateVersion = -1;
    // Zwischen zwei Runden kann das Lobby-Menue den lokalen Spielstand geaendert haben.
    this.refreshStoredProgressFallback();
    this.damagedStaticRockIds.clear();
    this.prevAliveStates.clear();
    this.prevDashPhases.clear();
    this.prevBurrowPhases.clear();
    for (const h of this.burrowLoopHandles.values()) this.ctx.gameAudioSystem.stopLoop(h);
    this.burrowLoopHandles.clear();
    this.prevStealthStates.clear();
    this.dashPhase2StartTimes.clear();
    this.dashTrailTimers.clear();
    this.enemyDashVisuals.reset();
    this.weaponLastFired = { weapon1: 0, weapon2: 0 };
    for (const pending of this.pendingAdrenalineSpends.values()) this.removePendingWeapon2Prediction(pending);
    this.localFirePredictions.weapon1.length = 0;
    this.localFirePredictions.weapon2.length = 0;
    this.authoritativeAdrenaline = null;
    this.nextPredictionId = 1;
    this.nextPredictedHitscanShotId = 1;
    this.pickupCooldownUntil = 0;
    this.pendingPickupUids.clear();
    if (this.moveLoopHandle) { this.ctx.gameAudioSystem.stopLoop(this.moveLoopHandle); this.moveLoopHandle = null; }
    this.clientUtilityOverride = null;
  }

  private applyDashVisual(player: PlayerEntity, id: string, curPhase: 1 | 2): void {
    if (curPhase === 1) {
      player.setDashScale(0.5);
      const now = this.scene.time.now;
      const nextGhost = this.dashTrailTimers.get(id) ?? 0;
      if (now >= nextGhost) {
        this.ctx.effectSystem.playDashTrailGhost(player.x, player.y, player.color, 0.5, player.rotation);
        this.dashTrailTimers.set(id, now + 50);
      }
    } else if (curPhase === 2) {
      const p2Start = this.dashPhase2StartTimes.get(id);
      const t = p2Start !== undefined
        ? Math.min(1, (this.scene.time.now - p2Start) / (DASH_T2_S * 1000))
        : 1;
      player.setDashScale(0.5 + 0.5 * t * t);
    }
  }

  private applyBurrowVisual(player: PlayerEntity, phase: BurrowPhase): void {
    const previousPhase = this.prevBurrowPhases.get(player.id) ?? 'idle';
    const shouldAnimate = previousPhase !== phase
      && ((phase === 'windup' && previousPhase === 'idle')
        || (phase === 'recovery' && (previousPhase === 'underground' || previousPhase === 'trapped')));

    // Burrow loop: start when entering underground, stop when leaving
    if (phase === 'underground' && previousPhase !== 'underground') {
      const handle = this.ctx.gameAudioSystem.startLoop('sfx_burrowed', player.x, player.y, player.id);
      if (handle) this.burrowLoopHandles.set(player.id, handle);
    } else if (phase !== 'underground' && previousPhase === 'underground') {
      const handle = this.burrowLoopHandles.get(player.id);
      if (handle) { this.ctx.gameAudioSystem.stopLoop(handle); this.burrowLoopHandles.delete(player.id); }
    } else if (phase === 'underground') {
      const handle = this.burrowLoopHandles.get(player.id);
      if (handle) this.ctx.gameAudioSystem.updateLoopPosition(handle, player.x, player.y, player.id);
    }

    if (shouldAnimate) {
      this.ctx.effectSystem.playBurrowPhaseEffect(player.x, player.y, phase);
    }
    player.setBurrowPhase(phase, shouldAnimate);
    if (player.displayObject) this.ctx.effectSystem.syncBurrowState(player.id, phase, player.displayObject);
    this.prevBurrowPhases.set(player.id, phase);
  }

  private checkLocalPickup(powerups: SyncedPowerUp[]): void {
    const now = Date.now();
    if (now < this.pickupCooldownUntil) return;

    const localId = bridge.getLocalPlayerId();
    const player  = this.ctx.playerManager.getPlayer(localId);
    if (!player || !player.active) return;
    if (this.ctx.burrowSystem?.isBurrowed(localId)) return;

    const px = player.x;
    const py = player.y;

    for (const pu of powerups) {
      if (pu.pickupKind === 'objective-marker') continue;
      const dist = Math.hypot(pu.x - px, pu.y - py);
      if (dist <= PICKUP_RADIUS * 2) {
        if (bridge.isHost()) {
          this.ctx.powerUpSystem?.tryPickup(localId, pu.uid, px, py);
        } else {
          if (this.pendingPickupUids.has(pu.uid)) continue;
          this.pendingPickupUids.add(pu.uid);
          // The ACK only releases request deduplication. Gameplay state comes exclusively from
          // the authoritative player snapshot/utility descriptor.
          void bridge.sendPickupPowerUp(pu.uid).then(
            () => this.pendingPickupUids.delete(pu.uid),
            () => this.pendingPickupUids.delete(pu.uid),
          );
        }
        this.pickupCooldownUntil = now + 100;
        return;
      }
    }
  }

  private reconcileClientUtilityOverride(): void {
    const localId = bridge.getLocalPlayerId();
    const descriptor = bridge.getPlayerUtilityOverrideDescriptor(localId);
    if (descriptor?.kind === 'utility') {
      const config = getUtilityConfigForMode(
        descriptor.utilityId,
        bridge.getActiveGameMode(),
      );
      this.clientUtilityOverride = config ?? null;
      return;
    }

    if (descriptor?.kind === 'objective-placement') {
      const current = this.clientUtilityOverride;
      if (
        current?.type !== 'placeable_pedestal'
        || current.rewardObjectiveId !== descriptor.objectiveId
        || current.powerUpDefId !== descriptor.powerUpDefId
      ) {
        this.clientUtilityOverride = createCoopDefensePlaceablePedestalUtility(
          descriptor.objectiveId,
          descriptor.powerUpDefId,
        );
      }
      return;
    }

    this.clientUtilityOverride = null;
  }

  private playPredictedLocalHitscanTracer(
    slot: WeaponSlot,
    angle: number,
    targetX: number,
    targetY: number,
  ): number | undefined {
    const config = this.getLocalWeaponConfig(slot);
    if (config.fire.type !== 'hitscan') return undefined;

    const localPlayer = this.ctx.playerManager.getPlayer(bridge.getLocalPlayerId());
    if (!localPlayer) return undefined;

    const shotId = this.nextPredictedHitscanShotId++;
    const desiredGameplayMuzzle = getHeldWeaponGameplayMuzzleOrigin(
      config.id,
      localPlayer.x,
      localPlayer.y,
      angle,
      localPlayer.displayObject?.displayWidth ?? PLAYER_SIZE,
    ) ?? getTopDownMuzzleOrigin(localPlayer.x, localPlayer.y, angle);
    const resolvedStart = this.ctx.combatSystem.resolveSafeHitscanStart(
      localPlayer.x,
      localPlayer.y,
      desiredGameplayMuzzle.x,
      desiredGameplayMuzzle.y,
    );
    const visualMuzzleOrigin = getHeldWeaponMuzzleOrigin(
      config.id,
      localPlayer.x,
      localPlayer.y,
      localPlayer.rotation,
      localPlayer.displayObject?.displayWidth ?? PLAYER_SIZE,
    ) ?? desiredGameplayMuzzle;
    const trace  = this.ctx.combatSystem.traceHitscan({
      shooterId:  bridge.getLocalPlayerId(),
      startX:     resolvedStart.x,
      startY:     resolvedStart.y,
      angle,
      range:      getHitscanRangeToCursor(
        config,
        resolvedStart.x,
        resolvedStart.y,
        angle,
        targetX,
        targetY,
      ),
      traceThickness: config.fire.traceThickness,
      applyFavorTheShooter: bridge.isHost(),
      includeShooter: Boolean(config.fire.supportEffect),
    });

    this.ctx.effectSystem.playPredictedHitscanTracer(
      visualMuzzleOrigin.x,
      visualMuzzleOrigin.y,
      trace.endX,
      trace.endY,
      config.fire.supportEffect?.beamColor ?? localPlayer.color,
      config.fire.traceThickness,
      shotId,
      (trace.hitPlayerId || trace.hitEnemyId || trace.hitDecoyId !== null)
        ? 'player'
        : (trace.hitObstacle ? 'environment' : 'none'),
      config.fire.visualPreset,
      config.shotAudio?.successKey,
    );

    return shotId;
  }

  private isLocalAk47FireSuperiorityAvailable(): boolean {
    const localId = bridge.getLocalPlayerId();
    return this.ctx.loadoutManager?.isAk47FireSuperiorityAvailable(localId)
      ?? (this.getLocalWeaponConfig('weapon2').id === 'AK47'
        && bridge.getPlayerActiveBuffs(localId).some((buff) => (
          buff.defId === 'AK47_FIRE_SUPERIORITY' && (buff.availableCount ?? 0) > 0
        )));
  }

  private getClientWeaponCooldownFrac(slot: 'weapon1' | 'weapon2'): number {
    const lastFired = this.weaponLastFired[slot];
    if (lastFired === 0) return 0;
    const config  = this.getLocalWeaponConfig(slot);
    const elapsed = Date.now() - lastFired;
    if (elapsed >= config.cooldown) return 0;
    return 1 - elapsed / config.cooldown;
  }

  /**
   * Loesst das effektive Loadout auf – memoisiert ueber die Referenz des committed Loadouts.
   *
   * Auf dem Client ist `loadoutManager` null (das Loadout ist host-autoritativ), deshalb faellt
   * *jeder* der `getLocal*Config`-Getter auf diesen Pfad zurueck. Er sanitisiert die Auswahl und
   * rechnet die Coop-Upgrade-Modifikatoren neu durch; ohne Cache lief das mehrfach pro Frame und
   * war auf dem Client ein messbarer Teil des Update-Budgets.
   *
   * Der Cache-Schluessel ist die Objektreferenz des committed Loadouts (plus Spielmodus). Sie
   * wechselt genau dann, wenn ein neuer Snapshot ein anderes Loadout liefert – der Cache kann
   * also nie veralten und braucht keine Frame-Invalidierung.
   */
  private resolveCommittedLoadoutSelection(playerId: string) {
    const committed = bridge.getPlayerCommittedLoadout(playerId);
    if (!committed) return this.resolveLoadoutSelection(playerId);
    const mode = bridge.getActiveGameMode();
    const cached = this.committedSelectionCache;
    if (cached && cached.key === committed && cached.mode === mode && cached.playerId === playerId) {
      return cached.value;
    }
    const value = this.buildCommittedLoadoutSelection(committed, mode);
    this.committedSelectionCache = { key: committed, mode, playerId, value };
    return value;
  }

  private buildCommittedLoadoutSelection(
    committed: NonNullable<ReturnType<typeof bridge.getPlayerCommittedLoadout>>,
    mode: ReturnType<typeof bridge.getGameMode>,
  ) {
    return resolveEffectiveLoadoutSelection({
      weapon1:  WEAPON_CONFIGS[committed.weapon1  as keyof typeof WEAPON_CONFIGS],
      weapon2:  committed.weapon2
        ? WEAPON_CONFIGS[committed.weapon2 as keyof typeof WEAPON_CONFIGS]
        : undefined,
      utility:  UTILITY_CONFIGS[committed.utility as keyof typeof UTILITY_CONFIGS],
      ultimate: ULTIMATE_CONFIGS[committed.ultimate as keyof typeof ULTIMATE_CONFIGS],
    }, mode, committed.coopDefenseProfile, committed.coopDefenseClassId, committed.equippedItems);
  }

  private resolveLoadoutSelection(playerId: string) {
    const isLocalPlayer = playerId === bridge.getLocalPlayerId();
    const preview = bridge.getPlayerLobbyLoadoutPreview(playerId);
    const w1Id = bridge.getPlayerLoadoutSlot(playerId, 'weapon1');
    const w2Id = bridge.getPlayerLoadoutSlot(playerId, 'weapon2');
    const utId = bridge.getPlayerLoadoutSlot(playerId, 'utility');
    const ulId = bridge.getPlayerLoadoutSlot(playerId, 'ultimate');
    return resolveEffectiveLoadoutSelection({
      weapon1:  w1Id ? WEAPON_CONFIGS[w1Id  as keyof typeof WEAPON_CONFIGS]   : undefined,
      weapon2:  w2Id ? WEAPON_CONFIGS[w2Id  as keyof typeof WEAPON_CONFIGS]   : undefined,
      utility:  utId ? UTILITY_CONFIGS[utId as keyof typeof UTILITY_CONFIGS]  : undefined,
      ultimate: ulId ? ULTIMATE_CONFIGS[ulId as keyof typeof ULTIMATE_CONFIGS]: undefined,
    }, bridge.getActiveGameMode(),
    preview?.coopDefenseProfile ?? (isLocalPlayer ? this.storedProfileFallback : null),
    preview?.coopDefenseClassId ?? (isLocalPlayer ? this.storedClassIdFallback : null),
    // Referenzstabil ueber den memoisierten Zugriff, sonst greift der Cache dieser Aufloesung nie.
    preview ? preview.equippedItems : (isLocalPlayer ? this.getLocalCoopDefenseItems() : []));
  }
}
