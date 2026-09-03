import type Phaser from 'phaser';
import { bridge }            from '../../network/bridge';
import type { RendererBundle }      from './RendererBundle';
import type { ClientUpdateCoordinator } from './ClientUpdateCoordinator';
import type { LeftSidePanel }       from '../../ui/LeftSidePanel';
import type { RightSidePanel } from '../../ui/RightSidePanel';
import type { CenterHUD } from '../../ui/CenterHUD';
import type { PlayerManager } from '../../entities/PlayerManager';
import type { HostPhysicsSystem } from '../../systems/HostPhysicsSystem';
import type { CombatSystem } from '../../systems/CombatSystem';
import type { DecoySystem } from '../../systems/DecoySystem';
import type { EffectSystem } from '../../effects/EffectSystem';
import type { VisualFeedbackDirector } from '../../effects/VisualFeedbackDirector';
import type { GameAudioSystem } from '../../audio/GameAudioSystem';
import type { ExplosionVisualStyle, LoadoutUseParams } from '../../types';
import { getUtilityConfigForMode, type UtilityConfig } from '../../loadout/LoadoutConfig';
import { normalizeConstructionId } from '../../config/coopDefenseConstructions';
import { CAMERA_FEEDBACK_PRIORITY, legacyShakeAmplitudePx } from '../../effects/camera/cameraFeedbackPresets';
import type {
  ConstructionRpcPort,
  HeldActionRpcIdentity,
  HeldActionRpcPort,
  PersistentBaseRpcPort,
  PlayerCapabilitiesRpcPort,
  PlayerLoadoutRpcPort,
  TrainRpcPort,
  WorldParticipationRpcPort,
} from './ArenaRpcPorts';

// SHOT_AUDIO_REMOTE_CLOSE_VOLUME (0.58) caps all spatial sounds at ~58 % volume even at
// distance 0.  Explosions are world events, not remote-player gunshots, so we compensate
// with a per-type scale so they can reach full volume when close to the listener.
// scale = 1 / SHOT_AUDIO_REMOTE_CLOSE_VOLUME ≈ 1.72 lets a close explosion hit 1.0
// (Phaser clamps finalVolume to [0, 1] anyway, so there is no clipping risk).
const EXPLOSION_CLOSE_BOOST = 1 / 0.58; // ≈ 1.72

function resolveExplosionAudio(visualStyle?: ExplosionVisualStyle): { key: string; scale: number } | undefined {
  switch (visualStyle) {
    case 'holy':        return { key: 'sfx_explosion_holy',           scale: EXPLOSION_CLOSE_BOOST };
    case 'energy':      return { key: 'sfx_explosion_asmd_secondary', scale: EXPLOSION_CLOSE_BOOST };
    case 'timebomb':    return { key: 'sfx_explosion_he', scale: EXPLOSION_CLOSE_BOOST };
    case 'timebomb_pop': return undefined;
    case 'regeneration': return undefined;
    case 'lightning':   return { key: 'sfx_explosion_asmd_secondary', scale: EXPLOSION_CLOSE_BOOST * 0.82 };
    case 'nuke':        return { key: 'sfx_nuke_explosion',           scale: EXPLOSION_CLOSE_BOOST };
    case 'rocket':      return { key: 'sfx_explosion_rocket',         scale: EXPLOSION_CLOSE_BOOST };
    case 'mini_rocket': return { key: 'sfx_explosion_mini_rocket',    scale: EXPLOSION_CLOSE_BOOST };
    case 'mini_rocket_cascade': return { key: 'sfx_explosion_mini_rocket', scale: EXPLOSION_CLOSE_BOOST };
    case 'train':       return undefined; // sound handled separately via playLocalSound('sfx_train_explode')
    // Aus der Brutbombe schluepft ein Dachs, es explodiert nichts – deshalb der Wurfgeraeusch-Sound
    // statt eines Explosionsknalls. Kein EXPLOSION_CLOSE_BOOST: er soll genauso klingen wie eine
    // geworfene Granate, nicht wie ein Welt-Ereignis.
    case 'brood_hatch': return { key: 'shot_throw', scale: 1 };
    default:            return { key: 'sfx_explosion_he',             scale: EXPLOSION_CLOSE_BOOST };
  }
}

