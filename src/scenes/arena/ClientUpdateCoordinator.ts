import type Phaser from 'phaser';
import { bridge }          from '../../network/bridge';
import { dequantizeAngle } from '../../utils/angle';
import { NET_SMOOTH_TIME_MS, DASH_T2_S, PLAYER_COLORS, getTopDownMuzzleOrigin } from '../../config';
import { isVelocityMoving } from '../../loadout/SpreadMath';
import { WEAPON_CONFIGS, UTILITY_CONFIGS, ULTIMATE_CONFIGS } from '../../loadout/LoadoutConfig';
import { sanitizeLoadoutSelectionForMode } from '../../loadout/LoadoutRules';
import type { UtilityConfig, WeaponConfig } from '../../loadout/LoadoutConfig';
import { DEFAULT_LOADOUT }   from '../../loadout/LoadoutConfig';
import { buildLocalArenaHudData } from '../../ui/LocalArenaHudData';
import type { ArenaContext }     from './ArenaContext';
import type { LocalPlayerState } from './LocalPlayerState';
import type { RockVisualHelper } from './RockVisualHelper';
import type { BurrowPhase, SyncedPowerUp, WeaponSlot } from '../../types';
import { PICKUP_RADIUS }     from '../../powerups/PowerUpConfig';
import type { PlayerEntity } from '../../entities/PlayerEntity';

/**
 * Runs every frame on non-host clients.
 *
 * Owns all client-side interpolation state and predictive local feedback
 * (weapon cooldown, hitscan tracer, pickup spam protection).
 */
export class ClientUpdateCoordinator {
  private lastGameStateVersion = -1;
  private readonly prevAliveStates      = new Map<string, boolean>();
  private readonly prevDashPhases       = new Map<string, number>();
  private readonly prevBurrowPhases     = new Map<string, BurrowPhase>();
  private readonly burrowLoopHandles    = new Map<string, string>();
  private readonly prevStealthStates    = new Map<string, boolean>();
  private readonly dashPhase2StartTimes = new Map<string, number>();
  private readonly dashTrailTimers      = new Map<string, number>();
  private weaponLastFired: Record<'weapon1' | 'weapon2', number> = { weapon1: 0, weapon2: 0 };
  private predictedHitscanCooldownUntil: Record<WeaponSlot, number> = { weapon1: 0, weapon2: 0 };
  private nextPredictedHitscanShotId = 1;
  private pickupCooldownUntil = 0;
  private moveLoopHandle: string | null = null;

