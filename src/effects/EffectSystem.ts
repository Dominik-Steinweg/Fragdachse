import * as Phaser from 'phaser';
import { t } from '../i18n';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { BurrowPhase, ExplosionVisualStyle, HitscanImpactKind, HitscanVisualPreset, SyncedCombatEffect, SyncedDeathEffect, SyncedHitEffect, SyncedHitscanTrace, SyncedMeleeSwing } from '../types';
import { BLOOD_HIT_VFX, COLORS, DAMAGE_VIGNETTE_VFX, DEPTH, DEPTH_FX, DEPTH_TRACE, GAME_HEIGHT, GAME_WIDTH, PLAYER_SIZE, PLASMA_BURNER_COLOR, SHOCKWAVE_RADIUS, clipPointToArenaRay, getBeamPaletteForPlayerColor, isPointInsideArena, toCssColor } from '../config';
import {
  TEX_BLOOD_EDGE_BOTTOM,
  TEX_BLOOD_EDGE_LEFT,
  TEX_BLOOD_EDGE_RIGHT,
  TEX_BLOOD_EDGE_TOP,
  ensureBloodEdgeTextures,
  ensureBloodHitTextures,
  spawnBloodStain,
} from './BloodEffectShared';
import { circleZone, edgeZone, ensureCanvasTexture, makeAdditive, mixColors, registerGraphicsObject, registerParticleEmitter } from './EffectUtils';
import {
  FLAME_JET_TINTS_COOL,
  FLAME_JET_TINTS_HOT,
  FLAME_JET_TINTS_MID,
  ensureFlameTextures,
} from './FlameShared';
import { AsmdPrimaryRenderer } from './AsmdPrimaryRenderer';
import { PlasmaBurnerRenderer } from './PlasmaBurnerRenderer';
import { BiteRenderer } from './BiteRenderer';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import type { EnemyVisualSink } from '../entities/EnemyManager';
import { SpawnEffectRenderer } from './SpawnEffectRenderer';
import type { MuzzleFlashRenderer } from './MuzzleFlashRenderer';
import type { LightingSystem } from './LightingSystem';
import type { HitFeedbackRenderer } from './HitFeedbackRenderer';
import type { CameraFeedbackController } from './camera/CameraFeedbackController';
import type { CameraPostFxController } from './postfx/CameraPostFxController';
import type { NukeVariant } from './nuke/NukeChoreography';
import type { CombatExplosionVisualStyle } from './ExplosionVisualProfiles';

/** Schmaler Ausschnitt der Regie fuer mehrphasige Explosionssequenzen. */
interface ExplosionSequenceHost {
  startNukeSequence(options: {
    variant: NukeVariant;
    x: number;
    y: number;
    radiusPx: number;
    onSkyFlash?: (alpha: number) => void;
    onFinished?: () => void;
  }): boolean;
  startExplosionShockwave(options: {
    x: number;
    y: number;
    radiusPx: number;
    style: CombatExplosionVisualStyle;
  }): boolean;
  hasActiveNukeSequence(): boolean;
}
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { impactExceptional, impactHeavy, impactLight } from './camera/cameraFeedbackPresets';
import {
  EXPLOSION_LIGHT_MIN_OCCLUDING_RADIUS,
  EXPLOSION_LIGHT_RADIUS_FACTOR,
  getExplosionLightDurationMs,
} from './LightingConfig';
import { ZeusTaserRenderer } from './ZeusTaserRenderer';
import type { BloodStainSink, CombatGoreGpuRenderer } from './CombatGoreGpuRenderer';
import {
  TEX_EXPLOSION_SPARK,
  ensureExplosionEmberTexture,
  ensureExplosionSparkTexture,
} from './gpu/GpuVfxSourceTextures';
import {
  isDestructiveExplosionStyle,
  type ExplosionCombatPalette,
  type ExplosionGpuRenderer,
} from './ExplosionGpuRenderer';
import { isThermalExplosionStyle } from './ExplosionVisualProfiles';

const HITSCAN_TRACER_FADE_MS = 320;
const MELEE_SWING_FADE_MS    = 220;

/** Abstand der Lichtstützpunkte entlang eines Hitscan-Strahls. */
const HITSCAN_LIGHT_SPACING_PX = 190;
const MAX_HITSCAN_LIGHTS = 4;

const TEX_BURROW_DIRT = '__burrow_dirt';
const TEX_BURROW_DUST = '__burrow_dust';
const DEPTH_BLOOD_STAIN = DEPTH.PLAYERS - 0.05;
const DEPTH_DAMAGE_VIGNETTE = DEPTH.OVERLAY - 1;

interface BurrowEmitterVisual {
  dirt: Phaser.GameObjects.Particles.ParticleEmitter;
  dust: Phaser.GameObjects.Particles.ParticleEmitter;
}

/**
 * Die Buddel-Effekte werden nicht nur für Spieler, sondern auch für eingebuddelte Coop-Defense-
 * Gegner genutzt; `implements` hält die dafür erwartete Signatur kompilierzeit-fest.
 */
export class EffectSystem implements EnemyVisualSink {
  private pendingPredictedTracerIds = new Map<number, number>();
  private processedSyncedTracerKeys = new Map<string, number>();
  private processedMeleeSwingKeys   = new Map<string, number>();
  private burrowVisuals = new Map<string, BurrowEmitterVisual>();
  private muzzleFlashRenderer: MuzzleFlashRenderer | null = null;
  private asmdPrimaryRenderer: AsmdPrimaryRenderer | null = null;
  private plasmaBurnerRenderer: PlasmaBurnerRenderer | null = null;
  private biteRenderer: BiteRenderer | null = null;
  private zeusTaserRenderer: ZeusTaserRenderer | null = null;
  private lighting: LightingSystem | null = null;
  private hitFeedbackRenderer: HitFeedbackRenderer | null = null;
  private cameraFeedback: CameraFeedbackController | null = null;
  private postFx: CameraPostFxController | null = null;
  private visualFeedback: ExplosionSequenceHost | null = null;
  private spawnEffectRenderer: SpawnEffectRenderer | null = null;
  private audioSystem: GameAudioSystem | null = null;
  private explosionGpuRenderer: ExplosionGpuRenderer | null = null;
  private combatGoreGpuRenderer: CombatGoreGpuRenderer | null = null;
  private playerDeathResolver: ((targetId: string) => boolean) | null = null;
  private readonly scheduleBloodStainSink: BloodStainSink = (...args) => {
    this.scheduleBloodStain(...args);
  };
  private texturesGenerated = false;
  private damageVignetteTop:    Phaser.GameObjects.Image | null = null;
  private damageVignetteBottom: Phaser.GameObjects.Image | null = null;
  private damageVignetteLeft:   Phaser.GameObjects.Image | null = null;
  private damageVignetteRight:  Phaser.GameObjects.Image | null = null;

  constructor(
    private scene:  Phaser.Scene,
    private bridge: NetworkBridge,
  ) {
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  setMuzzleFlashRenderer(renderer: MuzzleFlashRenderer | null): void {
    this.muzzleFlashRenderer = renderer;
  }

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
    this.spawnEffectRenderer?.setLightingSystem(lighting);
  }

  setHitFeedbackRenderer(renderer: HitFeedbackRenderer | null): void {
    this.hitFeedbackRenderer = renderer;
  }

  /** Alle Kamerabewegungen dieses Systems laufen über den zentralen Controller, nie über `camera.shake()`. */
  setCameraFeedback(controller: CameraFeedbackController | null): void {
    this.cameraFeedback = controller;
  }

  setPostFx(controller: CameraPostFxController | null): void {
    this.postFx = controller;
  }

  /** Mehrphasige Nuke- und lokale Explosionsregie ueber eine schmale Schnittstelle. */
  setVisualFeedback(director: ExplosionSequenceHost | null): void {
    this.visualFeedback = director;
  }

  /** Gegner-Spawn: dieselbe Effektfamilie wie beim Spielerspawn, nur zurückhaltender. */
  playEnemySpawnEffect(x: number, y: number, colorHex: number): void {
    if (!this.spawnEffectRenderer) {
      this.spawnEffectRenderer = new SpawnEffectRenderer(this.scene);
      this.spawnEffectRenderer.setLightingSystem(this.lighting);
    }
    this.spawnEffectRenderer.playEnemy(x, y, colorHex);
  }

  setAsmdPrimaryRenderer(renderer: AsmdPrimaryRenderer | null): void {
    this.asmdPrimaryRenderer = renderer;
  }

  setPlasmaBurnerRenderer(renderer: PlasmaBurnerRenderer | null): void {
    this.plasmaBurnerRenderer = renderer;
  }

  setBiteRenderer(renderer: BiteRenderer | null): void {
    this.biteRenderer = renderer;
  }

  setZeusTaserRenderer(renderer: ZeusTaserRenderer | null): void {
    this.zeusTaserRenderer = renderer;
  }

  setAudioSystem(system: GameAudioSystem | null): void {
    this.audioSystem = system;
  }

  setExplosionGpuRenderer(renderer: ExplosionGpuRenderer | null): void {
    this.explosionGpuRenderer = renderer;
  }