type ChargeableUtilityConfig = UtilityConfig & {
  activation: Extract<UtilityConfig['activation'], { type: 'charged_throw' | 'charged_gate' }>;
};

type HostChargeValidation =
  | { ok: true; authoritativeParams?: LoadoutUseParams }
  | { ok: false; reason: 'blocked' };

function isChargeableUtilityConfig(config: UtilityConfig | undefined): config is ChargeableUtilityConfig {
  return config?.activation.type === 'charged_throw' || config?.activation.type === 'charged_gate';
}

/** Consumes the host-held action only for a utility that actually requires one. */
function validateHostUtilityCharge(
  heldActionPort: HeldActionRpcPort,
  senderId: string,
  utility: UtilityConfig | undefined,
  hostNowMs: number,
  params?: LoadoutUseParams,
): HostChargeValidation {
  if (!isChargeableUtilityConfig(utility)) return { ok: true, authoritativeParams: params };

  const identity = getHeldActionIdentity(params);
  const held = identity
    ? heldActionPort.consume(
      senderId,
      params?.heldActionId,
      utility.activation.type,
      utility.activation.fullChargeDuration,
      hostNowMs,
      identity,
    )
    : heldActionPort.consume(
      senderId,
      params?.heldActionId,
      utility.activation.type,
      utility.activation.fullChargeDuration,
      hostNowMs,
    );
  if (!held || (utility.activation.type === 'charged_gate' && held.chargeFraction < 1)) {
    return { ok: false, reason: 'blocked' };
  }
  return {
    ok: true,
    authoritativeParams: {
      ...(params ?? {}),
      utilityChargeFraction: held.chargeFraction,
    },
  };
}

function getHeldActionIdentity(params?: LoadoutUseParams): HeldActionRpcIdentity | undefined {
  if (params?.temporaryUtilityInstanceId !== undefined) {
    return { temporaryUtilityInstanceId: params.temporaryUtilityInstanceId };
  }
  if (params?.toolRef !== undefined) return { toolRef: params.toolRef };
  return undefined;
}

/**
 * Registers all bridge RPC handlers in one place.
 *
 * Runtime- und Domain-Zugriffe laufen ueber kleine fachliche Ports; die Bridge bleibt als
 * expliziter Netzwerkadapter an dieser Grenze.
 */
