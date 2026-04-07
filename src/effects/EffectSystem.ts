import Phaser from 'phaser';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { BurrowPhase, ExplosionVisualStyle, HitscanImpactKind, HitscanVisualPreset, SyncedCombatEffect, SyncedDeathEffect, SyncedHitEffect, SyncedHitscanTrace, SyncedMeleeSwing } from '../types';
import { BLOOD_HIT_VFX, COLORS, DAMAGE_VIGNETTE_VFX, DEATH_DISINTEGRATION_VFX, DEPTH, DEPTH_FX, DEPTH_TRACE, GAME_HEIGHT, GAME_WIDTH, PLAYER_SIZE, SHOCKWAVE_RADIUS, clipPointToArenaRay, getBeamPaletteForPlayerColor, isPointInsideArena } from '../config';
import { circleZone, createSeededRandom, edgeZone, ensureCanvasTexture, mixColors } from './EffectUtils';
import { AsmdPrimaryRenderer } from './AsmdPrimaryRenderer';
import { BiteRenderer } from './BiteRenderer';
import type { ShotAudioSystem } from '../audio/ShotAudioSystem';
import type { MuzzleFlashRenderer } from './MuzzleFlashRenderer';
import { ZeusTaserRenderer } from './ZeusTaserRenderer';

const HITSCAN_TRACER_FADE_MS = 320;
const MELEE_SWING_FADE_MS    = 220;

const TEX_BURROW_DIRT = '__burrow_dirt';
const TEX_BURROW_DUST = '__burrow_dust';
const TEX_EXPLOSION_SPARK = '__explosion_spark';
const TEX_EXPLOSION_EMBER = '__explosion_ember';
const TEX_BLOOD_DROPLET = '__blood_droplet';
const TEX_BLOOD_STREAK = '__blood_streak';
const TEX_BLOOD_STAIN = '__blood_stain';
const TEX_DAMAGE_VIGNETTE_TOP    = '__damage_vignette_top';
const TEX_DAMAGE_VIGNETTE_BOTTOM = '__damage_vignette_bottom';
const TEX_DAMAGE_VIGNETTE_LEFT   = '__damage_vignette_left';
const TEX_DAMAGE_VIGNETTE_RIGHT  = '__damage_vignette_right';
const TEX_DEATH_PIXEL_GLOW = '__death_pixel_glow';

const DEPTH_BLOOD_STAIN = DEPTH.PLAYERS - 0.05;
const DEPTH_DAMAGE_VIGNETTE = DEPTH.OVERLAY - 1;

interface BurrowEmitterVisual {
  dirt: Phaser.GameObjects.Particles.ParticleEmitter;
  dust: Phaser.GameObjects.Particles.ParticleEmitter;
}

interface DeathPixelChunk {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  color: number;
  brightness: number;
}

export class EffectSystem {
  private pendingPredictedTracerIds = new Map<number, number>();
  private processedSyncedTracerKeys = new Map<string, number>();
  private processedMeleeSwingKeys   = new Map<string, number>();
  private burrowVisuals = new Map<string, BurrowEmitterVisual>();
  private muzzleFlashRenderer: MuzzleFlashRenderer | null = null;
  private asmdPrimaryRenderer: AsmdPrimaryRenderer | null = null;
  private biteRenderer: BiteRenderer | null = null;
  private zeusTaserRenderer: ZeusTaserRenderer | null = null;
  private shotAudioSystem: ShotAudioSystem | null = null;
  private texturesGenerated = false;
  private damageVignetteTop:    Phaser.GameObjects.Image | null = null;
  private damageVignetteBottom: Phaser.GameObjects.Image | null = null;
  private damageVignetteLeft:   Phaser.GameObjects.Image | null = null;
  private damageVignetteRight:  Phaser.GameObjects.Image | null = null;
  private deathPixelChunks: DeathPixelChunk[] | null = null;

  constructor(
    private scene:  Phaser.Scene,
    private bridge: NetworkBridge,
  ) {
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  setMuzzleFlashRenderer(renderer: MuzzleFlashRenderer | null): void {
    this.muzzleFlashRenderer = renderer;
  }

  setAsmdPrimaryRenderer(renderer: AsmdPrimaryRenderer | null): void {
    this.asmdPrimaryRenderer = renderer;
  }

  setBiteRenderer(renderer: BiteRenderer | null): void {
    this.biteRenderer = renderer;
  }

  setZeusTaserRenderer(renderer: ZeusTaserRenderer | null): void {
    this.zeusTaserRenderer = renderer;
  }

  setShotAudioSystem(system: ShotAudioSystem | null): void {
    this.shotAudioSystem = system;
  }

  playLocalShotAudio(key: string | undefined, volumeScale?: number): void {
    this.shotAudioSystem?.playShot(key, 0, 0, this.bridge.getLocalPlayerId(), volumeScale);
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
    this.deathPixelChunks = null;
  }

  /** Erzeugt kleine Canvas-Texturen für Explosions-Partikel (einmalig). */
  private ensureTextures(): void {
    if (this.texturesGenerated) return;
    this.texturesGenerated = true;

    // Soft-Dot für Funken
    if (!this.scene.textures.exists(TEX_EXPLOSION_SPARK)) {
      const sparkCanvas = this.scene.textures.createCanvas(TEX_EXPLOSION_SPARK, 6, 6);
      if (sparkCanvas) {
        const ctx = sparkCanvas.context;
        const g = ctx.createRadialGradient(3, 3, 0, 3, 3, 3);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 6, 6);
        sparkCanvas.refresh();
      }
    }

    // Solider Block für Glut
    if (!this.scene.textures.exists(TEX_EXPLOSION_EMBER)) {
      const emberCanvas = this.scene.textures.createCanvas(TEX_EXPLOSION_EMBER, 4, 4);
      if (emberCanvas) {
        const ctx = emberCanvas.context;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 4, 4);
        emberCanvas.refresh();
      }
    }

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