  setCombatGoreGpuRenderer(renderer: CombatGoreGpuRenderer | null): void {
    this.combatGoreGpuRenderer = renderer;
  }

  /** Resolves player deaths without putting an entity-kind flag on the replicated effect. */
  setPlayerDeathResolver(resolver: ((targetId: string) => boolean) | null): void {
    this.playerDeathResolver = resolver;
  }

  playLocalShotAudio(key: string | undefined): void {
    this.audioSystem?.playLocalSound(key);
  }

  destroy(): void {
    this.damageVignetteTop?.destroy();
    this.damageVignetteBottom?.destroy();
    this.damageVignetteLeft?.destroy();
    this.damageVignetteRight?.destroy();
    this.damageVignetteTop    = null;
    this.damageVignetteBottom = null;
    this.damageVignetteLeft   = null;
    this.damageVignetteRight  = null;
    this.combatGoreGpuRenderer = null;
    this.playerDeathResolver = null;
  }

  /** Erzeugt kleine Canvas-Texturen für Explosions-Partikel (einmalig). */
  private ensureTextures(): void {
    if (this.texturesGenerated) return;
    this.texturesGenerated = true;
    ensureFlameTextures(this.scene);
    ensureExplosionSparkTexture(this.scene);
    ensureExplosionEmberTexture(this.scene);

    if (!this.scene.textures.exists(TEX_BURROW_DIRT)) {
      const dirtCanvas = this.scene.textures.createCanvas(TEX_BURROW_DIRT, 10, 10);
      if (dirtCanvas) {
        const ctx = dirtCanvas.context;
        const gradient = ctx.createRadialGradient(5, 5, 1, 5, 5, 5);
        gradient.addColorStop(0, 'rgba(126, 88, 58, 1)');
        gradient.addColorStop(0.7, 'rgba(79, 58, 42, 0.85)');
        gradient.addColorStop(1, 'rgba(38, 31, 28, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 10, 10);
        dirtCanvas.refresh();
      }
    }

    if (!this.scene.textures.exists(TEX_BURROW_DUST)) {
      const dustCanvas = this.scene.textures.createCanvas(TEX_BURROW_DUST, 14, 14);
      if (dustCanvas) {
        const ctx = dustCanvas.context;
        const gradient = ctx.createRadialGradient(7, 7, 1, 7, 7, 7);
        gradient.addColorStop(0, 'rgba(145, 122, 100, 0.9)');
        gradient.addColorStop(0.55, 'rgba(87, 75, 66, 0.55)');
        gradient.addColorStop(1, 'rgba(42, 39, 37, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 14, 14);
        dustCanvas.refresh();
      }
    }

    ensureBloodHitTextures(this.scene);
    // Die Schadensvignette teilt sich die Kantentexturen mit der Blutdarstellung bei wenig
    // Leben: Treffer und Dauerzustand sollen erkennbar dasselbe Blut sein, nicht zwei
    // verschiedene rote Rahmen.
    ensureBloodEdgeTextures(this.scene);

  }

  private playTrainExplosionEffect(x: number, y: number, radius: number, color?: number): void {
    const fillColor = color ?? 0xff5a1e;
    const haloColor = this.mixColor(fillColor, 0xffffff, 0.52);
    const startRadius = Math.max(6, radius * 0.11);

    const flash = this.scene.add.circle(x, y, startRadius, 0xffffe2, 1);
    registerGraphicsObject(this.scene, 'effectSystemGraphics', flash);
    flash.setDepth(DEPTH_FX + 1);
    makeAdditive(flash);
    this.scene.tweens.add({
      targets: flash,
      scaleX: (radius * 0.62) / startRadius,
      scaleY: (radius * 0.62) / startRadius,
      alpha: 0,
      duration: 150,
      ease: 'Expo.easeOut',
      onComplete: () => flash.destroy(),
    });

    // Der große Zugblitz belichtet die Szene mit, ähnlich wie die Nuke-Regie. Er wird
    // nur einmal für die Mittel-Detonation erzeugt, nicht für jeden einzelnen Waggon.
    if (radius >= 140) {
      const skyFlash = this.scene.add.rectangle(
        GAME_WIDTH * 0.5,
        GAME_HEIGHT * 0.5,
        GAME_WIDTH,
        GAME_HEIGHT,
        0xffedc7,
        0.18,
      );
      registerGraphicsObject(this.scene, 'effectSystemGraphics', skyFlash);
      skyFlash.setScrollFactor(0);
      skyFlash.setDepth(DEPTH.OVERLAY - 2);
      makeAdditive(skyFlash);
      this.scene.tweens.add({
        targets: skyFlash,
        alpha: 0,
        duration: 360,
        ease: 'Quad.easeOut',
        onComplete: () => skyFlash.destroy(),
      });
    }

    this.spawnCombatExplosionGpu(x, y, radius, 'train', fillColor, 0xffffe2, haloColor);

    if (radius >= 140) {
      this.cameraFeedback?.request(impactExceptional({ sourceX: x, sourceY: y }));
    }
  }

  /** RPC-Handler registrieren – Effekte werden bei ALLEN Clients (inkl. Host) abgespielt. */
  setup(onLocalConfirmedHit?: () => void): void {
    this.ensureTextures();

    this.bridge.registerEffectHandler((effect: SyncedCombatEffect) => {
      if (effect.type === 'hit') {
        if (effect.shooterId === this.bridge.getLocalPlayerId()) {
          onLocalConfirmedHit?.();
          this.audioSystem?.queueHitFeedback(effect.totalDamage);
        }
        this.playHitEffect(effect);
        // Läuft auf jedem Client inklusive Host, deshalb sehen alle dieselbe Zielreaktion.
        this.hitFeedbackRenderer?.playHit(effect);
        this.audioSystem?.queueDamageFeedback(effect.totalDamage, effect.x, effect.y);
        if (effect.targetId === this.bridge.getLocalPlayerId()) {
          this.playDamageVignette(effect);
        }
      }
      if (effect.type === 'death') {
        this.playDeathEffect(effect);
        // Der eigene Tod lässt die Welt zurücktreten, damit die Auswertung im Vordergrund steht.
        if (effect.targetId === this.bridge.getLocalPlayerId()) {
          this.postFx?.pulseEvent('localDeath');
        }
      }
    });

    this.bridge.registerHitscanTracerHandler((startX, startY, endX, endY, color, thickness, impactKind, visualPreset, shooterId, shotId, shotAudioKey, visualStartX, visualStartY) => {
      this.playSyncedHitscanTracer({
        startX,
        startY,
        endX,
        endY,
        color,
        thickness,
        impactKind,
        visualPreset,
        shooterId,
        shotId,
        shotAudioKey,
        visualStartX,
        visualStartY,
      });
    });

    this.bridge.registerMeleeSwingHandler((swing) => {
      this.playSyncedMeleeSwing(swing);
    });
  }

  // ── Treffer-Effekt: gerichteter Blood-Splatter ───────────────────────────

  /**
   * Spielt einen Treffer rein lokal ab – Blutspritzer, Zielreaktion und Trefferton.
   *
   * Gedacht für Treffer ohne replizierte Quelle, etwa die Ambient-Inszenierung der Lobby.
   * Ausgelassen wird ausschliesslich, was einen echten lokalen Spieler voraussetzt: die
   * Schadensvignette und die Bestätigung des eigenen Treffers.
   */
  playLocalHitEffect(effect: SyncedHitEffect): void {
    this.playHitEffect(effect);
    this.hitFeedbackRenderer?.playHit(effect);
    this.audioSystem?.queueDamageFeedback(effect.totalDamage, effect.x, effect.y);
  }

  private playHitEffect(effect: SyncedHitEffect): void {
    this.ensureTextures();
    this.combatGoreGpuRenderer?.playHit(effect, this.scheduleBloodStainSink);

    if (effect.isCritical) {
      const criticalRing = this.scene.add.circle(effect.x, effect.y, 9, 0xffd15c, 0.2)
        .setStrokeStyle(2.5, 0xfff3b0, 0.95)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(DEPTH_FX + 0.35);
      registerGraphicsObject(this.scene, 'effectSystemGraphics', criticalRing);
      const criticalLabel = this.scene.add.text(effect.x, effect.y - 18, t('ui.combat.critical'), {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '12px',
        color: '#fff3b0',
        stroke: '#7a3200',
        strokeThickness: 3,
      })
        .setOrigin(0.5)
        .setDepth(DEPTH_FX + 0.4);
      this.scene.tweens.add({
        targets: criticalRing,
        radius: 25,
        alpha: 0,
        duration: 260,
        ease: 'Cubic.easeOut',
        onComplete: () => criticalRing.destroy(),
      });
      this.scene.tweens.add({
        targets: criticalLabel,
        y: criticalLabel.y - 14,
        alpha: 0,
        scaleX: 1.15,
        scaleY: 1.15,
        duration: 480,
        ease: 'Cubic.easeOut',
        onComplete: () => criticalLabel.destroy(),
      });
    }

  }

  // ── Dash-Trail-Effekt ─────────────────────────────────────────────────────

  /**
   * Trail-Geist: verblassende Sprite-Kopie während Phase 1 eines Dashs.
   * Gegner reichen ihren eigenen Texturschlüssel und ihre Kantenlänge durch, damit ihr
   * Ausweichschritt genauso aussieht wie der Spieler-Dash.
   */
  playDashTrailGhost(
    x: number,
    y: number,
    color: number,
    scale: number,
    rotation: number,
    textureKey = 'badger',
    baseSize = PLAYER_SIZE,
  ): void {
    const ghost = this.scene.add.image(x, y, textureKey);
    ghost.setDisplaySize(baseSize * scale, baseSize * scale);
    ghost.setRotation(rotation);
    ghost.setTint(color);
    ghost.setAlpha(0.45);
    ghost.setDepth(DEPTH_FX - 1);
    this.scene.tweens.add({
      targets:    ghost,
      alpha:      0,
      duration:   150,
      ease:       'Linear',
      onComplete: () => ghost.destroy(),
    });
  }

  // ── Schockwellen-Effekt: expandierender Goldring (Unburrow) ─────────────

  playShockwaveEffect(x: number, y: number): void {
    this.ensureTextures();

    const startRadius = 10;
    const endScale = SHOCKWAVE_RADIUS / startRadius;

    const coreFlash = this.scene.add.circle(x, y, 12, 0xe7c59a, 0.65);
    registerGraphicsObject(this.scene, 'effectSystemGraphics', coreFlash);
    coreFlash.setDepth(DEPTH_FX + 0.3);
    makeAdditive(coreFlash);
    this.scene.tweens.add({
      targets:    coreFlash,
      scaleX:     2.6,
      scaleY:     2.6,
      alpha:      0,
      duration:   180,
      ease:       'Cubic.easeOut',
      onComplete: () => coreFlash.destroy(),
    });

    const innerRing = this.scene.add.circle(x, y, startRadius, 0, 0);
    registerGraphicsObject(this.scene, 'effectSystemGraphics', innerRing);
    innerRing.setDepth(DEPTH_FX + 0.2);
    innerRing.setStrokeStyle(5, 0x8d5e3b, 0.85);
    this.scene.tweens.add({
      targets:    innerRing,
      scaleX:     endScale,
      scaleY:     endScale,
      alpha:      0,
      duration:   360,
      ease:       'Cubic.easeOut',
      onComplete: () => innerRing.destroy(),
    });

    const dustRing = this.scene.add.circle(x, y, startRadius * 0.9, 0, 0);
    registerGraphicsObject(this.scene, 'effectSystemGraphics', dustRing);
    dustRing.setDepth(DEPTH_FX + 0.1);
    dustRing.setStrokeStyle(9, 0x3f342d, 0.42);
    this.scene.tweens.add({
      targets:    dustRing,
      scaleX:     endScale * 1.08,
      scaleY:     endScale * 1.08,
      alpha:      0,
      duration:   430,
      ease:       'Quart.easeOut',
      onComplete: () => dustRing.destroy(),
    });

    const dirtBurst = this.scene.add.particles(x, y, TEX_BURROW_DIRT, {
      lifespan: { min: 280, max: 420 },
      speed: { min: 70, max: 170 },
      scale: { start: 0.8, end: 0.05 },
      alpha: { start: 0.9, end: 0 },
      rotate: { min: -120, max: 120 },
      frequency: -1,
      quantity: 22,
      blendMode: Phaser.BlendModes.NORMAL,
    });
    dirtBurst.setDepth(DEPTH_FX + 0.25);
    dirtBurst.addEmitZone(edgeZone(10, 22));
    dirtBurst.explode(22);
    this.scene.time.delayedCall(500, () => dirtBurst.destroy());

    const dustBurst = this.scene.add.particles(x, y, TEX_BURROW_DUST, {
      lifespan: { min: 320, max: 520 },
      speed: { min: 28, max: 95 },
      scale: { start: 1.3, end: 0.1 },
      alpha: { start: 0.45, end: 0 },
      quantity: 14,
      frequency: -1,
    });
    dustBurst.setDepth(DEPTH_FX + 0.15);
    dustBurst.addEmitZone(circleZone(10, 14));
    dustBurst.explode(14);
    this.scene.time.delayedCall(540, () => dustBurst.destroy());
  }

  // ── Funken-Effekt: Dachs buddelt unter dem Zug ───────────────────────────

  playTrainBurrowSparks(x: number, y: number): void {
    this.ensureTextures();
    const sparks = registerParticleEmitter(this.scene, 'effectSystem', this.scene.add.particles(x, y, TEX_EXPLOSION_SPARK, {
      lifespan:  { min: 150, max: 320 },
      speed:     { min: 60,  max: 180 },
      angle:     { min: 0,   max: 360 },
      scale:     { start: 0.9, end: 0 },
      alpha:     { start: 1,   end: 0 },
      tint:      [0xffd700, 0xff8c00, 0xffa500, 0xffff00],
      blendMode: Phaser.BlendModes.ADD,
      frequency: -1,
      quantity:  7,
    }));
    sparks.setDepth(DEPTH_FX + 0.35);
    sparks.explode(7);
    this.scene.time.delayedCall(400, () => { if (sparks.active) sparks.destroy(); });
  }

  playStealthTransitionEffect(x: number, y: number, revealing: boolean, color: number = COLORS.GREY_2): void {
    this.ensureTextures();
    const particleCount = revealing ? 28 : 22;
    const core = this.scene.add.circle(x, y, revealing ? 16 : 12, color, revealing ? 0.34 : 0.24);
    registerGraphicsObject(this.scene, 'effectSystemGraphics', core);
    core.setDepth(DEPTH_FX + 0.2);
    makeAdditive(core);
    this.scene.tweens.add({
      targets: core,
      scaleX: revealing ? 3.2 : 2.3,
      scaleY: revealing ? 3.2 : 2.3,
      alpha: 0,
      duration: revealing ? 380 : 320,
      ease: 'Cubic.easeOut',
      onComplete: () => core.destroy(),
    });

    const ring = this.scene.add.circle(x, y, revealing ? 16 : 12, 0, 0);
    registerGraphicsObject(this.scene, 'effectSystemGraphics', ring);
    ring.setDepth(DEPTH_FX + 0.16);
    ring.setStrokeStyle(revealing ? 6 : 5, color, revealing ? 0.7 : 0.54);
    makeAdditive(ring);
    this.scene.tweens.add({
      targets: ring,
      scaleX: revealing ? 3.8 : 2.6,
      scaleY: revealing ? 3.8 : 2.6,
      alpha: 0,
      duration: revealing ? 440 : 360,
      ease: 'Quart.easeOut',
      onComplete: () => ring.destroy(),
    });

    const outerRing = this.scene.add.circle(x, y, revealing ? 22 : 18, 0, 0);
    registerGraphicsObject(this.scene, 'effectSystemGraphics', outerRing);
    outerRing.setDepth(DEPTH_FX + 0.12);
    outerRing.setStrokeStyle(revealing ? 10 : 8, color, revealing ? 0.24 : 0.18);
    this.scene.tweens.add({
      targets: outerRing,
      scaleX: revealing ? 2.6 : 2.1,
      scaleY: revealing ? 2.6 : 2.1,
      alpha: 0,
      duration: revealing ? 520 : 420,
      ease: 'Cubic.easeOut',
      onComplete: () => outerRing.destroy(),
    });

    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.32;
      const travel = Phaser.Math.Between(revealing ? 24 : 14, revealing ? 68 : 42);
      const size = Phaser.Math.Between(2, 5);
      const pixel = this.scene.add.rectangle(x, y, size, size, color, revealing ? 0.82 : 0.6);
      registerGraphicsObject(this.scene, 'effectSystemGraphics', pixel);
      pixel.setDepth(DEPTH_FX + 0.1);
      pixel.setRotation(Math.random() * Math.PI);
      makeAdditive(pixel);

      this.scene.tweens.add({
        targets: pixel,
        x: x + Math.cos(angle) * travel,
        y: y + Math.sin(angle) * travel,
        alpha: 0,
        angle: Phaser.Math.Between(-160, 160),
        duration: revealing ? 440 : 340,
        ease: 'Quad.easeOut',
        onComplete: () => pixel.destroy(),
      });
    }

    const dust = this.scene.add.particles(x, y, TEX_BURROW_DUST, {
      lifespan: { min: 260, max: 520 },
      speed: { min: 18, max: revealing ? 110 : 72 },
      scale: { start: revealing ? 1.05 : 0.78, end: 0.05 },
      alpha: { start: revealing ? 0.44 : 0.3, end: 0 },
      quantity: particleCount,
      frequency: -1,
      tint: { min: color, max: color },
    });
    dust.setDepth(DEPTH_FX + 0.05);
    dust.addEmitZone(circleZone(revealing ? 8 : 6, particleCount));
    dust.explode(particleCount);
    this.scene.time.delayedCall(560, () => dust.destroy());

    const spark = this.scene.add.particles(x, y, '_living_blob', {
      lifespan: { min: 180, max: 360 },
      speed: { min: 20, max: revealing ? 160 : 110 },
      scale: { start: revealing ? 0.95 : 0.7, end: 0.02 },
      alpha: { start: revealing ? 0.62 : 0.46, end: 0 },
      quantity: revealing ? 18 : 12,
      frequency: -1,
      tint: [color],
      blendMode: Phaser.BlendModes.ADD,
    });
    spark.setDepth(DEPTH_FX + 0.22);
    spark.addEmitZone(circleZone(revealing ? 10 : 8, revealing ? 18 : 12));
    spark.explode(revealing ? 18 : 12);
    this.scene.time.delayedCall(420, () => spark.destroy());
  }

  syncBurrowState(playerId: string, phase: BurrowPhase, sprite?: Phaser.GameObjects.Image): void {
    if ((phase === 'underground' || phase === 'trapped') && sprite) {
      this.ensureBurrowVisual(playerId, sprite);
      return;
    }

    if (phase === 'idle' || phase === 'recovery' || phase === 'windup') {
      this.clearBurrowState(playerId);
    }
  }

  clearBurrowState(playerId: string): void {
    const visual = this.burrowVisuals.get(playerId);
    if (!visual) return;

    visual.dirt.stop();
    visual.dust.stop();
    this.scene.time.delayedCall(500, () => {
      visual.dirt.destroy();
      visual.dust.destroy();
    });
    this.burrowVisuals.delete(playerId);
  }

  clearAllBurrowStates(): void {
    for (const playerId of [...this.burrowVisuals.keys()]) {
      this.clearBurrowState(playerId);
    }
  }

  private ensureBurrowVisual(playerId: string, sprite: Phaser.GameObjects.Image): void {
    const existing = this.burrowVisuals.get(playerId);
    if (existing) {
      return;
    }

    this.ensureTextures();

    const dirt = this.scene.add.particles(0, 0, TEX_BURROW_DIRT, {
      lifespan: { min: 300, max: 440 },
      speed: { min: 32, max: 88 },
      scale: { start: 0.9, end: 0.08 },
      alpha: { start: 0.9, end: 0 },
      frequency: 36,
      quantity: 3,
      rotate: { min: -90, max: 90 },
    });
    dirt.setDepth(DEPTH_FX - 0.2);
    dirt.addEmitZone(circleZone(12, 2));
    dirt.startFollow(sprite);

    const dust = this.scene.add.particles(0, 0, TEX_BURROW_DUST, {
      lifespan: { min: 340, max: 500 },
      speed: { min: 18, max: 56 },
      scale: { start: 1.2, end: 0.14 },
      alpha: { start: 0.42, end: 0 },
      frequency: 58,
      quantity: 2,
    });
    dust.setDepth(DEPTH_FX - 0.25);
    dust.addEmitZone(circleZone(14, 1));
    dust.startFollow(sprite);

    this.burrowVisuals.set(playerId, { dirt, dust });
  }

  playBurrowPhaseEffect(x: number, y: number, phase: BurrowPhase): void {
    this.ensureTextures();

    if (phase === 'windup') {
      const ring = this.scene.add.circle(x, y + 2, 12, 0, 0);
      registerGraphicsObject(this.scene, 'effectSystemGraphics', ring);
      ring.setDepth(DEPTH_FX + 0.05);
      ring.setStrokeStyle(4, 0x6f4a33, 0.8);
      this.scene.tweens.add({
        targets: ring,
        scaleX: 1.35,
        scaleY: 0.7,
        alpha: 0,
        duration: 150,
        ease: 'Cubic.easeIn',
        onComplete: () => ring.destroy(),
      });

      const dirtBurst = this.scene.add.particles(x, y + 2, TEX_BURROW_DIRT, {
        lifespan: { min: 160, max: 280 },
        speed: { min: 20, max: 66 },
        scale: { start: 0.55, end: 0.04 },
        alpha: { start: 0.7, end: 0 },
        frequency: -1,
        quantity: 10,
      });
      dirtBurst.setDepth(DEPTH_FX + 0.08);
      dirtBurst.addEmitZone(circleZone(8, 10));
      dirtBurst.explode(10);
      this.scene.time.delayedCall(320, () => dirtBurst.destroy());
      return;
    }

    if (phase === 'recovery') {
      const plume = this.scene.add.particles(x, y, TEX_BURROW_DUST, {
        lifespan: { min: 220, max: 380 },
        speed: { min: 26, max: 96 },
        scale: { start: 1, end: 0.08 },
        alpha: { start: 0.55, end: 0 },
        frequency: -1,
        quantity: 14,
      });
      plume.setDepth(DEPTH_FX + 0.1);
      plume.addEmitZone(circleZone(9, 14));
      plume.explode(14);
      this.scene.time.delayedCall(400, () => plume.destroy());
    }
  }

  // ── Granaten-Explosions-Effekt (überarbeitet: Flash + Blast + Ring + Partikel) ──
  /**
   * @param radius       Explosionsradius in px (visuell 1:1 match mit Schadensradius)
   * @param color        Optionale Farbe (Default stilabhaengig)
   * @param visualStyle  Default | holy | energy
   */
  playExplosionEffect(x: number, y: number, radius: number, color?: number, visualStyle: ExplosionVisualStyle = 'default'): void {
    this.ensureTextures();
    this.emitExplosionLight(x, y, radius, color, visualStyle);

    if (visualStyle === 'train') {
      this.playTrainExplosionEffect(x, y, radius, color);
      return;
    }

    if (visualStyle === 'lightning') {
      this.playLightningExplosionEffect(x, y, radius, color ?? 0x78dfff);
      return;
    }

    if (visualStyle === 'regeneration') {
      this.playRegenerationEffect(x, y, radius, color ?? PLASMA_BURNER_COLOR);
      return;
    }

    if (visualStyle === 'brood_hatch') {
      this.playBroodHatchEffect(x, y, radius, color ?? 0x94c95b);
      return;
    }

    if (visualStyle === 'timebomb_pop') {
      const popColor = color ?? 0xb82fff;
      const core = this.scene.add.circle(x, y, 5, 0xf3d9ff, 0.9).setDepth(DEPTH_FX + 0.4);
      registerGraphicsObject(this.scene, 'effectSystemGraphics', core);
      makeAdditive(core);
      this.scene.tweens.add({
        targets: core,
        scaleX: Math.max(1, radius / 8),
        scaleY: Math.max(1, radius / 8),
        alpha: 0,
        duration: 190,
        ease: 'Expo.easeOut',
        onComplete: () => core.destroy(),
      });
      this.spawnCombatExplosionGpu(x, y, radius, 'timebomb_pop', popColor, 0xf3d9ff, 0xd58aff);
      return;
    }

    const isHoly = visualStyle === 'holy';
    const isTimebomb = visualStyle === 'timebomb';
    const isEnergy = visualStyle === 'energy' || isTimebomb;
    const isVoidNuke = visualStyle === 'void_nuke';
    const isNuke = visualStyle === 'nuke' || isVoidNuke;
    const fillColor = isHoly
      ? 0xf0c53a
      : (color ?? (isTimebomb ? 0xb82fff : (isEnergy ? 0x73bed3 : (isVoidNuke ? 0xa631ff : (isNuke ? 0xffb347 : 0xff2200)))));
    const flashColor = isTimebomb ? 0xf5dcff : (isEnergy ? 0xe8fbff : (isHoly ? 0xfff8de : (isVoidNuke ? 0xf4dcff : (isNuke ? 0xfff2cc : 0xffffcc))));
    const haloColor = isEnergy
      ? this.mixColor(fillColor, 0xffffff, 0.45)
      : (isHoly ? 0xffef9a : (isNuke ? this.mixColor(fillColor, 0xffffff, 0.35) : this.mixColor(fillColor, 0xffffff, 0.2)));
    this.spawnCombatExplosionGpu(x, y, radius, visualStyle, fillColor, flashColor, haloColor);
    const startRadius = 8;
    if (isNuke) {
      const skyFlash = this.scene.add.rectangle(
        GAME_WIDTH * 0.5,
        GAME_HEIGHT * 0.5,
        GAME_WIDTH,
        GAME_HEIGHT,
        isVoidNuke ? 0xc76cff : 0xfff1cf,
        0.24,
      );
      registerGraphicsObject(this.scene, 'nukeTelegraphs', skyFlash);
      skyFlash.setScrollFactor(0);
      skyFlash.setDepth(DEPTH.OVERLAY - 2);
      makeAdditive(skyFlash);

      // Der Blitz ist der Belichtungsstoß der Detonationsphase und wird deshalb von der
      // Choreografie getrieben, nicht von einem eigenen Tween daneben. Ohne laufende Regie
      // (keine Kamerafilter, `low`) bleibt der Tween als Rückfallebene.
      const sequenceStarted = this.visualFeedback?.startNukeSequence({
        variant: isVoidNuke ? 'void' : 'normal',
        x,
        y,
        radiusPx: radius,
        onSkyFlash: (alpha) => skyFlash.setAlpha(alpha * 0.24),
        onFinished: () => skyFlash.destroy(),
      }) ?? false;

      if (!sequenceStarted) {
        this.scene.tweens.add({
          targets:    skyFlash,
          alpha:      0,
          duration:   420,
          ease:       'Quad.easeOut',
          onComplete: () => skyFlash.destroy(),
        });
      }
    }

    const flash = this.scene.add.circle(x, y, startRadius, flashColor, 1);
    registerGraphicsObject(this.scene, 'effectSystemGraphics', flash);
    flash.setDepth(DEPTH_FX + 1);
    const flashEndScale = (radius * 0.3) / startRadius;
    this.scene.tweens.add({
      targets:    flash,
      scaleX:     isEnergy ? flashEndScale * 1.2 : (isNuke ? flashEndScale * 1.5 : flashEndScale),
      scaleY:     isEnergy ? flashEndScale * 1.2 : (isNuke ? flashEndScale * 1.5 : flashEndScale),
      alpha:      0,
      duration:   isEnergy ? 180 : (isNuke ? 240 : 150),
      ease:       'Power3Out',
      onComplete: () => flash.destroy(),
    });

    if (isHoly) {
      const skyFlash = this.scene.add.rectangle(GAME_WIDTH * 0.5, GAME_HEIGHT * 0.5, GAME_WIDTH, GAME_HEIGHT, 0xffefc4, 0.18);
      registerGraphicsObject(this.scene, 'effectSystemGraphics', skyFlash);
      skyFlash.setScrollFactor(0);
      skyFlash.setDepth(DEPTH.OVERLAY - 2);
      makeAdditive(skyFlash);
      this.scene.tweens.add({
        targets:    skyFlash,
        alpha:      0,
        duration:   260,
        ease:       'Quad.easeOut',
        onComplete: () => skyFlash.destroy(),
      });

    }

    if (isHoly) {
      const verticalBeam = this.scene.add.rectangle(x, y, Math.max(radius * 0.16, 20), radius * 0.95, 0xfff4d0, 0.24);
      registerGraphicsObject(this.scene, 'effectSystemGraphics', verticalBeam);
      verticalBeam.setDepth(DEPTH_FX + 0.3);
      makeAdditive(verticalBeam);
      const horizontalBeam = this.scene.add.rectangle(x, y, radius * 0.95, Math.max(radius * 0.16, 20), 0xffe0a4, 0.2);
      registerGraphicsObject(this.scene, 'effectSystemGraphics', horizontalBeam);
      horizontalBeam.setDepth(DEPTH_FX + 0.31);
      makeAdditive(horizontalBeam);
      this.scene.tweens.add({
        targets:    [verticalBeam, horizontalBeam],
        scaleX:     1.25,
        scaleY:     1.25,
        alpha:      0,
        duration:   420,
        ease:       'Quad.easeOut',
        onComplete: () => {
          verticalBeam.destroy();
          horizontalBeam.destroy();
        },
      });

      this.cameraFeedback?.request(impactHeavy({ sourceX: x, sourceY: y }));
    } else if (isEnergy) {
      this.cameraFeedback?.request(impactLight({ sourceX: x, sourceY: y }));
    } else if (isNuke && !this.visualFeedback?.hasActiveNukeSequence()) {
      // Der Einschlag der Nuke gehört zur Choreografie. Nur wenn die nicht läuft (`low`),
      // springt der Einzeleffekt als Rückfallebene ein – sonst schlüge er doppelt zu.
      this.cameraFeedback?.request(impactExceptional({ sourceX: x, sourceY: y }));
    }
  }

  /**
   * Lichtstoß einer Explosion. Einziger Aufrufer von `playExplosionEffect` ist der
   * `RpcCoordinator`, deshalb sehen Host und Clients denselben Blitz.
   *
   * Große Explosionen werfen echte Schatten: Felsen, Baumstämme und Basen blocken den
   * Zusatzlichtanteil, sodass der Bereich dahinter am Tag unbeleuchtet bleibt statt
   * mit aufzuhellen. Kleine Detonationen bekommen nur Licht, kein Verdeckungspass.
   */
  private emitExplosionLight(
    x: number,
    y: number,
    radius: number,
    color: number | undefined,
    visualStyle: ExplosionVisualStyle,
  ): void {
    if (!this.lighting) return;

    // Heiße Kernfarben statt satter Flammentöne: unter dem MULTIPLY-Composite der Nacht
    // begrenzt der schwächste Kanal, wie hell der Boden werden kann. Ein Feuerorange
    // bliebe selbst bei voller Intensität ein rötlicher Schleier. Der Weißanteil ist
    // aber nur so hoch wie nötig – darüber verliert die Detonation ihren warmen Ton.
    const lightColor = visualStyle === 'train'
      ? mixColors(color ?? 0xff5a1e, 0xffffff, 0.72)
      : visualStyle === 'lightning'
      ? 0xcdf1ff
      : visualStyle === 'regeneration'
        ? mixColors(color ?? PLASMA_BURNER_COLOR, 0xffffff, 0.45)
        : visualStyle === 'energy'
          ? 0xd4f2fc
          : visualStyle === 'holy'
            ? 0xffefbe
            : visualStyle === 'nuke' || visualStyle === 'void_nuke'
              ? (visualStyle === 'void_nuke' ? 0xe0b8ff : 0xffe4b8)
              : mixColors(color ?? 0xff5a1e, 0xffffff, 0.6);

    this.lighting.pulse('explosion', x, y, {
      // Größe skaliert durchgehend mit der Detonation – auch bei sehr großen Radien,
      // dort verzichtet das Licht stattdessen auf seinen Schattenwurf.
      radiusPx: radius * (visualStyle === 'train' ? 2.8 : EXPLOSION_LIGHT_RADIUS_FACTOR),
      color: lightColor,
      intensity: 1,
      // Die authored Explosionsgröße bestimmt Reichweite und Lebensdauer gemeinsam. Die
      // Stilvariante bleibt bei Farbe und Darstellung, bringt aber keine Sonderdauer mit.
      durationMs: getExplosionLightDurationMs(radius),
      occludes: radius >= EXPLOSION_LIGHT_MIN_OCCLUDING_RADIUS,
    });
  }

  private playLightningExplosionEffect(x: number, y: number, radius: number, color: number): void {
    const coreColor = this.mixColor(color, 0xffffff, 0.72);
    const outerColor = this.mixColor(color, 0x3557d6, 0.32);

    const flash = this.scene.add.circle(x, y, Math.max(5, radius * 0.12), 0xffffff, 0.92);
    registerGraphicsObject(this.scene, 'effectSystemGraphics', flash);
    flash.setDepth(DEPTH_FX + 0.45);
    makeAdditive(flash);
    this.scene.tweens.add({
      targets: flash,
      scale: 2.8,
      alpha: 0,
      duration: 170,
      ease: 'Expo.easeOut',
      onComplete: () => flash.destroy(),
    });

    const arcs = this.scene.add.graphics();
    registerGraphicsObject(this.scene, 'effectSystemGraphics', arcs);
    arcs.setDepth(DEPTH_FX + 0.35);
    makeAdditive(arcs);
    const arcCount = Math.max(8, Math.ceil(radius / 7));
    for (let arcIndex = 0; arcIndex < arcCount; arcIndex += 1) {
      const angle = (arcIndex / arcCount) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.18, 0.18);
      const length = radius * Phaser.Math.FloatBetween(0.72, 1.12);
      const segments = Phaser.Math.Between(4, 7);
      arcs.lineStyle(arcIndex % 3 === 0 ? 3 : 1.5, arcIndex % 2 === 0 ? coreColor : color, 0.92);
      arcs.beginPath();
      arcs.moveTo(x, y);
      for (let segment = 1; segment <= segments; segment += 1) {
        const progress = segment / segments;
        const normalJitter = segment === segments ? 0 : Phaser.Math.FloatBetween(-radius * 0.09, radius * 0.09);
        const px = x + Math.cos(angle) * length * progress - Math.sin(angle) * normalJitter;
        const py = y + Math.sin(angle) * length * progress + Math.cos(angle) * normalJitter;
        arcs.lineTo(px, py);
      }
      arcs.strokePath();
    }
    this.scene.tweens.add({
      targets: arcs,
      alpha: 0,
      duration: 330,
      ease: 'Quad.easeOut',
      onComplete: () => arcs.destroy(),
    });

    this.spawnCombatExplosionGpu(x, y, radius, 'lightning', color, coreColor, outerColor);
  }

