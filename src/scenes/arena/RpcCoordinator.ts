import type Phaser from 'phaser';
import { bridge }            from '../../network/bridge';
import type { ArenaContext }        from './ArenaContext';
import type { RendererBundle }      from './RendererBundle';
import type { ClientUpdateCoordinator } from './ClientUpdateCoordinator';
import type { ArenaLifecycleCoordinator } from './ArenaLifecycleCoordinator';
import type { LeftSidePanel }       from '../../ui/LeftSidePanel';
import type { ExplosionVisualStyle } from '../../types';
import { CAMERA_FEEDBACK_PRIORITY, legacyShakeAmplitudePx } from '../../effects/camera/cameraFeedbackPresets';

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

/**
 * Registers all bridge RPC handlers in one place.
 *
 * Handlers that need the lifecycle coordinator (e.g., train-destroyed) receive it
 * via setLifecycle() after construction to avoid circular dependencies between
 * RpcCoordinator and ArenaLifecycleCoordinator.
 */
export class RpcCoordinator {
  private lifecycle: ArenaLifecycleCoordinator | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ctx: ArenaContext,
    private readonly renderers: RendererBundle,
    private readonly clientUpdate: ClientUpdateCoordinator,
    private readonly leftPanel: LeftSidePanel,
  ) {}

  setLifecycle(lifecycle: ArenaLifecycleCoordinator): void {
    this.lifecycle = lifecycle;
  }

  registerAll(): void {
    this.registerDashHandler();
    this.registerBurrowRpcHandler();
    this.registerDecoyStealthBreakHandler();
    this.registerLoadoutUseHandler();
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
  }

  private registerDashHandler(): void {
    bridge.registerDashHandler((playerId, dx, dy) => {
      if (!bridge.isHost()) return;
      if (bridge.getGamePhase() !== 'ARENA') return;
      if (!bridge.canPlayerAct(playerId)) return;
      if (bridge.isArenaCountdownActive()) return;
      this.ctx.hostPhysics.handleDashRPC(playerId, dx, dy);
    });
  }

  private registerBurrowRpcHandler(): void {
    bridge.registerBurrowHandler((playerId, wantsBurrowed) => {
      if (!bridge.isHost()) return;
      if (bridge.getGamePhase() !== 'ARENA') return;
      if (!bridge.canPlayerAct(playerId)) return;
      if (bridge.isArenaCountdownActive()) return;
      this.ctx.burrowSystem?.handleBurrowRequest(playerId, wantsBurrowed);
    });
  }

  private registerDecoyStealthBreakHandler(): void {
    bridge.registerDecoyStealthBreakHandler((playerId) => {
      if (!bridge.isHost()) return;
      if (bridge.getGamePhase() !== 'ARENA') return;
      if (!bridge.canPlayerAct(playerId)) return;
      const player = this.ctx.playerManager.getPlayer(playerId);
      if (player) this.ctx.gameAudioSystem.playSound('sfx_decoy_reveal', player.sprite.x, player.sprite.y, playerId);
      this.ctx.decoySystem.breakStealth(playerId, Date.now());
    });
  }

  private registerLoadoutUseHandler(): void {
    bridge.registerLoadoutUseHandler((slot, angle, targetX, targetY, senderId, shotId, params, clientX, clientY, clientNow) => {
      if (!bridge.isHost()) return { ok: false, reason: 'blocked' };
      if (!bridge.canPlayerAct(senderId)) return { ok: false, reason: 'blocked' };
      if (bridge.isArenaCountdownActive()) return { ok: false, reason: 'blocked' };
      const committed = bridge.getPlayerCommittedLoadout(senderId);
      if (committed?.coopDefenseClassId === 'inspector_gadachs') {
        // Rueckbau belegt keinen Ausruestungsplatz und traegt deshalb keinen toolRef.
        if (params?.dismantle) {
          if (slot !== 'utility' || params.toolRef || params.constructionId !== undefined) {
            return { ok: false, reason: 'invalid' };
          }
          return this.lifecycle?.dismantleInspectorConstruction(senderId, targetX, targetY)
            ?? { ok: false, reason: 'blocked' };
        }
        // A regular utility packet is only valid for a temporary special-pickup
        // override; normal Inspector utilities must carry their typed ref.
        if (slot === 'utility' && !params?.toolRef
          && bridge.getPlayerUtilityOverrideName(senderId) === '') {
          return { ok: false, reason: 'blocked' };
        }
      } else if (params?.dismantle) {
        return { ok: false, reason: 'invalid' };
      }
      if (params?.toolRef) {
        if (slot !== 'utility' || committed?.coopDefenseClassId !== 'inspector_gadachs') {
          return { ok: false, reason: 'invalid' };
        }
        if (params.toolRef.kind === 'construction') {
          if (!params.constructionId || params.toolRef.id !== params.constructionId) {
            return { ok: false, reason: 'invalid' };
          }
          return this.lifecycle?.placeInspectorConstruction(
            senderId,
            params.constructionId,
            targetX,
            targetY,
          ) ?? { ok: false, reason: 'blocked' };
        }
        if (params.constructionId !== undefined) return { ok: false, reason: 'invalid' };
        return this.lifecycle?.useInspectorUtility(
          senderId,
          params.toolRef,
          angle,
          targetX,
          targetY,
          Date.now(),
          params,
        ) ?? { ok: false, reason: 'blocked' };
      }
      // Legacy construction packets from older clients remain accepted during
      // the migration, but still pass through the same host validation.
      if (slot === 'weapon2' && params?.constructionId) {
        return this.lifecycle?.placeInspectorConstruction(
          senderId,
          params.constructionId,
          targetX,
          targetY,
        ) ?? { ok: false, reason: 'blocked' };
      }
      return this.ctx.loadoutManager?.use(slot, senderId, angle, targetX, targetY, clientNow ?? Date.now(), shotId, params, clientX, clientY)
        ?? { ok: false, reason: 'blocked' };
    });
  }

  private registerCaptureTheBeerFxHandler(): void {
    bridge.registerCaptureTheBeerFxHandler((event) => {
      this.renderers.beer.playFx(event);
      if (event.kind === 'score') {
        this.ctx.centerHUD.showBeerCaptured(event.scorerName, event.scorerColor);
        this.ctx.gameAudioSystem.playLocalSound('sfx_ctb_score');
      }
    });
  }

  private registerCoopDefenseCarryDeliveredFxHandler(): void {
    bridge.registerCoopDefenseCarryDeliveredFxHandler((x, y) => {
      this.renderers.beer.playCoopDefenseCarryDeliveredFx(x, y);
      this.ctx.gameAudioSystem.playLocalSound('sfx_ctb_score');
    });
  }

  private registerExplosionEffectHandler(): void {
    bridge.registerExplosionEffectHandler((x, y, radius, color, visualStyle) => {
      this.ctx.effectSystem.playExplosionEffect(x, y, radius, color, visualStyle);
      const audio = resolveExplosionAudio(visualStyle);
      if (audio) this.ctx.gameAudioSystem.playSound(audio.key, x, y, undefined, audio.scale);
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
      this.ctx.effectSystem.playCountdownText(x, y, value);
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
      this.ctx.effectSystem.playCoopDefenseXpText(x, y, xp);
    });
  }

  private registerBfgLaserBatchHandler(): void {
    bridge.registerBfgLaserBatchHandler((lines, color, visualPreset) => {
      for (const line of lines) {
        if (visualPreset === 'asmd_primary') {
          this.renderers.asmdPrimary.playTracer(line.sx, line.sy, line.ex, line.ey, color, 1.35, 'player');
        } else {
          this.ctx.effectSystem.playHitscanTracer(line.sx, line.sy, line.ex, line.ey, color, 2);
        }
      }
    });
  }

  private registerBurrowVisualHandler(): void {
    bridge.registerBurrowVisualHandler((playerId, phase) => {
      const entity = this.ctx.playerManager.getPlayer(playerId);
      if (!entity) return;
      if (phase === 'windup' || phase === 'recovery') {
        this.ctx.effectSystem.playBurrowPhaseEffect(entity.sprite.x, entity.sprite.y, phase);
      }
      entity.setBurrowPhase(phase, true);
      this.ctx.effectSystem.syncBurrowState(playerId, phase, entity.sprite);
      // Keep client coordinator in sync so applyBurrowVisual() doesn't re-trigger
      this.clientUpdate.setBurrowPhase(playerId, phase);
    });
  }

  private registerShockwaveEffectHandler(): void {
    bridge.registerShockwaveEffectHandler((x, y) => {
      this.ctx.effectSystem.playShockwaveEffect(x, y);
    });
  }

  private registerTrainBurrowSparksHandler(): void {
    bridge.registerTrainBurrowSparksHandler((x, y) => {
      this.ctx.effectSystem.playTrainBurrowSparks(x, y);
    });
  }

  private registerShotFxHandler(): void {
    bridge.registerShotFxHandler((shooterId, duration, intensity) => {
      if (shooterId !== bridge.getLocalPlayerId()) return;
      // Rückstoß bleibt ungerichtet: die RPC trägt nur Dauer und Stärke, keine Schussrichtung.
      // `legacyShakeAmplitudePx` hält die aus der Waffenkonfiguration stammenden Werte gültig.
      this.ctx.visualFeedback.camera.request({
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
        this.ctx.gameAudioSystem.playSound('sfx_translocator_teleport', x, y);
        // Globale Bildreaktion nur beim eigenen Sprung – ein fremder Teleport am anderen
        // Arenaende darf das eigene Bild nicht umfärben.
        if (subjectId === bridge.getLocalPlayerId()) {
          this.ctx.visualFeedback.pulsePostFx('teleport');
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
      this.ctx.rightPanel.addKillFeedEntry(
        event.killerName, event.killerColor,
        event.weapon,
        event.victimName, event.victimColor,
      );

      const localId = bridge.getLocalPlayerId();
      if (event.victimId === localId) {
        this.ctx.centerHUD.showFraggedBy(event.killerName, event.weapon, event.killerColor);
        return;
      }
      if (event.killerId === localId) {
        this.ctx.centerHUD.showYouFragged(event.victimName, event.victimColor);
      }
    });
  }

  private registerTrainDestroyedHandler(): void {
    bridge.registerTrainDestroyedHandler(() => {
      this.lifecycle?.onTrainDestroyed();
      this.ctx.centerHUD.showTrainDestroyed();
      this.ctx.gameAudioSystem.playLocalSound('sfx_train_explode');
    });
  }

  private registerPickupPowerUpHandler(): void {
    bridge.registerPickupPowerUpHandler((uid, playerId) => {
      if (!bridge.canPlayerAct(playerId)) return false;
      const player = this.ctx.playerManager.getPlayer(playerId);
      if (!player) return false;
      const pickedUp = this.ctx.powerUpSystem?.tryPickup(playerId, uid, player.sprite.x, player.sprite.y) ?? false;
      if (pickedUp) this.ctx.gameAudioSystem.playSound('sfx_pickup_powerup', player.sprite.x, player.sprite.y, playerId);
      return pickedUp;
    });
  }
}