    ensureCanvasTexture(this.scene.textures, TEX_BLOOD_DROPLET, 14, 14, (ctx) => {
      const gradient = ctx.createRadialGradient(7, 7, 1, 7, 7, 7);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.65, 'rgba(255,255,255,0.78)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(7, 7, 6.2, 0, Math.PI * 2);
      ctx.fill();
    });

    ensureCanvasTexture(this.scene.textures, TEX_BLOOD_STREAK, 36, 16, (ctx) => {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.ellipse(20, 8, 12, 3.6, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(255,255,255,0.68)';
      ctx.beginPath();
      ctx.ellipse(11, 8, 8, 2.7, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(255,255,255,0.46)';
      ctx.beginPath();
      ctx.ellipse(5, 8, 4, 1.8, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    ensureCanvasTexture(this.scene.textures, TEX_BLOOD_STAIN, 42, 42, (ctx) => {
      const circles: Array<{ x: number; y: number; r: number; alpha: number }> = [
        { x: 18, y: 16, r: 8, alpha: 0.9 },
        { x: 24, y: 20, r: 10, alpha: 0.75 },
        { x: 14, y: 24, r: 7, alpha: 0.58 },
        { x: 28, y: 27, r: 6, alpha: 0.52 },
      ];

      for (const circle of circles) {
        ctx.fillStyle = `rgba(255,255,255,${circle.alpha})`;
        ctx.beginPath();
        ctx.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    ensureCanvasTexture(this.scene.textures, TEX_DAMAGE_VIGNETTE_TOP, GAME_WIDTH, GAME_HEIGHT, (ctx) => {
      const depth = GAME_HEIGHT * 0.32;
      const grad = ctx.createLinearGradient(0, 0, 0, depth);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, GAME_WIDTH, depth);
    });

    ensureCanvasTexture(this.scene.textures, TEX_DAMAGE_VIGNETTE_BOTTOM, GAME_WIDTH, GAME_HEIGHT, (ctx) => {
      const depth = GAME_HEIGHT * 0.32;
      const grad = ctx.createLinearGradient(0, GAME_HEIGHT, 0, GAME_HEIGHT - depth);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, GAME_HEIGHT - depth, GAME_WIDTH, depth);
    });

    ensureCanvasTexture(this.scene.textures, TEX_DAMAGE_VIGNETTE_LEFT, GAME_WIDTH, GAME_HEIGHT, (ctx) => {
      const depth = GAME_WIDTH * 0.18;
      const grad = ctx.createLinearGradient(0, 0, depth, 0);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, depth, GAME_HEIGHT);
    });

    ensureCanvasTexture(this.scene.textures, TEX_DAMAGE_VIGNETTE_RIGHT, GAME_WIDTH, GAME_HEIGHT, (ctx) => {
      const depth = GAME_WIDTH * 0.18;
      const grad = ctx.createLinearGradient(GAME_WIDTH, 0, GAME_WIDTH - depth, 0);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(GAME_WIDTH - depth, 0, depth, GAME_HEIGHT);
    });

    ensureCanvasTexture(this.scene.textures, TEX_DEATH_PIXEL_GLOW, 24, 24, (ctx) => {
      const gradient = ctx.createRadialGradient(12, 12, 1, 12, 12, 12);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.55, 'rgba(255,255,255,0.52)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 24, 24);
    });
  }

  /** RPC-Handler registrieren – Effekte werden bei ALLEN Clients (inkl. Host) abgespielt. */
  setup(onLocalConfirmedHit?: () => void): void {
    this.ensureTextures();

    this.bridge.registerEffectHandler((effect: SyncedCombatEffect) => {
      if (effect.type === 'hit') {
        if (effect.shooterId === this.bridge.getLocalPlayerId()) {
          onLocalConfirmedHit?.();
        }
        this.playHitEffect(effect);
        if (effect.targetId === this.bridge.getLocalPlayerId()) {
          this.playDamageVignette(effect);
        }
      }
      if (effect.type === 'death') this.playDeathEffect(effect);
    });

    this.bridge.registerHitscanTracerHandler((startX, startY, endX, endY, color, thickness, impactKind, visualPreset, shooterId, shotId, shotAudioKey) => {
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
      });
    });

    this.bridge.registerMeleeSwingHandler((swing) => {
      this.playSyncedMeleeSwing(swing);
    });
  }

  // ── Treffer-Effekt: gerichteter Blood-Splatter ───────────────────────────

  private playHitEffect(effect: SyncedHitEffect): void {
    this.ensureTextures();

    const rng = createSeededRandom(effect.seed);
    const band = this.getBloodBand(effect.totalDamage);
    const damageScale = effect.isKill ? BLOOD_HIT_VFX.killshotMultiplier : 1;
    const baseAngle = Math.atan2(effect.dirY, effect.dirX);
    const originX = effect.x + effect.dirX * BLOOD_HIT_VFX.spawnPushPx;
    const originY = effect.y + effect.dirY * BLOOD_HIT_VFX.spawnPushPx;
    const coreTint = this.pickBloodTint(rng);
    const coreSplash = this.scene.add.image(originX, originY, TEX_BLOOD_STAIN)
      .setDepth(DEPTH_FX - 0.2)
      .setTint(coreTint)
      .setAlpha(BLOOD_HIT_VFX.coreSplashAlpha)
      .setScale(BLOOD_HIT_VFX.coreSplashScale * damageScale)
      .setRotation((rng() - 0.5) * 0.4);

    this.scene.tweens.add({
      targets: coreSplash,
      alpha: 0,
      scaleX: BLOOD_HIT_VFX.coreSplashScale * damageScale * 1.28,
      scaleY: BLOOD_HIT_VFX.coreSplashScale * damageScale * 1.28,
      duration: BLOOD_HIT_VFX.coreSplashDurationMs,
      ease: 'Cubic.easeOut',
      onComplete: () => coreSplash.destroy(),
    });

    const streakCount = this.randomInt(rng, band.streakCountMin, band.streakCountMax);
    const dropletCount = this.randomInt(rng, band.dropletCountMin, band.dropletCountMax);
    const stainCount = this.randomInt(rng, band.stainCountMin, band.stainCountMax);
    let stainsCreated = 0;

    for (let i = 0; i < streakCount; i++) {
      const angle = baseAngle + Phaser.Math.DegToRad((rng() - 0.5) * band.spreadDeg * 2);
      const directionX = Math.cos(angle);
      const directionY = Math.sin(angle);
      const lateralX = -directionY;
      const lateralY = directionX;
      const lateral = (rng() - 0.5) * BLOOD_HIT_VFX.lateralJitterPx;
      const startX = originX + lateralX * lateral;
      const startY = originY + lateralY * lateral;
      const travel = this.randomBetween(rng, band.travelMinPx, band.travelMaxPx) * damageScale;
      const endX = startX + directionX * travel + lateralX * (rng() - 0.5) * 14;
      const endY = startY + directionY * travel + lateralY * (rng() - 0.5) * 14;
      const scale = this.randomBetween(rng, band.streakScaleMin, band.streakScaleMax) * damageScale;
      const tint = this.pickBloodTint(rng);
      const streak = this.scene.add.image(startX, startY, TEX_BLOOD_STREAK)
        .setDepth(DEPTH_FX)
        .setTint(tint)
        .setRotation(angle)
        .setScale(scale)
        .setAlpha(0.84);

      const duration = this.randomBetween(rng, band.flightMinMs, band.flightMaxMs);
      const leaveStain = stainsCreated < stainCount && (i < stainCount || rng() > 0.45);
      if (leaveStain) stainsCreated += 1;

      this.scene.tweens.add({
        targets: streak,
        x: endX,
        y: endY,
        alpha: 0,
        duration,
        ease: 'Cubic.easeOut',
        onComplete: () => {
          streak.destroy();
          if (leaveStain) {
            this.spawnBloodStain(
              endX,
              endY,
              this.randomBetween(rng, band.stainScaleMin, band.stainScaleMax) * damageScale,
              band.stainAlpha,
              band.stainFadeMs,
              tint,
              (rng() - 0.5) * Math.PI,
            );
          }
        },
      });
    }

    for (let i = 0; i < dropletCount; i++) {
      const angle = baseAngle + Phaser.Math.DegToRad((rng() - 0.5) * Math.max(14, band.spreadDeg * 1.35) * 2);
      const directionX = Math.cos(angle);
      const directionY = Math.sin(angle);
      const travel = this.randomBetween(rng, band.travelMinPx * 0.5, band.travelMaxPx * 0.75) * damageScale;
      const startX = effect.x + directionX * BLOOD_HIT_VFX.spawnPushPx * 0.7;
      const startY = effect.y + directionY * BLOOD_HIT_VFX.spawnPushPx * 0.7;
      const droplet = this.scene.add.image(startX, startY, TEX_BLOOD_DROPLET)
        .setDepth(DEPTH_FX + 0.05)
        .setTint(this.pickBloodTint(rng))
        .setScale(this.randomBetween(rng, band.dropletScaleMin, band.dropletScaleMax) * damageScale)
        .setAlpha(0.74);

      this.scene.tweens.add({
        targets: droplet,
        x: startX + directionX * travel,
        y: startY + directionY * travel,
        alpha: 0,
        duration: this.randomBetween(rng, band.flightMinMs, band.flightMaxMs) * 0.85,
        ease: 'Quad.easeOut',
        onComplete: () => droplet.destroy(),
      });
    }
  }

  // ── Dash-Trail-Effekt ─────────────────────────────────────────────────────

  /** Trail-Geist: verblassende Sprite-Kopie des Spielers während Phase 1. */
  playDashTrailGhost(x: number, y: number, color: number, scale: number, rotation: number): void {
    const ghost = this.scene.add.image(x, y, 'badger');
    ghost.setDisplaySize(PLAYER_SIZE * scale, PLAYER_SIZE * scale);
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
    coreFlash.setDepth(DEPTH_FX + 0.3);
    coreFlash.setBlendMode(Phaser.BlendModes.ADD);
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

  playStealthTransitionEffect(x: number, y: number, revealing: boolean, color: number = COLORS.GREY_2): void {
    this.ensureTextures();
    const particleCount = revealing ? 28 : 22;
    const core = this.scene.add.circle(x, y, revealing ? 16 : 12, color, revealing ? 0.34 : 0.24);
    core.setDepth(DEPTH_FX + 0.2);
    core.setBlendMode(Phaser.BlendModes.ADD);
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
    ring.setDepth(DEPTH_FX + 0.16);
    ring.setStrokeStyle(revealing ? 6 : 5, color, revealing ? 0.7 : 0.54);
    ring.setBlendMode(Phaser.BlendModes.ADD);
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
      pixel.setDepth(DEPTH_FX + 0.1);
      pixel.setRotation(Math.random() * Math.PI);
      pixel.setBlendMode(Phaser.BlendModes.ADD);

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

    const isHoly = visualStyle === 'holy';
    const isEnergy = visualStyle === 'energy';
    const isNuke = visualStyle === 'nuke';
    const fillColor = isHoly
      ? 0xf0c53a
      : (color ?? (isEnergy ? 0x73bed3 : (isNuke ? 0xffb347 : 0xff2200)));
    const flashColor = isEnergy ? 0xe8fbff : (isHoly ? 0xfff8de : (isNuke ? 0xfff2cc : 0xffffcc));
    const haloColor = isEnergy
      ? this.mixColor(fillColor, 0xffffff, 0.45)
      : (isHoly ? 0xffef9a : (isNuke ? this.mixColor(fillColor, 0xffffff, 0.35) : this.mixColor(fillColor, 0xffffff, 0.2)));
    const startRadius = 8;
    const endScale = radius / startRadius;

    if (isNuke) {
      const skyFlash = this.scene.add.rectangle(GAME_WIDTH * 0.5, GAME_HEIGHT * 0.5, GAME_WIDTH, GAME_HEIGHT, 0xfff1cf, 0.24);
      skyFlash.setScrollFactor(0);
      skyFlash.setDepth(DEPTH.OVERLAY - 2);
      skyFlash.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({
        targets:    skyFlash,
        alpha:      0,
        duration:   420,
        ease:       'Quad.easeOut',
        onComplete: () => skyFlash.destroy(),
      });
    }

    const flash = this.scene.add.circle(x, y, startRadius, flashColor, 1);
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

    if (isEnergy || isNuke || isHoly) {
      const halo = this.scene.add.circle(x, y, startRadius, haloColor, isNuke ? 0.55 : 0.4);
      halo.setDepth(DEPTH_FX + 0.5);
      halo.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({
        targets:    halo,
        scaleX:     (radius * (isNuke ? 1.3 : (isHoly ? 1.05 : 0.9))) / startRadius,
        scaleY:     (radius * (isNuke ? 1.3 : (isHoly ? 1.05 : 0.9))) / startRadius,
        alpha:      0,
        duration:   isNuke ? 900 : (isHoly ? 640 : 420),
        ease:       'Sine.easeOut',
        onComplete: () => halo.destroy(),
      });
    }

    const blast = this.scene.add.circle(x, y, startRadius, fillColor, isEnergy ? 0.5 : (isNuke ? 0.88 : 0.7));
    blast.setDepth(DEPTH_FX);
    if (isEnergy || isNuke || isHoly) {
      blast.setBlendMode(Phaser.BlendModes.ADD);
    }
    this.scene.tweens.add({
      targets:    blast,
      scaleX:     endScale,
      scaleY:     endScale,
      alpha:      0,
      duration:   isEnergy ? 520 : (isNuke ? 760 : (isHoly ? 820 : 600)),
      ease:       isEnergy ? 'Sine.easeOut' : (isNuke ? 'Cubic.easeOut' : (isHoly ? 'Expo.easeOut' : 'Power2Out')),
      onComplete: () => blast.destroy(),
    });

    if (isHoly) {
      const skyFlash = this.scene.add.rectangle(GAME_WIDTH * 0.5, GAME_HEIGHT * 0.5, GAME_WIDTH, GAME_HEIGHT, 0xffefc4, 0.18);
      skyFlash.setScrollFactor(0);
      skyFlash.setDepth(DEPTH.OVERLAY - 2);
      skyFlash.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({
        targets:    skyFlash,
        alpha:      0,
        duration:   260,
        ease:       'Quad.easeOut',
        onComplete: () => skyFlash.destroy(),
      });

      const coreCorona = this.scene.add.circle(x, y, startRadius, 0xffffff, 0.72);
      coreCorona.setDepth(DEPTH_FX + 0.45);
      coreCorona.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({
        targets:    coreCorona,
        scaleX:     (radius * 0.58) / startRadius,
        scaleY:     (radius * 0.58) / startRadius,
        alpha:      0,
        duration:   420,
        ease:       'Expo.easeOut',
        onComplete: () => coreCorona.destroy(),
      });

      const blastOuter = this.scene.add.circle(x, y, startRadius, 0xffb11f, 0.52);
      blastOuter.setDepth(DEPTH_FX + 0.15);
      blastOuter.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({
        targets:    blastOuter,
        scaleX:     (radius * 1.28) / startRadius,
        scaleY:     (radius * 1.28) / startRadius,
        alpha:      0,
        duration:   980,
        ease:       'Expo.easeOut',
        onComplete: () => blastOuter.destroy(),
      });
    }

    if (isNuke) {
      const secondaryBlast = this.scene.add.circle(x, y, startRadius, 0xff7a2f, 0.55);
      secondaryBlast.setDepth(DEPTH_FX + 0.2);
      secondaryBlast.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({
        targets:    secondaryBlast,
        scaleX:     (radius * 1.22) / startRadius,
        scaleY:     (radius * 1.22) / startRadius,
        alpha:      0,
        duration:   980,
        ease:       'Expo.easeOut',
        onComplete: () => secondaryBlast.destroy(),
      });

      const heatHalo = this.scene.add.circle(x, y, startRadius, 0xffffff, 0.25);
      heatHalo.setDepth(DEPTH_FX + 0.3);
      heatHalo.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({
        targets:    heatHalo,
        scaleX:     (radius * 1.7) / startRadius,
        scaleY:     (radius * 1.7) / startRadius,
        alpha:      0,
        duration:   1300,
        ease:       'Sine.easeOut',
        onComplete: () => heatHalo.destroy(),
      });
    }

    const ringStartRadius = radius * 0.5;
    const ring = this.scene.add.circle(x, y, ringStartRadius);
    ring.setStrokeStyle(isEnergy ? 3 : (isHoly ? 3 : (isNuke ? 5 : 2)), isEnergy ? haloColor : fillColor, isNuke ? 0.95 : 0.8);
    ring.setFillStyle(0, 0);
    ring.setDepth(DEPTH_FX);
    if (isEnergy || isNuke || isHoly) {
      ring.setBlendMode(Phaser.BlendModes.ADD);
    }
    this.scene.tweens.add({
      targets:    ring,
      scaleX:     isNuke ? (radius * 1.35) / ringStartRadius : (isHoly ? (radius * 1.3) / ringStartRadius : (radius * 1.15) / ringStartRadius),
      scaleY:     isNuke ? (radius * 1.35) / ringStartRadius : (isHoly ? (radius * 1.3) / ringStartRadius : (radius * 1.15) / ringStartRadius),
      alpha:      0,
      duration:   isEnergy ? 340 : (isNuke ? 720 : (isHoly ? 860 : 400)),
      ease:       'Linear',
      onComplete: () => ring.destroy(),
    });

    if (isEnergy) {
      const outerRingRadius = radius * 0.3;
      const outerRing = this.scene.add.circle(x, y, outerRingRadius);
      outerRing.setStrokeStyle(2, fillColor, 0.9);
      outerRing.setFillStyle(0, 0);
      outerRing.setDepth(DEPTH_FX + 0.2);
      outerRing.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({
        targets:    outerRing,
        scaleX:     (radius * 1.45) / outerRingRadius,
        scaleY:     (radius * 1.45) / outerRingRadius,
        alpha:      0,
        duration:   520,
        ease:       'Quad.easeOut',
        onComplete: () => outerRing.destroy(),
      });
    }

    if (isNuke) {
      const shockRingA = this.scene.add.circle(x, y, radius * 0.18);
      shockRingA.setStrokeStyle(6, 0xfff0b8, 0.92);
      shockRingA.setFillStyle(0, 0);
      shockRingA.setDepth(DEPTH_FX + 0.1);
      shockRingA.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({
        targets:    shockRingA,
        scaleX:     6.2,
        scaleY:     6.2,
        alpha:      0,
        duration:   920,
        ease:       'Expo.easeOut',
        onComplete: () => shockRingA.destroy(),
      });

      const shockRingB = this.scene.add.circle(x, y, radius * 0.12);
      shockRingB.setStrokeStyle(3, 0xff7a2f, 0.8);
      shockRingB.setFillStyle(0, 0);
      shockRingB.setDepth(DEPTH_FX + 0.12);
      shockRingB.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({
        targets:    shockRingB,
        scaleX:     9.5,
        scaleY:     9.5,
        alpha:      0,
        duration:   1180,
        ease:       'Quad.easeOut',
        onComplete: () => shockRingB.destroy(),
      });
    }

    const sparkTints = isHoly
      ? [0xffffff, 0xfff2bf, 0xffd34d, 0xffa31f]
      : isEnergy
        ? [0xffffff, haloColor, fillColor]
        : isNuke
          ? [0xffffff, 0xfff0b8, 0xffa348, 0xff6422]
          : [fillColor, 0xffaa00, 0xff6600];
    const sparkCount = Math.ceil(radius / (isHoly ? 1.55 : (isEnergy ? 2.4 : (isNuke ? 1.2 : 5))));
    const sparkEmitter = this.scene.add.particles(x, y, TEX_EXPLOSION_SPARK, {
      lifespan:  isEnergy ? { min: 220, max: 520 } : (isNuke ? { min: 450, max: 1100 } : (isHoly ? { min: 380, max: 980 } : { min: 300, max: 600 })),
      speed:     isEnergy ? { min: radius * 0.5, max: radius * 1.9 } : (isNuke ? { min: radius * 0.65, max: radius * 2.8 } : (isHoly ? { min: radius * 0.32, max: radius * 2.35 } : { min: 50, max: radius * 1.5 })),
      scale:     isEnergy ? { start: 1.45, end: 0 } : (isNuke ? { start: 2.2, end: 0 } : (isHoly ? { start: 1.85, end: 0 } : { start: 1.2, end: 0 })),
      alpha:     { start: isEnergy ? 1.0 : (isNuke ? 1.0 : (isHoly ? 0.96 : 0.9)), end: 0 },
      tint:      sparkTints,
      blendMode: Phaser.BlendModes.ADD,
      emitting:  false,
    });
    sparkEmitter.setDepth(DEPTH_FX);
    sparkEmitter.explode(sparkCount);
    this.scene.time.delayedCall(isNuke ? 1400 : (isHoly ? 1300 : 800), () => sparkEmitter.destroy());

    if (isEnergy) {
      const arcEmitter = this.scene.add.particles(x, y, TEX_EXPLOSION_SPARK, {
        lifespan:  { min: 180, max: 360 },
        speed:     { min: radius * 0.35, max: radius * 0.85 },
        scale:     { start: 1.1, end: 0 },
        alpha:     { start: 0.8, end: 0 },
        tint:      [0xffffff, haloColor, fillColor],
        blendMode: Phaser.BlendModes.ADD,
        emitting:  false,
      });
      arcEmitter.setDepth(DEPTH_FX + 0.1);
      arcEmitter.addEmitZone(edgeZone(radius * 0.28, Math.max(Math.ceil(radius / 5), 18)));
      arcEmitter.explode(Math.max(Math.ceil(radius / 2.4), 28));
      this.scene.time.delayedCall(700, () => arcEmitter.destroy());
    }

    const emberTints = isHoly
      ? [0xfff0bc, 0xf2c14a, 0xad6b16, 0x5a2e08]
      : isEnergy
        ? [haloColor, fillColor, this.mixColor(fillColor, 0x172038, 0.45)]
        : isNuke
          ? [0xffd27a, 0xff8f42, 0x6a2a1b, 0x2e1d23]
          : [fillColor, 0xff4400];
    const emberCount = Math.ceil(radius / (isHoly ? 2.15 : (isEnergy ? 4.8 : (isNuke ? 2.3 : 8))));
    const emberEmitter = this.scene.add.particles(x, y, TEX_EXPLOSION_EMBER, {
      lifespan:  isEnergy ? { min: 260, max: 620 } : (isNuke ? { min: 900, max: 1800 } : (isHoly ? { min: 700, max: 1650 } : { min: 500, max: 1000 })),
      speed:     isEnergy ? { min: radius * 0.15, max: radius * 0.95 } : (isNuke ? { min: radius * 0.2, max: radius * 1.1 } : (isHoly ? { min: radius * 0.22, max: radius * 1.38 } : { min: 20, max: radius * 0.8 })),
      scale:     isEnergy ? { start: 1.0, end: 0.1 } : (isNuke ? { start: 1.3, end: 0.18 } : (isHoly ? { start: 1.45, end: 0.12 } : { start: 0.8, end: 0.2 })),
      alpha:     { start: isEnergy ? 0.8 : (isNuke ? 0.92 : (isHoly ? 0.86 : 0.7)), end: 0 },
      tint:      emberTints,
      gravityY:  isEnergy ? -20 : (isNuke ? -180 : (isHoly ? -80 : 40)),
      emitting:  false,
    });
    emberEmitter.setDepth(DEPTH_FX);
    emberEmitter.explode(emberCount);
    this.scene.time.delayedCall(isEnergy ? 900 : (isNuke ? 2200 : (isHoly ? 2200 : 1200)), () => emberEmitter.destroy());

    if (isNuke) {
      const plumeEmitter = this.scene.add.particles(x, y + radius * 0.06, TEX_EXPLOSION_SPARK, {
        lifespan:  { min: 950, max: 1800 },
        speedX:    { min: -radius * 0.1, max: radius * 0.1 },
        speedY:    { min: -radius * 0.95, max: -radius * 0.35 },
        scale:     { start: 2.4, end: 0.15 },
        alpha:     { start: 0.7, end: 0 },
        tint:      [0xfff4d8, 0xffb347, 0x583a43, 0x20202b],
        blendMode: Phaser.BlendModes.ADD,
        gravityY:  -120,
        emitting:  false,
      });
      plumeEmitter.setDepth(DEPTH_FX + 0.4);
      plumeEmitter.explode(Math.max(Math.ceil(radius / 1.8), 140));
      this.scene.time.delayedCall(2200, () => plumeEmitter.destroy());

      const falloutEmitter = this.scene.add.particles(x, y - radius * 0.1, TEX_EXPLOSION_EMBER, {
        lifespan:  { min: 1200, max: 2200 },
        speedX:    { min: -radius * 0.22, max: radius * 0.22 },
        speedY:    { min: -radius * 0.3, max: radius * 0.1 },
        scale:     { start: 1.05, end: 0.12 },
        alpha:     { start: 0.55, end: 0 },
        tint:      [0x3b2a33, 0x5a3e42, 0x8a5c43],
        gravityY:  45,
        emitting:  false,
      });
      falloutEmitter.setDepth(DEPTH_FX + 0.35);
      falloutEmitter.explode(Math.max(Math.ceil(radius / 3.1), 90));
      this.scene.time.delayedCall(2600, () => falloutEmitter.destroy());
    }

    if (isHoly) {
      const holyRingRadius = radius * 0.28;
      const holyRingEndScale = (radius * 1.75) / holyRingRadius;
      const holyRing = this.scene.add.circle(x, y, holyRingRadius);
      holyRing.setStrokeStyle(6, 0xffe8a3, 0.85);
      holyRing.setFillStyle(0, 0);
      holyRing.setDepth(DEPTH_FX + 0.25);
      holyRing.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({
        targets:    holyRing,
        scaleX:     holyRingEndScale,
        scaleY:     holyRingEndScale,
        alpha:      0,
        duration:   980,
        ease:       'Expo.easeOut',
        onComplete: () => holyRing.destroy(),
      });

      const holyRingInner = this.scene.add.circle(x, y, radius * 0.18);
      holyRingInner.setStrokeStyle(3, 0xffffff, 0.72);
      holyRingInner.setFillStyle(0, 0);
      holyRingInner.setDepth(DEPTH_FX + 0.26);
      holyRingInner.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({
        targets:    holyRingInner,
        scaleX:     6.1,
        scaleY:     6.1,
        alpha:      0,
        duration:   760,
        ease:       'Quad.easeOut',
        onComplete: () => holyRingInner.destroy(),
      });

      const verticalBeam = this.scene.add.rectangle(x, y, Math.max(radius * 0.16, 20), radius * 0.95, 0xfff4d0, 0.24);
      verticalBeam.setDepth(DEPTH_FX + 0.3);
      verticalBeam.setBlendMode(Phaser.BlendModes.ADD);
      const horizontalBeam = this.scene.add.rectangle(x, y, radius * 0.95, Math.max(radius * 0.16, 20), 0xffe0a4, 0.2);
      horizontalBeam.setDepth(DEPTH_FX + 0.31);
      horizontalBeam.setBlendMode(Phaser.BlendModes.ADD);
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

      const crownEmitter = this.scene.add.particles(x, y - radius * 0.05, TEX_EXPLOSION_SPARK, {
        lifespan:  { min: 520, max: 980 },
        speedX:    { min: -radius * 0.42, max: radius * 0.42 },
        speedY:    { min: -radius * 1.35, max: -radius * 0.5 },
        scale:     { start: 1.6, end: 0.04 },
        alpha:     { start: 0.9, end: 0 },
        tint:      [0xffffff, 0xfff1b8, 0xffcf57],
        blendMode: Phaser.BlendModes.ADD,
        gravityY:  120,
        emitting:  false,
      });
      crownEmitter.setDepth(DEPTH_FX + 0.32);
      crownEmitter.explode(Math.max(Math.ceil(radius / 1.9), 92));
      this.scene.time.delayedCall(1200, () => crownEmitter.destroy());

      this.scene.cameras.main.shake(520, 0.016);
    } else if (isEnergy) {
      this.scene.cameras.main.shake(180, 0.005);
    } else if (isNuke) {
      this.scene.cameras.main.shake(550, 0.018);
    }
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

  playHitscanTracer(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    playerColor: number,
    thickness: number,
    impactKind: HitscanImpactKind = 'environment',
    visualPreset: HitscanVisualPreset = 'default',
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

    if (visualPreset === 'asmd_primary' && this.asmdPrimaryRenderer) {
      this.asmdPrimaryRenderer.playTracer(startX, startY, renderEndX, renderEndY, playerColor, thickness, resolvedImpactKind);
      return;
    }

    this.muzzleFlashRenderer?.playHitscanFlash(startX, startY, renderEndX - startX, renderEndY - startY, visualPreset, playerColor);

    const gfx = this.scene.add.graphics();
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
    shotAudioVolume?: number,
  ): void {
    this.pendingPredictedTracerIds.set(shotId, this.scene.time.now + 1000);
    this.shotAudioSystem?.playShot(shotAudioKey, startX, startY, this.bridge.getLocalPlayerId(), shotAudioVolume);
    this.playHitscanTracer(startX, startY, endX, endY, playerColor, thickness, impactKind, visualPreset);
  }

  playSyncedHitscanTracer(trace: SyncedHitscanTrace): void {
    const { startX, startY, endX, endY, color, thickness, impactKind, visualPreset, shooterId, shotId, shotAudioKey, shotAudioVolume } = trace;
    if (this.shouldSkipSyncedTracer(shooterId, shotId)) return;
    this.shotAudioSystem?.playShot(shotAudioKey, startX, startY, shooterId, shotAudioVolume);
    this.playHitscanTracer(startX, startY, endX, endY, color, thickness, impactKind ?? 'environment', visualPreset);
  }

  private playHitscanImpact(
    x: number,
    y: number,
    playerColor: number,
    thickness: number,
    impactKind: HitscanImpactKind = 'environment',
  ): void {
    if (impactKind === 'none' || !isPointInsideArena(x, y)) return;
    const baseColor = this.mixColor(playerColor, 0xffffff, 0.3);
    const haloRadius = Math.max(thickness * 2.4, 7);
    const halo = this.scene.add.circle(x, y, haloRadius, baseColor, 0.24);
    halo.setDepth(DEPTH_TRACE + 0.1);
    halo.setBlendMode(Phaser.BlendModes.ADD);
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

    this.shotAudioSystem?.playShot(swing.shotAudioKey, swing.x, swing.y, swing.shooterId);

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
      );
      return;
    }

    if (swing.visualPreset === 'zeus_taser' && this.zeusTaserRenderer) {
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
    const stain = this.scene.add.image(x, y, TEX_BLOOD_STAIN)
      .setDepth(DEPTH_BLOOD_STAIN)
      .setTint(tint)
      .setAlpha(0)
      .setScale(scale * 0.82)
      .setRotation(rotation);

    this.scene.tweens.add({
      targets: stain,
      alpha,
      scaleX: scale,
      scaleY: scale,
      duration: 80,
      ease: 'Quad.easeOut',
    });

    this.scene.tweens.add({
      targets: stain,
      alpha: 0,
      delay: BLOOD_HIT_VFX.stainDelayMs,
      duration: fadeMs,
      ease: 'Sine.easeIn',
      onComplete: () => stain.destroy(),
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

    const createEdge = (tex: string) =>
      this.scene.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, tex)
        .setDepth(DEPTH_DAMAGE_VIGNETTE)
        .setScrollFactor(0)
        .setTint(DAMAGE_VIGNETTE_VFX.color)
        .setAlpha(0)
        .setVisible(false);

    this.damageVignetteTop    = createEdge(TEX_DAMAGE_VIGNETTE_TOP);
    this.damageVignetteBottom = createEdge(TEX_DAMAGE_VIGNETTE_BOTTOM);
    this.damageVignetteLeft   = createEdge(TEX_DAMAGE_VIGNETTE_LEFT);
    this.damageVignetteRight  = createEdge(TEX_DAMAGE_VIGNETTE_RIGHT);
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

  private getBloodBand(totalDamage: number) {
    if (totalDamage <= BLOOD_HIT_VFX.bands.light.maxDamage) return BLOOD_HIT_VFX.bands.light;
    if (totalDamage <= BLOOD_HIT_VFX.bands.medium.maxDamage) return BLOOD_HIT_VFX.bands.medium;
    return BLOOD_HIT_VFX.bands.heavy;
  }

  private pickBloodTint(rng: () => number): number {
    const idx = Math.min(BLOOD_HIT_VFX.palette.length - 1, Math.floor(rng() * BLOOD_HIT_VFX.palette.length));
    return BLOOD_HIT_VFX.palette[idx] ?? BLOOD_HIT_VFX.palette[0];
  }

  private randomBetween(rng: () => number, min: number, max: number): number {
    return Phaser.Math.Linear(min, max, rng());
  }

  private randomInt(rng: () => number, min: number, max: number): number {
    return Math.floor(min + rng() * (max - min + 1));
  }

  // ── Todes-Effekt: Pixel-Disintegration statt Ring-Explosion ──────────────

  private playDeathEffect(effect: SyncedDeathEffect): void {
    this.ensureTextures();

    const chunks = this.getDeathPixelChunks();
    if (chunks.length === 0) return;

    const rng = createSeededRandom(effect.seed);
    const auraColor = effect.targetColor ?? COLORS.GREY_2;
    const cos = Math.cos(effect.rotation);
    const sin = Math.sin(effect.rotation);

    for (const chunk of chunks) {
      const rx = chunk.offsetX * cos - chunk.offsetY * sin;
      const ry = chunk.offsetX * sin + chunk.offsetY * cos;
      const radialAngle = Math.hypot(rx, ry) > 0.15 ? Math.atan2(ry, rx) : rng() * Math.PI * 2;
      const angle = radialAngle + (rng() - 0.5) * 1.2;
      const travel = this.randomBetween(rng, DEATH_DISINTEGRATION_VFX.travelMinPx, DEATH_DISINTEGRATION_VFX.travelMaxPx);
      const endX = effect.x + rx * 1.15 + Math.cos(angle) * travel + (rng() - 0.5) * DEATH_DISINTEGRATION_VFX.jitterPx;
      const endY = effect.y + ry * 1.15 + Math.sin(angle) * travel + (rng() - 0.5) * DEATH_DISINTEGRATION_VFX.jitterPx;
      const tintedColor = mixColors(
        chunk.color,
        auraColor,
        DEATH_DISINTEGRATION_VFX.auraTintMix * Math.max(0.18, chunk.brightness),
      );
      const pixel = this.scene.add.rectangle(effect.x + rx, effect.y + ry, chunk.width, chunk.height, tintedColor, DEATH_DISINTEGRATION_VFX.alpha)
        .setDepth(DEPTH_FX - 0.1)
        .setOrigin(0.5)
        .setScale(DEATH_DISINTEGRATION_VFX.scaleStart);

      this.scene.tweens.add({
        targets: pixel,
        x: endX,
        y: endY,
        angle: (rng() - 0.5) * DEATH_DISINTEGRATION_VFX.rotationMaxDeg,
        alpha: 0,
        scaleX: DEATH_DISINTEGRATION_VFX.scaleEnd,
        scaleY: DEATH_DISINTEGRATION_VFX.scaleEnd,
        duration: DEATH_DISINTEGRATION_VFX.durationMs,
        ease: 'Cubic.easeOut',
        onComplete: () => pixel.destroy(),
      });
    }

    for (let i = 0; i < DEATH_DISINTEGRATION_VFX.glowCount; i++) {
      const angle = rng() * Math.PI * 2;
      const travel = this.randomBetween(rng, DEATH_DISINTEGRATION_VFX.glowTravelMinPx, DEATH_DISINTEGRATION_VFX.glowTravelMaxPx);
      const glow = this.scene.add.image(effect.x, effect.y, TEX_DEATH_PIXEL_GLOW)
        .setDepth(DEPTH_FX + 0.05)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(auraColor)
        .setAlpha(DEATH_DISINTEGRATION_VFX.glowAlpha)
        .setScale(this.randomBetween(rng, DEATH_DISINTEGRATION_VFX.glowScaleMin, DEATH_DISINTEGRATION_VFX.glowScaleMax));

      this.scene.tweens.add({
        targets: glow,
        x: effect.x + Math.cos(angle) * travel,
        y: effect.y + Math.sin(angle) * travel,
        alpha: 0,
        duration: DEATH_DISINTEGRATION_VFX.durationMs,
        ease: 'Sine.easeOut',
        onComplete: () => glow.destroy(),
      });
    }
  }

  private getDeathPixelChunks(): DeathPixelChunk[] {
    if (this.deathPixelChunks) return this.deathPixelChunks;
    if (!this.scene.textures.exists('badger')) {
      this.deathPixelChunks = [];
      return this.deathPixelChunks;
    }

    const texture = this.scene.textures.get('badger');
    const sourceImage = texture.getSourceImage() as CanvasImageSource & { width?: number; height?: number };
    const width = Math.max(1, Number(sourceImage?.width) || PLAYER_SIZE);
    const height = Math.max(1, Number(sourceImage?.height) || PLAYER_SIZE);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      this.deathPixelChunks = [];
      return this.deathPixelChunks;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(sourceImage, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height).data;
    const scaleX = PLAYER_SIZE / width;
    const scaleY = PLAYER_SIZE / height;
    const chunkSize = DEATH_DISINTEGRATION_VFX.chunkSizePx;
    const chunks: DeathPixelChunk[] = [];

    for (let py = 0; py < height; py += chunkSize) {
      for (let px = 0; px < width; px += chunkSize) {
        let weightSum = 0;
        let red = 0;
        let green = 0;
        let blue = 0;
        const blockWidth = Math.min(chunkSize, width - px);
        const blockHeight = Math.min(chunkSize, height - py);

        for (let sy = 0; sy < blockHeight; sy++) {
          for (let sx = 0; sx < blockWidth; sx++) {
            const idx = ((py + sy) * width + (px + sx)) * 4;
            const alpha = imageData[idx + 3] / 255;
            if (alpha <= 0.08) continue;
            weightSum += alpha;
            red += imageData[idx] * alpha;
            green += imageData[idx + 1] * alpha;
            blue += imageData[idx + 2] * alpha;
          }
        }

        if (weightSum <= 0.01) continue;

        const avgRed = Math.round(red / weightSum);
        const avgGreen = Math.round(green / weightSum);
        const avgBlue = Math.round(blue / weightSum);
        chunks.push({
          offsetX: (px + blockWidth / 2 - width / 2) * scaleX,
          offsetY: (py + blockHeight / 2 - height / 2) * scaleY,
          width: Math.max(1, blockWidth * scaleX),
          height: Math.max(1, blockHeight * scaleY),
          color: (avgRed << 16) | (avgGreen << 8) | avgBlue,
          brightness: (avgRed + avgGreen + avgBlue) / (255 * 3),
        });
      }
    }

    this.deathPixelChunks = chunks;
    return chunks;
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