  private spawnCombatExplosionGpu(
    x: number,
    y: number,
    radius: number,
    style: ExplosionVisualStyle,
    bodyColor: number,
    coreColor: number,
    hotColor: number,
  ): void {
    if (!this.explosionGpuRenderer || !isDestructiveExplosionStyle(style)) return;

    const energyLike = style === 'energy' || style === 'timebomb' || style === 'timebomb_pop' || style === 'lightning';
    const voidLike = style === 'void_nuke';
    const holyLike = style === 'holy';
    const thermalLike = isThermalExplosionStyle(style);
    const palette: ExplosionCombatPalette = {
      core: thermalLike ? 0xfff2d0 : coreColor,
      hot: thermalLike ? FLAME_JET_TINTS_HOT[2] : hotColor,
      body: thermalLike ? FLAME_JET_TINTS_MID[1] : bodyColor,
      outer: thermalLike
        ? FLAME_JET_TINTS_COOL[0]
        : this.mixColor(bodyColor, holyLike ? 0xa86912 : (voidLike ? 0x25162e : (energyLike ? 0x15243b : 0x3a1710)), 0.54),
      ember: thermalLike
        ? FLAME_JET_TINTS_COOL[3]
        : this.mixColor(bodyColor, holyLike ? 0x7a4610 : (voidLike ? 0x160c22 : (energyLike ? 0x20345b : 0x61200d)), 0.62),
      smoke: this.mixColor(bodyColor, voidLike ? 0x130f1d : (energyLike ? 0x17223a : 0x282528), 0.82),
    };
    this.explosionGpuRenderer.spawnCombatExplosion({ x, y, radius, style, palette });
    this.visualFeedback?.startExplosionShockwave({ x, y, radiusPx: radius, style });
  }

