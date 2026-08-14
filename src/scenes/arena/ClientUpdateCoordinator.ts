import type Phaser from 'phaser';
import { bridge }          from '../../network/bridge';
import { dequantizeAngle } from '../../utils/angle';
import { NET_SMOOTH_TIME_MS, DASH_T2_S, PLAYER_COLORS, getTopDownMuzzleOrigin } from '../../config';
import { isVelocityMoving } from '../../loadout/SpreadMath';
import { getUtilityConfigForMode, WEAPON_CONFIGS, UTILITY_CONFIGS, ULTIMATE_CONFIGS } from '../../loadout/LoadoutConfig';
import { applyCoopDefenseModifiersToUtilityConfig } from '../../loadout/CoopDefenseLoadoutModifiers';
import { createCoopDefensePlaceablePedestalUtility } from '../../loadout/CoopDefenseMissionUtility';
import { resolveEffectiveLoadoutSelection } from '../../loadout/LoadoutRules';
import { getHeldWeaponMuzzleOrigin } from '../../loadout/HeldItemVisuals';
import type { UtilityConfig, WeaponConfig } from '../../loadout/LoadoutConfig';
import { DEFAULT_LOADOUT }   from '../../loadout/LoadoutConfig';
import { buildLocalArenaHudData } from '../../ui/LocalArenaHudData';
import { bfgFlightRumble } from '../../effects/camera/cameraFeedbackPresets';
import type { ArenaContext }     from './ArenaContext';
import type { LocalPlayerState } from './LocalPlayerState';
import type { RockVisualHelper } from './RockVisualHelper';
import type { BurrowPhase, CoopDefenseClassId, CoopDefenseItem, CoopDefenseUpgradeProfile, LoadoutToolRef, SyncedPowerUp, WeaponSlot } from '../../types';
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
import { COOP_DEFENSE_CONSTRUCTION_CAPACITY_STAT, getCoopDefenseConstructionCapacity, getCoopDefenseConstructionDefinition, getToolCapacityCost } from '../../config/coopDefenseConstructions';
import { EnemyDashVisualTracker } from '../../effects/EnemyDashVisuals';