  /** Client-side prediction for utility override (BFG / Holy Hand Grenade pickup). */
  clientUtilityOverride: UtilityConfig | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ctx: ArenaContext,
    private readonly localPlayerState: LocalPlayerState,
    private readonly rockVisualHelper: RockVisualHelper,
  ) {}

  runClientUpdate(delta: number): void {
    const state = bridge.getLatestGameState();
    if (!state) return;

    const lerpFactor = 1 - Math.exp(-delta / NET_SMOOTH_TIME_MS);

    const currentVersion = bridge.getGameStateVersion();
    const isNewData = currentVersion !== this.lastGameStateVersion;
    if (isNewData) this.lastGameStateVersion = currentVersion;

    if (isNewData) {
      const localId = bridge.getLocalPlayerId();
      for (const [id, ps] of Object.entries(state.players)) {
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
        player.updateHP(ps.hp);
        player.updateArmor(ps.armor);
        player.updateBurnStacks(ps.burnStacks ?? 0);
        player.setVisible(ps.alive);
        player.setRageTint(ps.isRaging && ps.activeUltimateId === 'HONEY_BADGER_RAGE');
        const isStealthed = ps.isDecoyStealthed ?? false;
        const wasStealthed = this.prevStealthStates.get(id) ?? false;
        if (isStealthed !== wasStealthed) {
          this.ctx.effectSystem.playStealthTransitionEffect(player.sprite.x, player.sprite.y, !isStealthed, player.color);
        }
        player.setDecoyStealth(isStealthed);
        this.prevStealthStates.set(id, isStealthed);

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

      this.ctx.projectileManager.clientSyncVisuals(state.projectiles, bridge.getLocalPlayerId());
      this.ctx.decoySystem.syncSnapshots(state.decoys ?? []);
      this.ctx.smokeSystem.syncVisuals(state.smokes);
      this.ctx.fireSystem.syncVisuals(state.fires ?? []);
      this.ctx.stinkCloudSystem.syncVisuals(state.stinkClouds ?? []);

      // teslaDomeRenderer is accessed via the bundle (passed from ArenaScene)
      // → handled by ArenaScene.update() which calls renderers.teslaDome.syncVisuals

      if (state.rocks && this.ctx.arenaResult && this.ctx.currentLayout) {
        for (const rs of state.rocks) {
          if (rs.hp <= 0) {
            this.rockVisualHelper.handleDestroyedRock(rs.id, 'damage');
            continue;
          }
          this.rockVisualHelper.updateRockVisualById(rs.id, rs.hp);
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

      const trainState = state.train;
      this.ctx.combatSystem.setClientTrainBounds(
        trainState?.alive ? { x: trainState.x, y: trainState.y, dir: trainState.dir } : null,
      );

      this.checkLocalPickup(state.powerups ?? []);
    }

    for (const player of this.ctx.playerManager.getAllPlayers()) {
      player.lerpStep(lerpFactor);
      const dashPhase = this.prevDashPhases.get(player.id) ?? 0;
      if (dashPhase !== 0) {
        this.applyDashVisual(player, player.id, dashPhase as 1 | 2);
      } else {
        player.setDashScale(1.0);
      }
    }

    this.ctx.decoySystem.updateVisuals(lerpFactor);

    this.ctx.projectileManager.clientExtrapolate();
    this.ctx.stinkCloudSystem.clientUpdate(delta);

    const localId2 = bridge.getLocalPlayerId();
    const localPlayerClient = this.ctx.playerManager.getPlayer(localId2);
    if (localPlayerClient) {
      localPlayerClient.setRotation(this.ctx.inputSystem.getAimAngle());
    }

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
      const utilDisplayName = overrideName
        || this.clientUtilityOverride?.displayName
        || localUtilityConfig.displayName;
      const hudData = buildLocalArenaHudData({
        hp:                      localState.hp,
        armor:                   localState.armor,
        adrenaline:              localState.adrenaline,
        rage:                    localState.rage,
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
        activePowerUps:          bridge.getPlayerActiveBuffs(localId2),
        shieldBuff:              bridge.getPlayerShieldBuffHud(localId2),
        weapon2AdrenalineCost:   this.getLocalWeaponConfig('weapon2').adrenalinCost ?? 0,
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

    if (state.projectiles.some(p => p.style === 'bfg')) {
      this.scene.cameras.main.shake(100, 0.003);
    }
  }

  /**
   * Called from the input listener in ArenaScene when the local player fires.
   * Returns the shotId for hitscan traces (undefined for non-hitscan weapons).
   */
  notifyLoadoutFired(slot: WeaponSlot, angle: number, targetX: number, targetY: number): number | undefined {
    void targetX;
    void targetY;

    if (slot !== 'weapon1' && slot !== 'weapon2') return undefined;

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
    if (this.clientUtilityOverride) this.clientUtilityOverride = null;
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
    const equipped = this.ctx.loadoutManager?.getEquippedUtilityConfig(localId);
    if (equipped) return equipped;
    if (this.clientUtilityOverride) return this.clientUtilityOverride;
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
      for (let value = config.rageCost; value < 300 /* RAGE_MAX */; value += config.rageCost) {
        thresholds.push(value);
      }
      return thresholds;
    }
    return [config.rageRequired];
  }

  getLocalRage(): number {
    const localId = bridge.getLocalPlayerId();
    return bridge.getLatestGameState()?.players[localId]?.rage ?? 0;
  }

  getLocalAdrenaline(): number {
    const localId = bridge.getLocalPlayerId();
    return bridge.getLatestGameState()?.players[localId]?.adrenaline ?? 0;
  }

  getLocalUtilityCooldownFrac(): number {
    const localId = bridge.getLocalPlayerId();
    const cooldownUntil = bridge.getPlayerUtilityCooldownUntil(localId);
    const remaining = cooldownUntil - bridge.getSynchronizedNow();
    if (remaining <= 0) return 0;
    const config = this.getLocalUtilityConfig();
    if (config.cooldown <= 0) return 0;
    return Math.min(1, remaining / config.cooldown);
  }

  resetPerRound(): void {
    this.lastGameStateVersion = -1;
    this.prevAliveStates.clear();
    this.prevDashPhases.clear();
    this.prevBurrowPhases.clear();
    for (const h of this.burrowLoopHandles.values()) this.ctx.gameAudioSystem.stopLoop(h);
    this.burrowLoopHandles.clear();
    this.prevStealthStates.clear();
    this.dashPhase2StartTimes.clear();
    this.dashTrailTimers.clear();
    this.weaponLastFired = { weapon1: 0, weapon2: 0 };
    this.predictedHitscanCooldownUntil = { weapon1: 0, weapon2: 0 };
    this.nextPredictedHitscanShotId = 1;
    this.pickupCooldownUntil = 0;
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
      const dist = Math.hypot(pu.x - px, pu.y - py);
      if (dist <= PICKUP_RADIUS * 2) {
        if (bridge.isHost()) {
          this.ctx.powerUpSystem?.tryPickup(localId, pu.uid, px, py);
        } else {
          bridge.sendPickupPowerUp(pu.uid);
          if (pu.defId === 'BFG') {
            this.clientUtilityOverride = UTILITY_CONFIGS.BFG;
          } else if (pu.defId === 'NUKE') {
            this.clientUtilityOverride = UTILITY_CONFIGS.NUKE;
          } else if (pu.defId === 'HOLY_HAND_GRENADE') {
            this.clientUtilityOverride = UTILITY_CONFIGS.HOLY_HAND_GRENADE;
          }
        }
        this.pickupCooldownUntil = now + 100;
        return;
      }
    }
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
    const muzzleOrigin = getTopDownMuzzleOrigin(localPlayer.sprite.x, localPlayer.sprite.y, angle);
    const trace  = this.ctx.combatSystem.traceHitscan({
      shooterId:  bridge.getLocalPlayerId(),
      startX:     muzzleOrigin.x,
      startY:     muzzleOrigin.y,
      angle,
      range:      config.range,
      traceThickness: config.fire.traceThickness,
      applyFavorTheShooter: bridge.isHost(),
    });

    this.ctx.effectSystem.playPredictedHitscanTracer(
      muzzleOrigin.x,
      muzzleOrigin.y,
      trace.endX,
      trace.endY,
      localPlayer.color,
      config.fire.traceThickness,
      shotId,
      trace.hitPlayerId ? 'player' : (trace.hitObstacle ? 'environment' : 'none'),
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

  private resolveCommittedLoadoutSelection(playerId: string) {
    const committed = bridge.getPlayerCommittedLoadout(playerId);
    if (!committed) return this.resolveLoadoutSelection(playerId);
    return sanitizeLoadoutSelectionForMode({
      weapon1:  WEAPON_CONFIGS[committed.weapon1  as keyof typeof WEAPON_CONFIGS],
      weapon2:  WEAPON_CONFIGS[committed.weapon2  as keyof typeof WEAPON_CONFIGS],
      utility:  UTILITY_CONFIGS[committed.utility as keyof typeof UTILITY_CONFIGS],
      ultimate: ULTIMATE_CONFIGS[committed.ultimate as keyof typeof ULTIMATE_CONFIGS],
    }, bridge.getGameMode());
  }

  private resolveLoadoutSelection(playerId: string) {
    const w1Id = bridge.getPlayerLoadoutSlot(playerId, 'weapon1');
    const w2Id = bridge.getPlayerLoadoutSlot(playerId, 'weapon2');
    const utId = bridge.getPlayerLoadoutSlot(playerId, 'utility');
    const ulId = bridge.getPlayerLoadoutSlot(playerId, 'ultimate');
    return sanitizeLoadoutSelectionForMode({
      weapon1:  w1Id ? WEAPON_CONFIGS[w1Id  as keyof typeof WEAPON_CONFIGS]   : undefined,
      weapon2:  w2Id ? WEAPON_CONFIGS[w2Id  as keyof typeof WEAPON_CONFIGS]   : undefined,
      utility:  utId ? UTILITY_CONFIGS[utId as keyof typeof UTILITY_CONFIGS]  : undefined,
      ultimate: ulId ? ULTIMATE_CONFIGS[ulId as keyof typeof ULTIMATE_CONFIGS]: undefined,
    }, bridge.getGameMode());
  }
}