  /** Organisches Aufbrechen statt Kampfdetonation; bleibt bewusst ausserhalb der GPU-Profile. */
  private playBroodHatchEffect(x: number, y: number, radius: number, color: number): void {
    const brightColor = this.mixColor(color, 0xf5ffd8, 0.48);
    const lobeCount = 5;
    for (let index = 0; index < lobeCount; index += 1) {
      const angle = index / lobeCount * Math.PI * 2 + Phaser.Math.FloatBetween(-0.16, 0.16);
      const lobe = this.scene.add.ellipse(
        x + Math.cos(angle) * radius * 0.08,
        y + Math.sin(angle) * radius * 0.08,
        Math.max(7, radius * 0.22),
        Math.max(12, radius * 0.46),
        index % 2 === 0 ? brightColor : color,
        0.42,
      );
      registerGraphicsObject(this.scene, 'effectSystemGraphics', lobe);
      lobe.setDepth(DEPTH_FX + 0.12).setRotation(angle + Math.PI * 0.5);
      this.scene.tweens.add({
        targets: lobe,
        x: x + Math.cos(angle) * radius * 0.72,
        y: y + Math.sin(angle) * radius * 0.72,
        scaleX: 0.35,
        scaleY: 1.28,
        alpha: 0,
        duration: 460,
        ease: 'Cubic.easeOut',
        onComplete: () => lobe.destroy(),
      });
    }
  }