/** Geteilte Leer-Instanz: vermeidet eine Allokation pro Aufruf ohne Coop-Profil. */
const EMPTY_EFFECT_TOTALS = EMPTY_COOP_DEFENSE_EFFECT_TOTALS;

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
  private predictedHitscanCooldownUntil: Record<WeaponSlot, number> = { weapon1: 0, weapon2: 0 };
  private predictedLocalAdrenaline: number | null = null;
  private predictedLocalAdrenalineSnapshot: number | null = null;
  private predictedLocalAdrenalineSnapshotVersion = -1;
  private nextPredictedHitscanShotId = 1;
  private pickupCooldownUntil = 0;
  private moveLoopHandle: string | null = null;
  private readonly pendingPickupUids = new Set<number>();
  private lastPerformance: ClientUpdatePerformanceMetrics = {
    totalMs: 0, snapshotMs: 0, playersMs: 0, projectilesEffectsMs: 0,
    worldStateMs: 0, interpolationMs: 0, hudMs: 0, postSyncMs: 0, newSnapshot: false,
  };

  /** Locally reconstructed utility override from the host-published descriptor. */
  clientUtilityOverride: UtilityConfig | null = null;
  private inspectorSelectedTool: LoadoutToolRef | null = null;

  private readonly enemyDashVisuals: EnemyDashVisualTracker;

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

  runClientUpdate(delta: number): void {
    const startedAt = performance.now();
    this.reconcileClientUtilityOverride();
    // B1's reliable presentation snapshot is independent of the ticked GameState. Sync it first
    // so a dormant structure can materialize even when no base HP delta arrived this frame.
    this.ctx.baseManager?.syncDormantStates();
    const state = bridge.getLatestGameState();
    if (!state) {
      this.lastPerformance = {
        totalMs: performance.now() - startedAt,
        snapshotMs: performance.now() - startedAt,
        playersMs: 0, projectilesEffectsMs: 0, worldStateMs: 0,
        interpolationMs: 0, hudMs: 0, postSyncMs: 0, newSnapshot: false,
      };
      return;
    }

    const lerpFactor = 1 - Math.exp(-delta / NET_SMOOTH_TIME_MS);

    const currentVersion = bridge.getGameStateVersion();
    const isNewData = currentVersion !== this.lastGameStateVersion;
    if (isNewData) this.lastGameStateVersion = currentVersion;
    const snapshotMs = performance.now() - startedAt;
    let playersMs = 0;
    let projectilesEffectsMs = 0;
    let worldStateMs = 0;
    const participationKnown = bridge.getRoundParticipation() !== null;

    // Rollenwechsel und Latejoiner duerfen nicht auf den naechsten Delta-Tick warten. Die
    // Teilnehmerliste ist ein eigener reliable Snapshot; sobald sie bekannt ist, gilt sie als
    // Render-Roster fuer alle PlayerEntities.
    if (participationKnown) {
      for (const player of [...this.ctx.playerManager.getAllPlayers()]) {
        if (bridge.canPlayerSpawnOrRespawn(player.id)) continue;
        this.ctx.effectSystem.clearBurrowState(player.id);
        this.removeBurrowPhase(player.id);
        this.ctx.playerManager.removePlayer(player.id);
      }
    }

    for (const id of Object.keys(state.players)) {
      if (participationKnown && !bridge.canPlayerSpawnOrRespawn(id)) continue;
      if (this.ctx.playerManager.hasPlayer(id)) continue;
      const profile = bridge.getConnectedPlayers().find((p) => p.id === id);
      if (profile) this.ctx.playerManager.addPlayer(profile);
    }

    if (isNewData) {
      const playersStartedAt = performance.now();
      const localId = bridge.getLocalPlayerId();
      for (const [id, ps] of Object.entries(state.players)) {
        if (participationKnown && !bridge.canPlayerSpawnOrRespawn(id)) continue;
        let player = this.ctx.playerManager.getPlayer(id);
        if (!player) {
          const profile = bridge.getConnectedPlayers().find(p => p.id === id);
          if (profile) {
            this.ctx.playerManager.addPlayer(profile);
            player = this.ctx.playerManager.getPlayer(id);
          }
        }
        if (!player) continue;

        const wasAlive = this.prevAliveStates.get(id) ?? false;
        if (ps.alive && !wasAlive) {
          player.sprite.setPosition(ps.x, ps.y);
          this.ctx.gameAudioSystem.playSound('sfx_player_spawn', ps.x, ps.y, id);
        }
        this.prevAliveStates.set(id, ps.alive);

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
          this.ctx.effectSystem.playStealthTransitionEffect(player.sprite.x, player.sprite.y, !isStealthed, player.color);
        }
        player.setDecoyStealth(isStealthed);
        this.prevStealthStates.set(id, isStealthed);
        player.setHeldItemId(bridge.getPlayerHeldItemId(id));

        const curPhase = ps.dashPhase ?? 0;
        if (curPhase === 1 && (this.prevDashPhases.get(id) ?? 0) === 0) {
          this.ctx.gameAudioSystem.playSound('sfx_dash', player.sprite.x, player.sprite.y, id);
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

      playersMs = performance.now() - playersStartedAt;
      const effectsStartedAt = performance.now();
      this.ctx.projectileManager.clientSyncVisuals(state.projectiles, bridge.getLocalPlayerId());
      this.ctx.decoySystem.syncSnapshots(state.decoys ?? []);
      this.ctx.smokeSystem.syncVisuals(state.smokes);
      this.ctx.fireSystem.syncVisuals(state.fires ?? []);
      this.ctx.stinkCloudSystem.syncVisuals(state.stinkClouds ?? []);
      projectilesEffectsMs = performance.now() - effectsStartedAt;

      // teslaDomeRenderer is accessed via the bundle (passed from ArenaScene)
      // → handled by ArenaScene.update() which calls renderers.teslaDome.syncVisuals

      const worldStartedAt = performance.now();
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
        for (const rock of placementChanges.added) {
          this.rockVisualHelper.materializePlaceableRock(rock, true);
        }
        for (const rock of placementChanges.updated) {
          this.rockVisualHelper.materializePlaceableRock(rock, false);
          this.rockVisualHelper.updateRockVisualById(rock.id, rock.hp);
        }
        for (const rock of placementChanges.removed) {
          this.rockVisualHelper.removePlaceableRockVisual(
            rock,
            rock.kind === 'rock' || bridge.getSynchronizedNow() >= rock.expiresAt,
          );
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
      worldStateMs = performance.now() - worldStartedAt;
    }

    const interpolationStartedAt = performance.now();
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
    const interpolationMs = performance.now() - interpolationStartedAt;

    const hudStartedAt = performance.now();
    const localState = state.players[localId2];
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
      const overrideName = bridge.getPlayerUtilityOverrideName(localId2);
      const selectedInspectorTool = this.getLocalInspectorSelectedTool();
      const inspectorConfig = selectedInspectorTool?.kind === 'utility'
        ? getUtilityConfigForMode(selectedInspectorTool.id, bridge.getGameMode())
        : undefined;
      const inspectorConstruction = selectedInspectorTool?.kind === 'construction'
        ? getCoopDefenseConstructionDefinition(selectedInspectorTool.id)
        : undefined;
      // Konstrukte belegen Baukapazitaet (BK) und zeigen ihre Kosten am Namen; reine
      // Utilities kosten nichts ausser ihrem Cooldown.
      const inspectorCapacityCost = selectedInspectorTool ? getToolCapacityCost(selectedInspectorTool) : 0;
      const baseUtilityDisplayName = overrideName
        || this.clientUtilityOverride?.displayName
        || inspectorConstruction?.displayName
        || inspectorConfig?.displayName
        || localUtilityConfig.displayName;
      const utilDisplayName = inspectorCapacityCost > 0 && !overrideName && !this.clientUtilityOverride
        ? `${baseUtilityDisplayName} · ${inspectorCapacityCost} BK`
        : baseUtilityDisplayName;
      const activePowerUps = bridge.getPlayerActiveBuffs(localId2);
      const localWeapon2Config = this.getLocalWeaponConfig('weapon2');
      const fireSuperiorityAvailable = localWeapon2Config.id === 'AK47'
        && activePowerUps.some((buff) => (
          buff.defId === 'AK47_FIRE_SUPERIORITY' && !buff.valueText?.startsWith('0 ')
        ));
      const hudData = buildLocalArenaHudData({
        hp:                      localState.hp,
        maxHp:                   localState.maxHp,
        armor:                   localState.armor,
        maxArmor:                this.getLocalMaxArmor(),
        adrenaline:              localState.adrenaline,
        maxAdrenaline:           this.getLocalMaxAdrenaline(),
        rage:                    localState.rage,
        maxRage:                 this.getLocalMaxRage(),
        isUltimateActive:        localState.isRaging,
        ultimateRequiredRage:    localUltimateConfig.rageRequired,
        ultimateThresholds,
        ultimateDisplayName:     localUltimateConfig.displayName,
        weapon1CooldownFrac:     this.getClientWeaponCooldownFrac('weapon1'),
        weapon2CooldownFrac:     this.getClientWeaponCooldownFrac('weapon2'),
        utilityCooldownFrac:     this.getLocalUtilityCooldownFrac(),
        utilityDisplayName:      utilDisplayName,
        adrenalineSyringeActive: bridge.getPlayerAdrSyringeActive(localId2),
        isUtilityOverridden:     overrideName !== '' || this.clientUtilityOverride !== null,
        activePowerUps,
        shieldBuff:              bridge.getPlayerShieldBuffHud(localId2),
        weapon2AdrenalineCost:   fireSuperiorityAvailable ? 0 : (localWeapon2Config.adrenalinCost ?? 0),
        constructionCapacityUsed: this.ctx.placementSystem?.getUsedCapacity(localId2) ?? 0,
        constructionCapacityMax:  bridge.getPlayerCommittedLoadout(localId2)?.coopDefenseClassId === 'inspector_gadachs'
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
    const hudMs = performance.now() - hudStartedAt;

    const postSyncStartedAt = performance.now();
    if (state.projectiles.some(p => p.style === 'bfg')) {
      this.ctx.visualFeedback.camera.request(bfgFlightRumble());
    }
    const postSyncMs = performance.now() - postSyncStartedAt;
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
  }

  getPerformanceMetrics(): ClientUpdatePerformanceMetrics {
    return this.lastPerformance;
  }

  /**
   * Called from the input listener in ArenaScene when the local player fires.
   * Returns the shotId for hitscan traces (undefined for non-hitscan weapons).
   */
  notifyLoadoutFired(slot: WeaponSlot, angle: number, targetX: number, targetY: number): number | undefined {
    void targetX;
    void targetY;

    if (slot !== 'weapon1' && slot !== 'weapon2') return undefined;
    if (bridge.getGamePhase() === 'ARENA' && !bridge.canPlayerAct(bridge.getLocalPlayerId())) return undefined;

    const now = Date.now();
    const lastFired = this.weaponLastFired[slot];
    const wepConfig = this.getLocalWeaponConfig(slot);
    if (lastFired > 0 && now - lastFired < wepConfig.cooldown) return undefined; // still on cooldown

    this.ctx.aimSystem?.notifyShot(slot);
    const shotId = this.playPredictedLocalHitscanTracer(slot, angle);
    if (shotId === undefined && !bridge.isHost()) {
      // Projektil-Waffen: Audio sofort lokal abspielen (Prediction),
      // da spawnProjectile nur auf dem Host läuft und Network-Jitter sonst
      // unregelmäßige Abstände verursacht.
      // Melee wird hier NICHT behandelt – der Swing-RPC übernimmt das Audio.
      const config = this.getLocalWeaponConfig(slot);
      const fireType = config.fire.type;
      if (fireType === 'projectile' || fireType === 'flamethrower') {
        const localId    = bridge.getLocalPlayerId();
        const localState = bridge.getLatestGameState()?.players[localId];
        const isDashing  = (localState?.dashPhase ?? 0) === 1;
        const adrenaline = localState?.adrenaline ?? 0;
        const hasAdrenaline = (config.adrenalinCost ?? 0) <= adrenaline;
        if (!isDashing && hasAdrenaline) {
          this.ctx.effectSystem.playLocalShotAudio(config.shotAudio?.successKey);
        }
      }
    }
    this.weaponLastFired[slot] = now;
    this.ctx.leftPanel.flashSlot(slot);
    return shotId;
  }

  rollbackRejectedLoadoutFire(slot: WeaponSlot): void {
    this.weaponLastFired[slot] = 0;
    this.predictedHitscanCooldownUntil[slot] = 0;
  }

  notifyUtilityFired(): void {
    if (bridge.getGamePhase() === 'ARENA' && !bridge.canPlayerAct(bridge.getLocalPlayerId())) return;
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
        const handle = this.ctx.gameAudioSystem.startLoop('sfx_burrowed', player.sprite.x, player.sprite.y, playerId);
        if (handle) this.burrowLoopHandles.set(playerId, handle);
      }
    } else if (phase !== 'underground' && previousPhase === 'underground') {
      const handle = this.burrowLoopHandles.get(playerId);
      if (handle) { this.ctx.gameAudioSystem.stopLoop(handle); this.burrowLoopHandles.delete(playerId); }
    }

    this.prevBurrowPhases.set(playerId, phase);
  }

  removeBurrowPhase(playerId: string): void {
    this.prevBurrowPhases.delete(playerId);
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
    if (bridge.getPlayerUtilityOverrideName(localId) && equipped) return equipped;
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
    // Der Host besitzt den autoritativen Wert bereits lokal. Der replizierte 20-Hz-Snapshot
    // kann nach einem Schuss noch einen Frame lang veraltet sein und darf deshalb dort kein
    // zweites, anschliessend abgelehntes Prediction-Feuer freigeben.
    if (bridge.isHost() && this.ctx.resourceSystem) {
      return this.ctx.resourceSystem.getAdrenaline(localId);
    }

    const snapshotAdrenaline = bridge.getLatestGameState()?.players[localId]?.adrenaline ?? 0;
    const snapshotVersion = bridge.getGameStateVersion();
    if (this.predictedLocalAdrenaline === null || this.predictedLocalAdrenalineSnapshot === null) {
      this.predictedLocalAdrenaline = snapshotAdrenaline;
      this.predictedLocalAdrenalineSnapshot = snapshotAdrenaline;
      this.predictedLocalAdrenalineSnapshotVersion = snapshotVersion;
    } else if (snapshotVersion !== this.predictedLocalAdrenalineSnapshotVersion) {
      const snapshotDelta = snapshotAdrenaline - this.predictedLocalAdrenalineSnapshot;
      if (snapshotDelta < 0) {
        // Autoritative Verbraeuche koennen den Schattenwert nur senken. Ein vor dem Schuss
        // erzeugter Snapshot darf eine bereits lokal reservierte Ausgabe nicht zuruecknehmen.
        this.predictedLocalAdrenaline = Math.min(this.predictedLocalAdrenaline, snapshotAdrenaline);
      } else if (snapshotDelta > 0) {
        // Regeneration und Belohnungen werden als Delta uebernommen. So kann gehaltenes Feuer
        // wieder anlaufen, ohne einen noch nicht bestaetigten Verbrauch zu vergessen.
        this.predictedLocalAdrenaline = Math.min(
          this.getLocalMaxAdrenaline(),
          this.predictedLocalAdrenaline + snapshotDelta,
        );
      }
      this.predictedLocalAdrenalineSnapshot = snapshotAdrenaline;
      this.predictedLocalAdrenalineSnapshotVersion = snapshotVersion;
    }
    return this.predictedLocalAdrenaline;
  }

  recordPredictedAdrenalineSpend(amount: number): void {
    if (bridge.isHost() || amount <= 0) return;
    this.predictedLocalAdrenaline = Math.max(0, this.getLocalAdrenaline() - amount);
  }

  getLocalUtilityCooldownFrac(): number {
    const localId = bridge.getLocalPlayerId();
    const selected = this.getLocalInspectorSelectedTool();
    const config = this.getLocalUtilityConfig();
    const hasOverride = bridge.getPlayerUtilityOverrideName(localId) !== '' || this.clientUtilityOverride !== null;
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
    const profile = this.getLocalCoopDefenseProfile();
    const items = this.getLocalCoopDefenseItems();
    if (!profile && items.length === 0) return EMPTY_EFFECT_TOTALS;
    return getCoopDefenseCommittedEffectTotals(profile, this.getLocalCoopDefenseClassId(), items);
  }

  /**
   * Muss denselben Wert liefern wie das Host-Gate in
   * `ArenaLifecycleCoordinator.getConstructionCapacity`, sonst zeigt die Bauvorschau Plaetze an,
   * die der Host anschliessend ablehnt. Das `CoopDefensePlayerModifierSystem` ist auf dem Client
   * nicht verfuegbar, deshalb laeuft es hier ueber dieselben Effekt-Summen.
   */
  getLocalConstructionCapacity(): number {
    return getCoopDefenseConstructionCapacity(
      this.getLocalEffectTotals().additive[COOP_DEFENSE_CONSTRUCTION_CAPACITY_STAT] ?? 0,
    );
  }

  /** Reiner Speicherzugriff auf den vor Rundenbeginn geladenen Fallback. */
  private getLocalCoopDefenseProfile() {
    const localId = bridge.getLocalPlayerId();
    const committed = bridge.getPlayerCommittedLoadout(localId)?.coopDefenseProfile;
    if (committed) return committed;
    return this.storedProfileFallback;
  }

  /**
   * Ausruestung des lokalen Spielers. Der Fallback greift wie beim Profil nur, solange der
   * Commit-Snapshot noch nicht angekommen ist – sonst zeigte die HUD waehrend des Countdowns
   * kurzzeitig zu niedrige Maxima. Die Referenz wird gehalten, damit der Totals-Cache greift.
   */
  private getLocalCoopDefenseItems(): readonly CoopDefenseItem[] {
    const committed = bridge.getPlayerCommittedLoadout(bridge.getLocalPlayerId())?.equippedItems;
    if (committed) return committed;
    return this.storedItemsFallback ?? [];
  }

  getLocalInspectorTools(): readonly LoadoutToolRef[] {
    const committed = bridge.getPlayerCommittedLoadout(bridge.getLocalPlayerId());
    return committed?.coopDefenseClassId === 'inspector_gadachs'
      ? (committed.tools ?? committed.coopDefenseProfile?.toolLoadout ?? [])
      : [];
  }

  getLocalInspectorSelectedTool(): LoadoutToolRef | null {
    const tools = this.getLocalInspectorTools();
    if (this.inspectorSelectedTool && tools.some((tool) => (
      tool.kind === this.inspectorSelectedTool?.kind && tool.id === this.inspectorSelectedTool?.id
    ))) return this.inspectorSelectedTool;
    const committed = bridge.getPlayerCommittedLoadout(bridge.getLocalPlayerId());
    const profileSelected = committed?.coopDefenseProfile?.selectedTool;
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
    const base = this.clientUtilityOverride ?? getUtilityConfigForMode(tool.id, bridge.getGameMode());
    if (!base) return undefined;
    const modified = applyCoopDefenseModifiersToUtilityConfig(base, this.getLocalEffectTotals());
    return modified;
  }

  /** Concrete utility ID used for the host-published cooldown channel. */
  getLocalUtilityCooldownId(): string {
    const localId = bridge.getLocalPlayerId();
    const config = this.getLocalUtilityConfig();
    const hasOverride = bridge.getPlayerUtilityOverrideName(localId) !== '' || this.clientUtilityOverride !== null;
    const selected = this.getLocalInspectorSelectedTool();
    if (selected?.kind === 'construction' && !hasOverride) return selected.id;
    return config.id;
  }

  private getLocalCoopDefenseClassId() {
    const localId = bridge.getLocalPlayerId();
    const committed = bridge.getPlayerCommittedLoadout(localId);
    if (committed) return committed.coopDefenseClassId;
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
    this.predictedHitscanCooldownUntil = { weapon1: 0, weapon2: 0 };
    this.predictedLocalAdrenaline = null;
    this.predictedLocalAdrenalineSnapshot = null;
    this.predictedLocalAdrenalineSnapshotVersion = -1;
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
        this.ctx.effectSystem.playDashTrailGhost(player.sprite.x, player.sprite.y, player.color, 0.5, player.sprite.rotation);
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
      const handle = this.ctx.gameAudioSystem.startLoop('sfx_burrowed', player.sprite.x, player.sprite.y, player.id);
      if (handle) this.burrowLoopHandles.set(player.id, handle);
    } else if (phase !== 'underground' && previousPhase === 'underground') {
      const handle = this.burrowLoopHandles.get(player.id);
      if (handle) { this.ctx.gameAudioSystem.stopLoop(handle); this.burrowLoopHandles.delete(player.id); }
    } else if (phase === 'underground') {
      const handle = this.burrowLoopHandles.get(player.id);
      if (handle) this.ctx.gameAudioSystem.updateLoopPosition(handle, player.sprite.x, player.sprite.y, player.id);
    }

    if (shouldAnimate) {
      this.ctx.effectSystem.playBurrowPhaseEffect(player.sprite.x, player.sprite.y, phase);
    }
    player.setBurrowPhase(phase, shouldAnimate);
    this.ctx.effectSystem.syncBurrowState(player.id, phase, player.sprite);
    this.prevBurrowPhases.set(player.id, phase);
  }

  private checkLocalPickup(powerups: SyncedPowerUp[]): void {
    const now = Date.now();
    if (now < this.pickupCooldownUntil) return;

    const localId = bridge.getLocalPlayerId();
    const player  = this.ctx.playerManager.getPlayer(localId);
    if (!player || !player.sprite.active) return;
    if (this.ctx.burrowSystem?.isBurrowed(localId)) return;

    const px = player.sprite.x;
    const py = player.sprite.y;

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
      const config = getUtilityConfigForMode(descriptor.utilityId, bridge.getGameMode());
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

  private playPredictedLocalHitscanTracer(slot: WeaponSlot, angle: number): number | undefined {
    const config = this.getLocalWeaponConfig(slot);
    if (config.fire.type !== 'hitscan') return undefined;

    const now = Date.now();
    if (now < this.predictedHitscanCooldownUntil[slot]) return undefined;
    this.predictedHitscanCooldownUntil[slot] = now + config.cooldown;

    const localPlayer = this.ctx.playerManager.getPlayer(bridge.getLocalPlayerId());
    if (!localPlayer) return undefined;

    const shotId = this.nextPredictedHitscanShotId++;
    const gameplayMuzzleOrigin = getTopDownMuzzleOrigin(localPlayer.sprite.x, localPlayer.sprite.y, angle);
    const visualMuzzleOrigin = getHeldWeaponMuzzleOrigin(
      config.id,
      localPlayer.sprite.x,
      localPlayer.sprite.y,
      localPlayer.sprite.rotation,
      localPlayer.sprite.displayWidth,
    ) ?? gameplayMuzzleOrigin;
    const trace  = this.ctx.combatSystem.traceHitscan({
      shooterId:  bridge.getLocalPlayerId(),
      startX:     gameplayMuzzleOrigin.x,
      startY:     gameplayMuzzleOrigin.y,
      angle,
      range:      config.range,
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
    const mode = bridge.getGameMode();
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
    const w1Id = bridge.getPlayerLoadoutSlot(playerId, 'weapon1');
    const w2Id = bridge.getPlayerLoadoutSlot(playerId, 'weapon2');
    const utId = bridge.getPlayerLoadoutSlot(playerId, 'utility');
    const ulId = bridge.getPlayerLoadoutSlot(playerId, 'ultimate');
    return resolveEffectiveLoadoutSelection({
      weapon1:  w1Id ? WEAPON_CONFIGS[w1Id  as keyof typeof WEAPON_CONFIGS]   : undefined,
      weapon2:  w2Id ? WEAPON_CONFIGS[w2Id  as keyof typeof WEAPON_CONFIGS]   : undefined,
      utility:  utId ? UTILITY_CONFIGS[utId as keyof typeof UTILITY_CONFIGS]  : undefined,
      ultimate: ulId ? ULTIMATE_CONFIGS[ulId as keyof typeof ULTIMATE_CONFIGS]: undefined,
    }, bridge.getGameMode(), isLocalPlayer ? this.storedProfileFallback : null,
    isLocalPlayer ? this.storedClassIdFallback : null,
    // Referenzstabil ueber den memoisierten Zugriff, sonst greift der Cache dieser Aufloesung nie.
    isLocalPlayer ? this.getLocalCoopDefenseItems() : []);
  }
}
