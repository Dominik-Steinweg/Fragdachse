import Phaser from 'phaser';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { BurrowPhase, ExplosionVisualStyle, HitscanVisualPreset, SyncedHitscanTrace, SyncedMeleeSwing } from '../types';
import { COLORS, DEPTH, DEPTH_FX, DEPTH_TRACE, GAME_HEIGHT, GAME_WIDTH, PLAYER_SIZE, SHOCKWAVE_RADIUS, clipPointToArenaRay, getBeamPaletteForPlayerColor, isPointInsideArena } from '../config';
import { circleZone, edgeZone } from './EffectUtils';
import type { MuzzleFlashRenderer } from './MuzzleFlashRenderer';

const HITSCAN_TRACER_FADE_MS = 320;
const MELEE_SWING_FADE_MS    = 220;

const TEX_BURROW_DIRT = '__burrow_dirt';
const TEX_BURROW_DUST = '__burrow_dust';
const TEX_EXPLOSION_SPARK = '__explosion_spark';
const TEX_EXPLOSION_EMBER = '__explosion_ember';

interface BurrowEmitterVisual {
  dirt: Phaser.GameObjects.Particles.ParticleEmitter;
  dust: Phaser.GameObjects.Particles.ParticleEmitter;
}

export class EffectSystem {
  private pendingPredictedTracerIds = new Map<number, number>();
  private processedSyncedTracerKeys = new Map<string, number>();
  private processedMeleeSwingKeys   = new Map<string, number>();
  private burrowVisuals = new Map<string, BurrowEmitterVisual>();
  private muzzleFlashRenderer: MuzzleFlashRenderer | null = null;
  private texturesGenerated = false;

  constructor(
    private scene:  Phaser.Scene,
    private bridge: NetworkBridge,
  ) {}

  setMuzzleFlashRenderer(renderer: MuzzleFlashRenderer | null): void {
    this.muzzleFlashRenderer = renderer;
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
  }

  /** RPC-Handler registrieren – Effekte werden bei ALLEN Clients (inkl. Host) abgespielt. */
  setup(onLocalConfirmedHit?: () => void): void {
    this.bridge.registerEffectHandler((type, x, y, shooterId) => {
      if (type === 'hit') {
        if (shooterId === this.bridge.getLocalPlayerId()) {
          onLocalConfirmedHit?.();
        }
        this.playHitEffect(x, y);
      }
      if (type === 'death') this.playDeathEffect(x, y);
    });

    this.bridge.registerHitscanTracerHandler((startX, startY, endX, endY, color, thickness, visualPreset, shooterId, shotId) => {
      this.playSyncedHitscanTracer({
        startX,
        startY,
        endX,
        endY,
        color,
        thickness,
        visualPreset,
        shooterId,
        shotId,
      });
    });

    this.bridge.registerMeleeSwingHandler((swing) => {
      this.playSyncedMeleeSwing(swing);
    });
  }

  // ── Treffer-Effekt: kleiner roter Ring ────────────────────────────────────