  /**
   * Regenerationsstoss des Plasmabrenners: kein Blast, sondern ein kurzer gruener Puls
   * mit aufsteigenden Funken. Bewusst klein und ohne Kamerawirkung – der Effekt markiert
   * eine Heilung und darf im Gefecht nicht mit einer Detonation verwechselt werden.
   */
  private playRegenerationEffect(x: number, y: number, radius: number, color: number): void {
    const brightColor = this.mixColor(color, 0xffffff, 0.55);
    const startRadius = Math.max(5, radius * 0.3);

    const core = this.scene.add.circle(x, y, startRadius, brightColor, 0.75);
    registerGraphicsObject(this.scene, 'effectSystemGraphics', core);
    core.setDepth(DEPTH_FX + 0.4);
    makeAdditive(core);
    this.scene.tweens.add({
      targets: core,
      scale: (radius * 0.7) / startRadius,
      alpha: 0,
      duration: 260,
      ease: 'Sine.easeOut',
      onComplete: () => core.destroy(),
    });

    // Zwei nach aussen laufende Ringe: die Doppelung liest sich als Puls, nicht als Druckwelle.
    for (let ringIndex = 0; ringIndex < 2; ringIndex += 1) {
      const ring = this.scene.add.circle(x, y, startRadius);
      registerGraphicsObject(this.scene, 'effectSystemGraphics', ring);
      ring.setFillStyle(0, 0);
      ring.setStrokeStyle(ringIndex === 0 ? 2.4 : 1.4, ringIndex === 0 ? brightColor : color, 0.85);
      ring.setDepth(DEPTH_FX + 0.3 - ringIndex * 0.02);
      makeAdditive(ring);
      this.scene.tweens.add({
        targets: ring,
        scale: (radius * (ringIndex === 0 ? 0.95 : 1.25)) / startRadius,
        alpha: 0,
        delay: ringIndex * 90,
        duration: 420,
        ease: 'Cubic.easeOut',
        onComplete: () => ring.destroy(),
      });
    }

    // Aufsteigende Partikel statt radialem Auswurf – die Bewegungsrichtung allein
    // unterscheidet Heilung von Schaden, auch wenn beides gleichzeitig auf dem Ziel liegt.
    this.explosionGpuRenderer?.spawnRegeneration(
      x,
      y,
      radius,
      Math.max(8, Math.ceil(radius * 0.4)),
      color,
      brightColor,
    );
  }