export class RpcCoordinator {
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly renderers: RendererBundle,
    private readonly clientUpdate: ClientUpdateCoordinator,
    private readonly leftPanel: LeftSidePanel,
    private readonly rightPanel: RightSidePanel,
    private readonly centerHUD: CenterHUD,
    private readonly playerManager: PlayerManager,
    private readonly hostPhysics: HostPhysicsSystem,
    private readonly combatSystem: CombatSystem,
    private readonly decoySystem: DecoySystem,
    private readonly effectSystem: EffectSystem,
    private readonly visualFeedback: VisualFeedbackDirector,
    private readonly gameAudioSystem: GameAudioSystem,
    private readonly participation: WorldParticipationRpcPort,
    private readonly capabilities: PlayerCapabilitiesRpcPort,
    private readonly construction: ConstructionRpcPort,
    private readonly persistentBase: PersistentBaseRpcPort,
    private readonly playerLoadout: PlayerLoadoutRpcPort,
    private readonly heldActions: HeldActionRpcPort,
    private readonly train: TrainRpcPort,
  ) {}

  registerAll(): void {
    this.registerDashHandler();
    this.registerBurrowRpcHandler();
    this.registerDecoyStealthBreakHandler();
    this.registerHeldActionHandler();
    this.registerLoadoutUseHandler();
    this.registerPersistentBaseRewardPlacementHandler();
    this.registerPersistentBaseMoveHandler();
    this.registerCaptureTheBeerFxHandler();
    this.registerCoopDefenseCarryDeliveredFxHandler();
    this.registerExplosionEffectHandler();
    this.registerSlimeBloomEffectHandler();
    this.registerCorpseMarkerHandler();
    this.registerFireChunkEffectHandler();
    this.registerBlackHoleEffectHandler();
    this.registerMiniRocketCollectionEffectHandler();
    this.registerMiniRocketDestructionEffectHandler();
    this.registerGrenadeCountdownHandler();
    this.registerCoopDefenseXpPopupHandler();
    this.registerBfgLaserBatchHandler();
    this.registerBurrowVisualHandler();
    this.registerShockwaveEffectHandler();
    this.registerTrainBurrowSparksHandler();
    this.registerShotFxHandler();
    this.registerTranslocatorFlashHandler();
    this.registerColorHandlers();
    this.registerKillEventHandler();
    this.registerTrainDestroyedHandler();
    this.registerPickupPowerUpHandler();
    this.registerWorldParticipationRequestHandler();
  }

  private registerPersistentBaseRewardPlacementHandler(): void {
    bridge.registerPersistentBaseRewardPlacementHandler((playerId, request) => (
      this.persistentBase.placeReward(playerId, request)
    ));
  }

  private registerPersistentBaseMoveHandler(): void {
    bridge.registerPersistentBaseMoveHandler((playerId, request) => (
      this.persistentBase.moveObject(playerId, request, Date.now())
    ));
  }

  /**
   * Eintritt und Austritt an der laufenden World. Der Host entscheidet; die Netzwerkgrenze
   * prueft nur Absender und World-Revision, alle fachlichen Bedingungen stehen im Lifecycle.
   */
  private registerWorldParticipationRequestHandler(): void {
    bridge.registerWorldParticipationRequestHandler((playerId, join) => {
      return this.participation.handleRequest(playerId, join);
    });
  }

  private registerDashHandler(): void {
    bridge.registerDashHandler((playerId, dx, dy) => {
      if (!bridge.isHost()) return;
      if (!this.capabilities.get(playerId).canMove) return;
      if (bridge.isArenaCountdownActive()) return;
      this.hostPhysics.handleDashRPC(playerId, dx, dy);
    });
  }

  private registerBurrowRpcHandler(): void {
    bridge.registerBurrowHandler((playerId, wantsBurrowed) => {
      if (!bridge.isHost()) return;
      if (!this.capabilities.get(playerId).canMove) return;
      if (bridge.isArenaCountdownActive()) return;
      this.playerLoadout.handleBurrowRequest(playerId, wantsBurrowed);
    });
  }

  private registerDecoyStealthBreakHandler(): void {
    bridge.registerDecoyStealthBreakHandler((playerId) => {
      if (!bridge.isHost()) return;
      if (!this.capabilities.get(playerId).canUseCombat) return;
      const player = this.playerManager.getPlayer(playerId);
      if (player) this.gameAudioSystem.playSound('sfx_decoy_reveal', player.x, player.y, playerId);
      this.decoySystem.breakStealth(playerId, Date.now());
    });
  }

  private registerHeldActionHandler(): void {
    bridge.registerHeldActionHandler((
      playerId,
      operation,
      actionId,
      kind,
      _durationMs,
      toolRef,
      temporaryUtilityInstanceId,
    ) => {
      if (!bridge.isHost()) return false;
      if (operation === 'cancel') {
        this.heldActions.cancel(playerId, actionId);
        return true;
      }
      if (!kind || !this.capabilities.get(playerId).canInteract || bridge.isArenaCountdownActive()
        || !this.combatSystem.isAlive(playerId)
        || this.playerLoadout.isBurrowed(playerId)
        || this.playerLoadout.isStunned(playerId)) return false;
      // Die Host-Zeit wird einmal an der RPC-Orchestrierungsgrenze aufgelöst und unverändert
      // durch die Held-Action-Grenze gereicht. Retries mit derselben actionId werden dort
      // duplicate-safe behandelt und dürfen den ursprünglichen Startzeitpunkt nicht verschieben.
      const hostNowMs = Date.now();

      if (kind === 'global_dismantle') {
        if (toolRef || temporaryUtilityInstanceId) return false;
        return this.heldActions.start(playerId, actionId, kind, 1_000, hostNowMs);
      }
      let utility: UtilityConfig | undefined;
      if (toolRef && temporaryUtilityInstanceId) return false;
      if (toolRef) {
        const currentLoadout = bridge.getPlayerCurrentLoadoutSnapshot(playerId);
        if (toolRef.kind === 'construction') return false;
        if (
          toolRef.kind !== 'utility'
          || currentLoadout?.coopDefenseClassId !== 'inspector_gadachs'
          || !(currentLoadout.tools ?? []).some((tool) => tool.kind === 'utility' && tool.id === toolRef.id)
        ) return false;
        utility = getUtilityConfigForMode(
          toolRef.id,
          bridge.getActiveGameMode(),
        );
      } else if (temporaryUtilityInstanceId) {
        utility = this.playerLoadout.getTemporaryUtilityConfig(playerId, temporaryUtilityInstanceId) ?? undefined;
      } else {
        utility = this.playerLoadout.getEquippedUtilityConfig(playerId);
      }
      if (!utility || utility.activation.type !== kind) return false;
      const identity = toolRef
        ? { toolRef }
        : temporaryUtilityInstanceId !== undefined
          ? { temporaryUtilityInstanceId }
          : undefined;
      return identity
        ? this.heldActions.start(playerId, actionId, kind, utility.activation.fullChargeDuration, hostNowMs, identity)
        : this.heldActions.start(playerId, actionId, kind, utility.activation.fullChargeDuration, hostNowMs);
    });
  }

  private registerLoadoutUseHandler(): void {
    bridge.registerLoadoutUseHandler((slot, angle, targetX, targetY, senderId, shotId, params, clientX, clientY) => {
      if (!bridge.isHost()) return { ok: false, reason: 'blocked' };
      const capabilities = this.capabilities.get(senderId);
      if (!capabilities) return { ok: false, reason: 'blocked' };
      if (!capabilities.canInteract) return { ok: false, reason: 'blocked' };
      if (bridge.isArenaCountdownActive()) return { ok: false, reason: 'blocked' };
      // Ein einziger hostseitiger Zeitpunkt für die gesamte Aktion: Held-Action-Consume,
      // Charge-Validierung, Construction-Use und der Gameplay-Commit teilen sich `hostNowMs`.
      // `clientX`/`clientY` bleiben Positions-/Latenzkompensation und sind davon unberührt;
      // eine Client-Uhr fließt bewusst nicht mehr in Cooldown-/Commit-Entscheidungen ein.
      const hostNowMs = Date.now();
      const currentLoadout = bridge.getPlayerCurrentLoadoutSnapshot(senderId);
      let authoritativeParams = params;
      const temporaryUtilityInstanceId = params?.temporaryUtilityInstanceId;
      if (temporaryUtilityInstanceId !== undefined
        && (slot !== 'utility'
          || typeof temporaryUtilityInstanceId !== 'string'
          || temporaryUtilityInstanceId.length === 0
          || temporaryUtilityInstanceId.length > 80
          || temporaryUtilityInstanceId.trim() !== temporaryUtilityInstanceId)) {
        return { ok: false, reason: 'invalid' };
      }
      if (params?.globalDismantle) {
        if (slot !== 'utility' || params.toolRef || params.constructionId !== undefined || params.dismantle
          || params.temporaryUtilityInstanceId) {
          return { ok: false, reason: 'invalid' };
        }
        const held = this.heldActions.consume(
          senderId,
          params.heldActionId,
          'global_dismantle',
          1_000,
          hostNowMs,
        );
        if (!held || held.elapsedMs < 1_000) return { ok: false, reason: 'blocked' };
        const activityRevision = params?.activityRevision;
        return (activityRevision === undefined
          ? this.construction.dismantleAllOwnedConstructions(senderId)
          : this.construction.dismantleAllOwnedConstructions(senderId, activityRevision));
      }
      // Rueckbau belegt keinen Ausruestungsplatz und traegt deshalb keinen toolRef.
      if (params?.dismantle) {
        if (slot !== 'utility' || params.toolRef || params.constructionId !== undefined
          || params.temporaryUtilityInstanceId) {
          return { ok: false, reason: 'invalid' };
        }
        return this.construction.dismantleConstruction(
          senderId,
          targetX,
          targetY,
          hostNowMs,
          params?.activityRevision,
        );
      }
      if (currentLoadout?.coopDefenseClassId === 'inspector_gadachs'
        && slot === 'utility' && !params?.toolRef && !params?.temporaryUtilityInstanceId) {
        return { ok: false, reason: 'blocked' };
      }
      if (params?.toolRef) {
        if (slot !== 'utility' || params.temporaryUtilityInstanceId) {
          return { ok: false, reason: 'invalid' };
        }
        if (params.toolRef.kind === 'construction') {
          if (!params.constructionId
            || normalizeConstructionId(params.toolRef.id) !== normalizeConstructionId(params.constructionId)) {
            return { ok: false, reason: 'invalid' };
          }
          return this.construction.placeInspectorConstruction(
            senderId,
            params.constructionId,
            targetX,
            targetY,
            hostNowMs,
            params.activityRevision,
          );
        }
        if (params.toolRef.kind !== 'utility') return { ok: false, reason: 'invalid' };
        if (currentLoadout?.coopDefenseClassId !== 'inspector_gadachs') return { ok: false, reason: 'invalid' };
        if (params.constructionId !== undefined) return { ok: false, reason: 'invalid' };
        const inspectorUtility = getUtilityConfigForMode(
          params.toolRef.id,
          bridge.getActiveGameMode(),
        );
        if (!inspectorUtility) return { ok: false, reason: 'invalid' };
        const charge = validateHostUtilityCharge(this.heldActions, senderId, inspectorUtility, hostNowMs, params);
        if (!charge.ok) return charge;
        return this.construction.useInspectorUtility(
          senderId,
          params.toolRef,
          angle,
          targetX,
          targetY,
          hostNowMs,
          charge.authoritativeParams,
        );
      }
      if (slot === 'utility') {
        const utility = params?.temporaryUtilityInstanceId
          ? this.playerLoadout.getTemporaryUtilityConfig(senderId, params.temporaryUtilityInstanceId) ?? undefined
          : this.playerLoadout.getEquippedUtilityConfig(senderId);
        if (params?.temporaryUtilityInstanceId && !utility) {
          return { ok: false, reason: 'invalid' };
        }
        const isTranslocatorRecall = utility?.type === 'translocator'
          && this.playerLoadout.hasActiveTranslocatorPuck(senderId);
        if (isTranslocatorRecall) {
          this.heldActions.clearPlayer(senderId);
        } else {
          const charge = validateHostUtilityCharge(this.heldActions, senderId, utility, hostNowMs, params);
          if (!charge.ok) return charge;
          authoritativeParams = charge.authoritativeParams;
        }
      }
      if (!capabilities.canUseCombat) return { ok: false, reason: 'blocked' };
      const result = slot === 'weapon1' || slot === 'weapon2'
        ? this.playerLoadout.usePlayerAction({
          category: 'weapon',
          playerId: senderId,
          slot,
          angle,
          targetX,
          targetY,
          hostNowMs,
          shotId,
          params: authoritativeParams,
          clientPosition: { x: clientX, y: clientY },
        })
        : this.playerLoadout.useLoadout(
          slot,
          senderId,
          angle,
          targetX,
          targetY,
          hostNowMs,
          shotId,
          authoritativeParams,
          clientX,
          clientY,
        );
      if (slot !== 'weapon2') return result;
      return {
        ...result,
        worldRevision: bridge.getCurrentWorldRevision() ?? undefined,
        authoritativeAdrenaline: this.playerLoadout.getAdrenaline(senderId),
        adrenalineRevision: this.playerLoadout.getAdrenalineRevision(senderId),
      };
    });
  }

  private registerCaptureTheBeerFxHandler(): void {
    bridge.registerCaptureTheBeerFxHandler((event) => {
      this.renderers.beer.playFx(event);
      if (event.kind === 'score') {
        this.centerHUD.showBeerCaptured(event.scorerName, event.scorerColor);
        this.gameAudioSystem.playLocalSound('sfx_ctb_score');
      }
    });
  }

  private registerCoopDefenseCarryDeliveredFxHandler(): void {
    bridge.registerCoopDefenseCarryDeliveredFxHandler((x, y) => {
      this.renderers.beer.playCoopDefenseCarryDeliveredFx(x, y);
      this.gameAudioSystem.playLocalSound('sfx_ctb_score');
    });
  }

  private registerExplosionEffectHandler(): void {
    bridge.registerExplosionEffectHandler((x, y, radius, color, visualStyle) => {
      this.effectSystem.playExplosionEffect(x, y, radius, color, visualStyle);
      const audio = resolveExplosionAudio(visualStyle);
      if (audio) this.gameAudioSystem.playSound(audio.key, x, y, undefined, audio.scale);
      // Die Nuke pulst nicht von hier: ihre Detonation ist Phase B der Choreografie, die das
      // Effektsystem startet. Ein Puls daneben liefe doppelt.
    });
  }

  private registerSlimeBloomEffectHandler(): void {
    bridge.registerSlimeBloomEffectHandler((x, y, targets) => {
      this.renderers.slimeTrail.playBloomBurst(x, y, targets);
    });
  }

  private registerCorpseMarkerHandler(): void {
    bridge.registerCorpseMarkerHandler((corpseId, x, y, enemySize, lifetimeMs) => {
      if (lifetimeMs <= 0) this.renderers.corpseMarker.remove(corpseId);
      else this.renderers.corpseMarker.show(corpseId, x, y, enemySize, lifetimeMs);
    });
  }

  private registerFireChunkEffectHandler(): void {
    bridge.registerFireChunkEffectHandler((x, y, targets, landsAt, visualStyle) => {
      this.renderers.flamethrowerUpgrades.playFireChunkBurst(
        x,
        y,
        targets,
        landsAt,
        bridge.getSynchronizedNow(),
        visualStyle,
      );
    });
  }

  private registerBlackHoleEffectHandler(): void {
    bridge.registerBlackHoleEffectHandler((x, y, radius, durationMs) => {
      this.renderers.blackHole.play(x, y, radius, durationMs);
    });
  }

  private registerMiniRocketCollectionEffectHandler(): void {
    bridge.registerMiniRocketCollectionEffectHandler((x, y, color) => {
      this.renderers.rocket.playCollection(x, y, color);
    });
  }

  private registerMiniRocketDestructionEffectHandler(): void {
    bridge.registerMiniRocketDestructionEffectHandler((x, y, color) => {
      this.renderers.rocket.playSpentDestruction(x, y, color);
    });
  }

  private registerGrenadeCountdownHandler(): void {
    bridge.registerGrenadeCountdownHandler((x, y, value) => {
      this.effectSystem.playCountdownText(x, y, value);
    });
  }

  private registerCoopDefenseXpPopupHandler(): void {
    bridge.registerCoopDefenseXpPopupHandler((x, y, xp) => {
      // Spectatoren erhalten weder XP noch die dazugehoerige Belohnungsdarstellung. Die
      // autoritative XP-Summe wird weiterhin einmalig auf dem Host gefuehrt; diese lokale
      // Sichtbarkeitspruefung verhindert nur, dass ein Latejoiner oder freiwilliger Spectator
      // den XP-Zuwachs als eigene Belohnung wahrnimmt.
      if (bridge.getGamePhase() === 'ARENA'
        && !bridge.canPlayerReceiveRoundRewards(bridge.getLocalPlayerId())) return;
      this.effectSystem.playCoopDefenseXpText(x, y, xp);
    });
  }

  private registerBfgLaserBatchHandler(): void {
    bridge.registerBfgLaserBatchHandler((lines, color, visualPreset, projectileId) => {
      for (const line of lines) {
        if (visualPreset === 'asmd_primary') {
          this.renderers.asmdPrimary.playTracer(line.sx, line.sy, line.ex, line.ey, color, 1.35, 'player');
        }
      }
      if (visualPreset !== 'asmd_primary' && projectileId !== undefined) {
        this.renderers.bfg.playLaserBatch(lines, projectileId);
      } else if (visualPreset !== 'asmd_primary') {
        // Compatibility fallback for batches emitted by older peers without a projectile ID.
        for (const line of lines) {
          this.effectSystem.playHitscanTracer(line.sx, line.sy, line.ex, line.ey, color, 2);
        }
      }
    });
  }

  private registerBurrowVisualHandler(): void {
    bridge.registerBurrowVisualHandler((playerId, phase) => {
      const entity = this.playerManager.getPlayer(playerId);
      if (!entity) return;
      if (phase === 'windup' || phase === 'recovery') {
        this.effectSystem.playBurrowPhaseEffect(entity.x, entity.y, phase);
      }
      entity.setBurrowPhase(phase, true);
      if (entity.displayObject) this.effectSystem.syncBurrowState(playerId, phase, entity.displayObject);
      // Keep client coordinator in sync so applyBurrowVisual() doesn't re-trigger
      this.clientUpdate.setBurrowPhase(playerId, phase);
    });
  }

  private registerShockwaveEffectHandler(): void {
    bridge.registerShockwaveEffectHandler((x, y) => {
      this.effectSystem.playShockwaveEffect(x, y);
    });
  }

  private registerTrainBurrowSparksHandler(): void {
    bridge.registerTrainBurrowSparksHandler((x, y) => {
      this.effectSystem.playTrainBurrowSparks(x, y);
    });
  }

  private registerShotFxHandler(): void {
    bridge.registerShotFxHandler((shooterId, duration, intensity) => {
      if (shooterId !== bridge.getLocalPlayerId()) return;
      // Rückstoß bleibt ungerichtet: die RPC trägt nur Dauer und Stärke, keine Schussrichtung.
      // `legacyShakeAmplitudePx` hält die aus der Waffenkonfiguration stammenden Werte gültig.
      this.visualFeedback.camera.request({
        channel: 'impact',
        amplitudePx: legacyShakeAmplitudePx(intensity),
        durationMs: duration,
        priority: CAMERA_FEEDBACK_PRIORITY.weaponRecoil,
        decay: 'impulse',
      });
    });
  }

  private registerTranslocatorFlashHandler(): void {
    bridge.registerTranslocatorFlashHandler((x, y, color, type, subjectId) => {
      this.renderers.translocatorTeleport?.playFlash(x, y, color, type);
      if (type === 'end') {
        this.gameAudioSystem.playSound('sfx_translocator_teleport', x, y);
        // Globale Bildreaktion nur beim eigenen Sprung – ein fremder Teleport am anderen
        // Arenaende darf das eigene Bild nicht umfärben.
        if (subjectId === bridge.getLocalPlayerId()) {
          this.visualFeedback.pulsePostFx('teleport');
        }
      }
    });
  }

  private registerColorHandlers(): void {
    bridge.registerColorRequestHandler((color, id) => {
      bridge.hostHandleColorRequest(color, id);
    });
    bridge.registerColorAcceptedHandler((id, _color) => {
      if (id === bridge.getLocalPlayerId()) {
        this.leftPanel.onColorAccepted();
      }
      this.leftPanel.refreshColorPickerIfOpen();
    });
    bridge.registerColorDeniedHandler((id) => {
      if (id === bridge.getLocalPlayerId()) {
        this.leftPanel.onColorDenied();
      }
    });
    bridge.registerColorChangeHandler((_id, _color) => {
      this.leftPanel.refreshColorPickerIfOpen();
    });
  }

  private registerKillEventHandler(): void {
    bridge.registerKillEventHandler(event => {
      this.rightPanel.addKillFeedEntry(
        event.killerName, event.killerColor,
        event.sourceId,
        event.victimName, event.victimColor,
      );

      const localId = bridge.getLocalPlayerId();
      if (event.victimId === localId) {
        this.centerHUD.showFraggedBy(event.killerName, event.sourceId, event.killerColor);
        return;
      }
      if (event.killerId === localId) {
        this.centerHUD.showYouFragged(event.victimName, event.victimColor);
      }
    });
  }

  private registerTrainDestroyedHandler(): void {
    bridge.registerTrainDestroyedHandler(() => {
      this.train.markDestroyed();
      this.centerHUD.showTrainDestroyed();
      this.gameAudioSystem.playLocalSound('sfx_train_explode');
    });
  }

  private registerPickupPowerUpHandler(): void {
    bridge.registerPickupPowerUpHandler((uid, playerId) => {
      if (bridge.isArenaCountdownActive()) return false;
      if (!this.capabilities.get(playerId).canInteract) return false;
      const player = this.playerManager.getPlayer(playerId);
      if (!player) return false;
      const pickedUp = this.playerLoadout.tryPickupPowerUp(playerId, uid, player.x, player.y);
      if (pickedUp) this.gameAudioSystem.playSound('sfx_pickup_powerup', player.x, player.y, playerId);
      return pickedUp;
    });
  }
}