  private playHitEffect(x: number, y: number): void {
    const ring = this.scene.add.circle(x, y, PLAYER_SIZE * 0.45, 0xff3333, 0.85);
    ring.setDepth(DEPTH_FX);
    this.scene.tweens.add({
      targets:    ring,
      scaleX:     2.8,
      scaleY:     2.8,
      alpha:      0,
      duration:   100,
      ease:       'Power2Out',
      onComplete: () => ring.destroy(),
    });
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
    visualPreset: HitscanVisualPreset = 'default',
  ): void {
    this.ensureTextures();
    const clippedEnd = clipPointToArenaRay(startX, startY, endX, endY);
    const renderEndX = clippedEnd.x;
    const renderEndY = clippedEnd.y;
    const palette = getBeamPaletteForPlayerColor(playerColor);
    const gfx = this.scene.add.graphics();
    gfx.setDepth(DEPTH_TRACE);

    this.muzzleFlashRenderer?.playHitscanFlash(startX, startY, renderEndX - startX, renderEndY - startY, visualPreset, playerColor);

    if (visualPreset === 'asmd_primary') {
      const energyCore = this.mixColor(playerColor, 0xffffff, 0.72);
      const energyGlow = this.mixColor(playerColor, COLORS.BLUE_2, 0.42);
      this.strokeTracer(gfx, energyGlow, Math.max(thickness + 10, 10), 0.16, startX, startY, renderEndX, renderEndY);
      this.strokeTracer(gfx, energyGlow, Math.max(thickness + 6, 6), 0.32, startX, startY, renderEndX, renderEndY);
      this.strokeTracer(gfx, energyCore, Math.max(thickness + 3, 4), 0.72, startX, startY, renderEndX, renderEndY);
      this.strokeTracer(gfx, 0xffffff, Math.max(thickness, 2), 0.95, startX, startY, renderEndX, renderEndY);

      const beamMidX = (startX + renderEndX) * 0.5;
      const beamMidY = (startY + renderEndY) * 0.5;
      gfx.fillStyle(energyGlow, 0.18);
      gfx.fillCircle(beamMidX, beamMidY, Math.max(thickness * 1.8, 5));
      gfx.fillStyle(energyCore, 0.3);
      gfx.fillCircle(startX, startY, Math.max(thickness * 1.9, 5));
      gfx.fillStyle(0xffffff, 0.5);
      gfx.fillCircle(startX, startY, Math.max(thickness * 0.9, 2));
      gfx.fillStyle(energyCore, 0.36);
      gfx.fillCircle(renderEndX, renderEndY, Math.max(thickness * 1.25, 4));
      gfx.fillStyle(0xffffff, 0.7);
      gfx.fillCircle(renderEndX, renderEndY, Math.max(thickness * 0.55, 2));
      this.playHitscanImpact(renderEndX, renderEndY, playerColor, thickness, visualPreset);
    } else {
      this.strokeTracer(gfx, palette.shadow, Math.max(thickness + 6, 6), 0.20, startX, startY, renderEndX, renderEndY);
      this.strokeTracer(gfx, palette.glow, Math.max(thickness + 3, 4), 0.45, startX, startY, renderEndX, renderEndY);
      this.strokeTracer(gfx, palette.core, Math.max(thickness, 2), 0.95, startX, startY, renderEndX, renderEndY);

      gfx.fillStyle(palette.glow, 0.40);
      gfx.fillCircle(startX, startY, Math.max(thickness * 1.35, 4));
      gfx.fillStyle(palette.core, 0.85);
      gfx.fillCircle(startX, startY, Math.max(thickness * 0.75, 2));
      gfx.fillStyle(palette.core, 0.65);
      gfx.fillCircle(renderEndX, renderEndY, Math.max(thickness * 0.6, 2));
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
    visualPreset: HitscanVisualPreset = 'default',
  ): void {
    this.pendingPredictedTracerIds.set(shotId, this.scene.time.now + 1000);
    this.playHitscanTracer(startX, startY, endX, endY, playerColor, thickness, visualPreset);
  }

  playSyncedHitscanTracer(trace: SyncedHitscanTrace): void {
    const { startX, startY, endX, endY, color, thickness, visualPreset, shooterId, shotId } = trace;
    if (this.shouldSkipSyncedTracer(shooterId, shotId)) return;
    this.playHitscanTracer(startX, startY, endX, endY, color, thickness, visualPreset);
  }

  private playHitscanImpact(
    x: number,
    y: number,
    playerColor: number,
    thickness: number,
    visualPreset: HitscanVisualPreset,
  ): void {
    if (!isPointInsideArena(x, y)) return;
    const baseColor = visualPreset === 'asmd_primary'
      ? this.mixColor(playerColor, COLORS.BLUE_1, 0.48)
      : this.mixColor(playerColor, 0xffffff, 0.3);
    const halo = this.scene.add.circle(x, y, Math.max(thickness * 2.4, 7), baseColor, visualPreset === 'asmd_primary' ? 0.42 : 0.24);
    halo.setDepth(DEPTH_TRACE + 0.1);
    halo.setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: halo,
      alpha: 0,
      scaleX: 1.8,
      scaleY: 1.8,
      duration: visualPreset === 'asmd_primary' ? 170 : 90,
      ease: 'Quad.easeOut',
      onComplete: () => halo.destroy(),
    });

    if (visualPreset === 'asmd_primary') {
      const sparks = this.scene.add.particles(x, y, TEX_EXPLOSION_SPARK, {
        lifespan: { min: 120, max: 260 },
        quantity: 10,
        frequency: -1,
        speed: { min: 24, max: 150 },
        angle: { min: 0, max: 360 },
        scale: { start: 0.9, end: 0 },
        alpha: { start: 0.9, end: 0 },
        tint: [0xffffff, this.mixColor(playerColor, 0xffffff, 0.45), this.mixColor(playerColor, COLORS.BLUE_2, 0.3)],
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      });
      sparks.setDepth(DEPTH_TRACE + 0.12);
      sparks.explode(10);
      this.scene.time.delayedCall(320, () => sparks.destroy());
    }
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

    this.playMeleeSwingEffect(
      swing.x, swing.y,
      swing.angle, swing.arcDegrees, swing.range,
      swing.color,
    );
  }

  // ── Todes-Effekt: drei Explosionsringe + weißer Blitz ────────────────────

  private playDeathEffect(x: number, y: number): void {
    // Drei konzentrische Ringe in unterschiedlichen Farben und Verzögerungen
    const rings: Array<{ color: number; delay: number; scale: number; duration: number }> = [
      { color: 0xff6600, delay: 0,   scale: 12, duration: 550 },
      { color: 0xff3300, delay: 60,  scale: 9,  duration: 380 },
      { color: 0xffcc00, delay: 120, scale: 7,  duration: 240 },
    ];

    for (const r of rings) {
      const ring = this.scene.add.circle(x, y, 8, r.color, 1);
      ring.setDepth(DEPTH_FX);
      this.scene.tweens.add({
        targets:    ring,
        scaleX:     r.scale,
        scaleY:     r.scale,
        alpha:      0,
        delay:      r.delay,
        duration:   r.duration,
        ease:       'Power3Out',
        onComplete: () => ring.destroy(),
      });
    }
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