  private mixColor(source: number, target: number, t: number): number {
    const a = Phaser.Display.Color.IntegerToRGB(source);
    const b = Phaser.Display.Color.IntegerToRGB(target);
    return Phaser.Display.Color.GetColor(
      Math.round(a.r + (b.r - a.r) * t),
      Math.round(a.g + (b.g - a.g) * t),
      Math.round(a.b + (b.b - a.b) * t),
    );
  }

  // ── Countdown-Text (aufsteigende verblassende Zahl) ─────────────────────────
  /**
   * Zeigt eine Countdown-Zahl, die nach oben schwebt und verblasst.
   * Wird von NukeRenderer und Granaten-Countdown gemeinsam genutzt.
   */
  playCountdownText(x: number, y: number, value: number): void {
    const label = this.scene.add.text(x, y - 20, String(value), {
      fontFamily: 'monospace',
      fontSize:   '34px',
      color:      '#ebede9',
      stroke:     '#241527',
      strokeThickness: 5,
    });
    label.setOrigin(0.5);
    label.setDepth(DEPTH.OVERLAY - 5);

    this.scene.tweens.add({
      targets:    label,
      y:          y - 64,
      alpha:      0,
      duration:   850,
      ease:       'Quad.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  playCoopDefenseXpText(x: number, y: number, xp: number): void {
    const resolvedXp = Math.max(0, Math.floor(xp));
    if (resolvedXp <= 0) return;

    // Schriftgröße logarithmisch nach XP skalieren:
    //   1 XP  → 18 px  
    //  10 XP  → 33 px
    // 100 XP  → 48 px  
    // Formel: 18 + 15 * log10(max(1, xp))  →  Bereich 18..~60
    const logFactor = Math.log(Math.max(1, resolvedXp)) / Math.log(10); // log10 via ln
    const fontSize = Math.round(Math.min(60, 18 + 15 * logFactor));
    const strokeThickness = Math.round(3 + (fontSize - 18) / 8);

    const label = this.scene.add.text(x, y - 18, `+${resolvedXp} XP`, {
      fontFamily: 'monospace',
      fontSize: '${fontSize}px',
      fontStyle: 'bold',
      color: toCssColor(COLORS.GOLD_1),
      stroke: '#241527',
      strokeThickness,
    });
    label.setOrigin(0.5);
    label.setDepth(DEPTH.OVERLAY - 5);

    this.scene.tweens.add({
      targets: label,
      y: y - 64,
      alpha: 0,
      duration: 950,
      ease: 'Quad.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  playHitscanTracer(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    playerColor: number,
    thickness: number,
    impactKind: HitscanImpactKind = 'environment',
    visualPreset: HitscanVisualPreset = 'default',
    beamId?: string,
  ): void {
    this.ensureTextures();
    const clippedEnd = clipPointToArenaRay(startX, startY, endX, endY);
    const renderEndX = clippedEnd.x;
    const renderEndY = clippedEnd.y;
    const clippedDx = renderEndX - endX;
    const clippedDy = renderEndY - endY;
    const clippedByArena = (clippedDx * clippedDx) + (clippedDy * clippedDy) > 0.25;
    const resolvedImpactKind: HitscanImpactKind = impactKind === 'none' && clippedByArena ? 'environment' : impactKind;
    const palette = getBeamPaletteForPlayerColor(playerColor);

    this.emitHitscanBeamLight(startX, startY, renderEndX, renderEndY, playerColor, visualPreset);

    if (visualPreset === 'plasma_burner' && this.plasmaBurnerRenderer) {
      this.plasmaBurnerRenderer.playTracer(startX, startY, renderEndX, renderEndY, playerColor, thickness, resolvedImpactKind, beamId);
      return;
    }

    if (visualPreset === 'asmd_primary' && this.asmdPrimaryRenderer) {
      this.asmdPrimaryRenderer.playTracer(startX, startY, renderEndX, renderEndY, playerColor, thickness, resolvedImpactKind);
      return;
    }

    this.muzzleFlashRenderer?.playHitscanFlash(startX, startY, renderEndX - startX, renderEndY - startY, visualPreset, playerColor);

    const gfx = this.scene.add.graphics();
    registerGraphicsObject(this.scene, 'effectSystemGraphics', gfx);
    gfx.setDepth(DEPTH_TRACE);
    this.strokeTracer(gfx, palette.shadow, Math.max(thickness + 6, 6), 0.20, startX, startY, renderEndX, renderEndY);
    this.strokeTracer(gfx, palette.glow, Math.max(thickness + 3, 4), 0.45, startX, startY, renderEndX, renderEndY);
    this.strokeTracer(gfx, palette.core, Math.max(thickness, 2), 0.95, startX, startY, renderEndX, renderEndY);

    gfx.fillStyle(palette.glow, 0.40);
    gfx.fillCircle(startX, startY, Math.max(thickness * 1.35, 4));
    gfx.fillStyle(palette.core, 0.85);
    gfx.fillCircle(startX, startY, Math.max(thickness * 0.75, 2));
    if (resolvedImpactKind !== 'none') {
      gfx.fillStyle(palette.core, 0.65);
      gfx.fillCircle(renderEndX, renderEndY, Math.max(thickness * 0.6, 2));
      this.playHitscanImpact(renderEndX, renderEndY, playerColor, thickness, resolvedImpactKind);
    }

    this.scene.tweens.add({
      targets:    gfx,
      alpha:      0,
      duration:   HITSCAN_TRACER_FADE_MS,
      ease:       'Quad.easeOut',
      onComplete: () => gfx.destroy(),
    });
  }

  playPredictedHitscanTracer(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    playerColor: number,
    thickness: number,
    shotId: number,
    impactKind: HitscanImpactKind = 'environment',
    visualPreset: HitscanVisualPreset = 'default',
    shotAudioKey?: string,
  ): void {
    this.pendingPredictedTracerIds.set(shotId, this.scene.time.now + 1000);
    this.audioSystem?.playSound(shotAudioKey, startX, startY, this.bridge.getLocalPlayerId());
    this.playHitscanTracer(
      startX,
      startY,
      endX,
      endY,
      playerColor,
      thickness,
      impactKind,
      visualPreset,
      this.bridge.getLocalPlayerId(),
    );
  }

  playSyncedHitscanTracer(trace: SyncedHitscanTrace): void {
    const { startX, startY, endX, endY, color, thickness, impactKind, visualPreset, shooterId, shotId, shotAudioKey } = trace;
    if (this.shouldSkipSyncedTracer(shooterId, shotId)) return;
    const visualStartX = trace.visualStartX ?? startX;
    const visualStartY = trace.visualStartY ?? startY;
    this.audioSystem?.playSound(shotAudioKey, visualStartX, visualStartY, shooterId);
    this.playHitscanTracer(
      visualStartX,
      visualStartY,
      endX,
      endY,
      color,
      thickness,
      impactKind ?? 'environment',
      visualPreset,
      shooterId,
    );
  }

  /**
   * Lichtstützpunkte entlang eines Hitscan-Strahls.
   *
   * Ein Strahl ist eine Linie, die Lightmap kennt aber nur runde Lichter – der Strahl
   * wird deshalb in gleichmäßigen Abständen abgetastet. Der Mündungspunkt bleibt bewusst
   * ausgespart: dort sitzt bereits das Mündungsfeuer, ein zweites Licht an derselben
   * Stelle würde nur den Kern ausbrennen.
   *
   * Die Zahl der Stützpunkte ist hart gedeckelt. Hitscan-Waffen feuern schnell, und jeder
   * Impuls belegt bis zu seinem Abklingen einen Platz im Frame-Budget.
   */
  private emitHitscanBeamLight(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    playerColor: number,
    visualPreset: HitscanVisualPreset,
  ): void {
    if (!this.lighting) return;

    // ASMD und Plasmabrenner bringen ihr eigenes Strahllicht im gemeinsamen Renderer mit.
    // Hier nur die generische Hitscan-Beleuchtung, sonst leuchten diese Varianten doppelt.
    if (visualPreset === 'asmd_primary' || visualPreset === 'plasma_burner') return;

    const dx = endX - startX;
    const dy = endY - startY;
    const length = Math.hypot(dx, dy);
    if (length < 1) return;

    const color = mixColors(playerColor, 0xffffff, 0.62);
    const steps = Phaser.Math.Clamp(Math.round(length / HITSCAN_LIGHT_SPACING_PX), 1, MAX_HITSCAN_LIGHTS);
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      this.lighting.pulse('beamPulse', startX + dx * t, startY + dy * t, { color });
    }
  }

  private playHitscanImpact(
    x: number,
    y: number,
    playerColor: number,
    thickness: number,
    impactKind: HitscanImpactKind = 'environment',
  ): void {
    if (impactKind === 'none' || !isPointInsideArena(x, y)) return;
    if (impactKind === 'environment') {
      this.audioSystem?.playSound('sfx_environment_hit', x, y);
    }
    const baseColor = this.mixColor(playerColor, 0xffffff, 0.3);
    const haloRadius = Math.max(thickness * 2.4, 7);
    const halo = this.scene.add.circle(x, y, haloRadius, baseColor, 0.24);
    registerGraphicsObject(this.scene, 'effectSystemGraphics', halo);
    halo.setDepth(DEPTH_TRACE + 0.1);
    makeAdditive(halo);
    this.scene.tweens.add({
      targets: halo,
      alpha: 0,
      scaleX: 1.8,
      scaleY: 1.8,
      duration: 90,
      ease: 'Quad.easeOut',
      onComplete: () => halo.destroy(),
    });
  }

  private consumePredictedTracerId(shotId: number): boolean {
    const now = this.scene.time.now;

    for (const [id, expiresAt] of this.pendingPredictedTracerIds) {
      if (expiresAt <= now) this.pendingPredictedTracerIds.delete(id);
    }

    if (!this.pendingPredictedTracerIds.has(shotId)) return false;
    this.pendingPredictedTracerIds.delete(shotId);
    return true;
  }

  private shouldSkipSyncedTracer(shooterId?: string, shotId?: number): boolean {
    if (shotId === undefined || !shooterId) return false;

    const now = this.scene.time.now;
    for (const [key, expiresAt] of this.processedSyncedTracerKeys) {
      if (expiresAt <= now) this.processedSyncedTracerKeys.delete(key);
    }

    const tracerKey = `${shooterId}:${shotId}`;
    if (this.processedSyncedTracerKeys.has(tracerKey)) return true;
    this.processedSyncedTracerKeys.set(tracerKey, now + 250);

    return shooterId === this.bridge.getLocalPlayerId() && this.consumePredictedTracerId(shotId);
  }

  // ── Melee-Swing-VFX: Fächerform vor dem Spieler ──────────────────────────

  /**
   * Zeichnet den sichtbaren Trefferbereich eines Melee-Angriffs:
   * - Halbtransparenter gefüllter Fächer in Spielerfarbe
   * - Leuchtende Bogenlinie + zwei Randkanten
   * - Drei Kratzer ("Klauen") als radiale Linien
   */
  playMeleeSwingEffect(
    x:           number,
    y:           number,
    angle:       number,
    arcDegrees:  number,
    range:       number,
    playerColor: number,
  ): void {
    const palette    = getBeamPaletteForPlayerColor(playerColor);
    const halfArcRad = (arcDegrees * Math.PI / 180) / 2;
    const startAngle = angle - halfArcRad;
    const endAngle   = angle + halfArcRad;

    const gfx = this.scene.add.graphics();
    registerGraphicsObject(this.scene, 'effectSystemGraphics', gfx);
    gfx.setDepth(DEPTH_FX);

    // 1. Gefüllter Sektor (Fächer)
    gfx.fillStyle(palette.glow, 0.18);
    gfx.beginPath();
    gfx.moveTo(x, y);
    gfx.arc(x, y, range, startAngle, endAngle, false);
    gfx.closePath();
    gfx.fillPath();

    // 2. Äußere Bogenlinie
    gfx.lineStyle(3, playerColor, 0.1);
    gfx.beginPath();
    gfx.arc(x, y, range, startAngle, endAngle, false);
    gfx.strokePath();

    // 3. Seitenkanten
    gfx.lineStyle(2, playerColor, 0.1);
    gfx.lineBetween(
      x, y,
      x + Math.cos(startAngle) * range,
      y + Math.sin(startAngle) * range,
    );
    gfx.lineBetween(
      x, y,
      x + Math.cos(endAngle) * range,
      y + Math.sin(endAngle) * range,
    );

    // 4. Drei Kratzer (Biss-/Klaueneffekt) als radiale Linien
    const clawOffsets = [-0.55, 0, 0.55];
    for (const t of clawOffsets) {
      const a  = angle + t * halfArcRad;
      const x0 = x + Math.cos(a) * range * 0.28;
      const y0 = y + Math.sin(a) * range * 0.28;
      const x1 = x + Math.cos(a) * range * 0.97;
      const y1 = y + Math.sin(a) * range * 0.97;
      gfx.lineStyle(2, palette.shadow, 0.50);
      gfx.lineBetween(x0, y0, x1, y1);
    }

    this.scene.tweens.add({
      targets:    gfx,
      alpha:      0,
      duration:   MELEE_SWING_FADE_MS,
      ease:       'Power2Out',
      onComplete: () => gfx.destroy(),
    });
  }

  /**
   * Spielt einen synchronisierten Melee-Swing ab.
   * Dedupliziert anhand der swingId, damit der Effekt pro Event nur einmal gerendert wird
   * (der Host-Zustand wird mehrere Frames länger gesendet als die Animation dauert).
   */
  playSyncedMeleeSwing(swing: SyncedMeleeSwing): void {
    const now = this.scene.time.now;
    const key = `${swing.shooterId}:${swing.swingId}`;

    // Abgelaufene Einträge bereinigen
    for (const [k, expiresAt] of this.processedMeleeSwingKeys) {
      if (expiresAt <= now) this.processedMeleeSwingKeys.delete(k);
    }
    if (this.processedMeleeSwingKeys.has(key)) return;
    this.processedMeleeSwingKeys.set(key, now + 500);

    this.audioSystem?.playSound(swing.shotAudioKey, swing.x, swing.y, swing.shooterId);

    if (swing.visualPreset === 'bite' && this.biteRenderer) {
      this.biteRenderer.playSwing(
        swing.x,
        swing.y,
        swing.angle,
        swing.arcDegrees,
        swing.range,
        swing.color,
        swing.hitPlayer ?? false,
        swing.impactX,
        swing.impactY,
        swing.bloodEffectMultiplier ?? 1,
      );
      return;
    }

    if (swing.visualPreset === 'zeus_taser' && this.zeusTaserRenderer) {
      // Nur der Taser leuchtet. Ein Biss und der Standard-Swing sind mechanische
      // Nahkampfschläge ohne eigene Emission und bekommen bewusst kein Licht.
      this.lighting?.pulse('electricArc', swing.x, swing.y, {
        radiusPx: Math.max(swing.range * 1.6, 120),
      });
      this.zeusTaserRenderer.playSwing(
        swing.x,
        swing.y,
        swing.angle,
        swing.arcDegrees,
        swing.range,
        swing.color,
        swing.hitPlayer ?? false,
        swing.impactX,
        swing.impactY,
      );
      return;
    }

    this.playMeleeSwingEffect(
      swing.x, swing.y,
      swing.angle, swing.arcDegrees, swing.range,
      swing.color,
    );
  }

  private spawnBloodStain(
    x: number,
    y: number,
    scale: number,
    alpha: number,
    fadeMs: number,
    tint: number,
    rotation: number,
  ): void {
    spawnBloodStain(this.scene, {
      x,
      y,
      scale,
      alpha,
      fadeMs,
      tint,
      rotation,
      depth: DEPTH_BLOOD_STAIN,
      stainDelayMs: BLOOD_HIT_VFX.stainDelayMs,
    });
  }

  /** Die dauerhafte Decal-Lifecycle bleibt CPU-seitig; nur ihr Eintreffen wird vom GPU-Flug terminiert. */
  private scheduleBloodStain(
    x: number,
    y: number,
    scale: number,
    alpha: number,
    fadeMs: number,
    tint: number,
    rotation: number,
    flightDelayMs: number,
  ): void {
    this.scene.time.delayedCall(Math.max(0, flightDelayMs), () => {
      this.spawnBloodStain(x, y, scale, alpha, fadeMs, tint, rotation);
    });
  }

  private ensureDamageVignette(): void {
    if (
      this.damageVignetteTop?.scene &&
      this.damageVignetteBottom?.scene &&
      this.damageVignetteLeft?.scene &&
      this.damageVignetteRight?.scene
    ) return;

    this.ensureTextures();

    // Klarheitskamera: die Schadensvignette ist Rückmeldung, keine Welt. Auf der Weltkamera
    // würde das Color-Grading ihr Rot mit der Tageszeit verschieben – genau die Verfälschung,
    // die Gefahrenhinweise nicht erleiden dürfen.
    const createEdge = (tex: string) => {
      const edge = this.scene.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, tex)
        .setDepth(DEPTH_DAMAGE_VIGNETTE)
        .setScrollFactor(0)
        .setTint(DAMAGE_VIGNETTE_VFX.color)
        .setAlpha(0)
        .setVisible(false);
      promoteToClarityCamera(this.scene, edge);
      return edge;
    };

    this.damageVignetteTop    = createEdge(TEX_BLOOD_EDGE_TOP);
    this.damageVignetteBottom = createEdge(TEX_BLOOD_EDGE_BOTTOM);
    this.damageVignetteLeft   = createEdge(TEX_BLOOD_EDGE_LEFT);
    this.damageVignetteRight  = createEdge(TEX_BLOOD_EDGE_RIGHT);
  }

  private playDamageVignette(effect: SyncedHitEffect): void {
    this.ensureDamageVignette();

    const top    = this.damageVignetteTop;
    const bottom = this.damageVignetteBottom;
    const left   = this.damageVignetteLeft;
    const right  = this.damageVignetteRight;
    if (!top || !bottom || !left || !right) return;

    const alpha = this.resolveDamageVignetteAlpha(effect.totalDamage);
    const sourceDirX = -effect.dirX;
    const sourceDirY = -effect.dirY;

    const currentMax = Math.max(top.alpha, bottom.alpha, left.alpha, right.alpha);
    const nextDirAlpha = Phaser.Math.Clamp(
      Math.max(currentMax, alpha) + DAMAGE_VIGNETTE_VFX.stackAlphaBonus,
      0,
      DAMAGE_VIGNETTE_VFX.maxAlpha,
    );
    const frameAlpha = nextDirAlpha * DAMAGE_VIGNETTE_VFX.frameAlphaRatio;

    top   .setVisible(true).setAlpha(Phaser.Math.Clamp(frameAlpha + nextDirAlpha * Math.max(0, -sourceDirY), 0, DAMAGE_VIGNETTE_VFX.maxAlpha));
    bottom.setVisible(true).setAlpha(Phaser.Math.Clamp(frameAlpha + nextDirAlpha * Math.max(0, sourceDirY),  0, DAMAGE_VIGNETTE_VFX.maxAlpha));
    left  .setVisible(true).setAlpha(Phaser.Math.Clamp(frameAlpha + nextDirAlpha * Math.max(0, -sourceDirX), 0, DAMAGE_VIGNETTE_VFX.maxAlpha));
    right .setVisible(true).setAlpha(Phaser.Math.Clamp(frameAlpha + nextDirAlpha * Math.max(0, sourceDirX),  0, DAMAGE_VIGNETTE_VFX.maxAlpha));

    this.scene.tweens.killTweensOf(top);
    this.scene.tweens.killTweensOf(bottom);
    this.scene.tweens.killTweensOf(left);
    this.scene.tweens.killTweensOf(right);

    this.scene.tweens.add({
      targets: [top, bottom, left, right],
      alpha: 0,
      duration: DAMAGE_VIGNETTE_VFX.durationMs,
      ease: 'Quad.easeOut',
      onComplete: () => {
        top.setVisible(false);
        bottom.setVisible(false);
        left.setVisible(false);
        right.setVisible(false);
      },
    });
  }

  private resolveDamageVignetteAlpha(totalDamage: number): number {
    if (totalDamage <= DAMAGE_VIGNETTE_VFX.damageMid) {
      const t = Phaser.Math.Clamp(
        (totalDamage - DAMAGE_VIGNETTE_VFX.damageFloor)
          / Math.max(1, DAMAGE_VIGNETTE_VFX.damageMid - DAMAGE_VIGNETTE_VFX.damageFloor),
        0,
        1,
      );
      return Phaser.Math.Linear(DAMAGE_VIGNETTE_VFX.alphaMin, DAMAGE_VIGNETTE_VFX.alphaMid, t);
    }

    const t = Phaser.Math.Clamp(
      (totalDamage - DAMAGE_VIGNETTE_VFX.damageMid)
        / Math.max(1, DAMAGE_VIGNETTE_VFX.damageCeil - DAMAGE_VIGNETTE_VFX.damageMid),
      0,
      1,
    );
    return Phaser.Math.Linear(DAMAGE_VIGNETTE_VFX.alphaMid, DAMAGE_VIGNETTE_VFX.alphaMax, t);
  }

  // ── Todes-Effekt: GPU-Pixel-Disintegration ───────────────────────────────

  private playDeathEffect(effect: SyncedDeathEffect): void {
    this.ensureTextures();
    const isPlayerDeath = this.playerDeathResolver?.(effect.targetId) === true;
    this.combatGoreGpuRenderer?.playDeath(effect, isPlayerDeath);
    if (isPlayerDeath) {
      this.playPlayerDeathAnimation(effect.x, effect.y);
    }
  }

  private playPlayerDeathAnimation(x: number, y: number): void {
    const sprite = this.scene.add.sprite(x, y, 'dachs_death');
    sprite.setOrigin(0.5, 1);
    sprite.setDepth(DEPTH_FX + 0.1);
    sprite.setPosition(x, y + PLAYER_SIZE / 2);
    sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => sprite.destroy());
    sprite.play('player_death');
  }

  private strokeTracer(
    gfx: Phaser.GameObjects.Graphics,
    color: number,
    width: number,
    alpha: number,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
  ): void {
    gfx.lineStyle(width, color, alpha);
    gfx.beginPath();
    gfx.moveTo(startX, startY);
    gfx.lineTo(endX, endY);
    gfx.strokePath();
  }
}
