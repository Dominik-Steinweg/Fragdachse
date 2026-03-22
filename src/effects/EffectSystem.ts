import Phaser from 'phaser';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { ExplosionVisualStyle, SyncedHitscanTrace, SyncedMeleeSwing } from '../types';
import { DEPTH, DEPTH_FX, DEPTH_TRACE, PLAYER_SIZE, SHOCKWAVE_RADIUS, getBeamPaletteForPlayerColor } from '../config';
import { edgeZone } from './EffectUtils';

const HITSCAN_TRACER_FADE_MS = 120;
const MELEE_SWING_FADE_MS    = 220;

const TEX_EXPLOSION_SPARK = '__explosion_spark';
const TEX_EXPLOSION_EMBER = '__explosion_ember';

export class EffectSystem {
  private pendingPredictedTracerIds = new Map<number, number>();
  private processedSyncedTracerKeys = new Map<string, number>();
  private processedMeleeSwingKeys   = new Map<string, number>();
  private texturesGenerated = false;

  constructor(
    private scene:  Phaser.Scene,
    private bridge: NetworkBridge,
  ) {}

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

    this.bridge.registerHitscanTracerHandler((startX, startY, endX, endY, color, thickness, shooterId, shotId) => {
      this.playSyncedHitscanTracer({
        startX,
        startY,
        endX,
        endY,
        color,
        thickness,
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
    const startRadius = 10;
    const endScale    = (SHOCKWAVE_RADIUS / startRadius) * 2;
    const ring = this.scene.add.circle(x, y, startRadius, 0xffcc00, 0.7);
    ring.setDepth(DEPTH_FX);
    this.scene.tweens.add({
      targets:    ring,
      scaleX:     endScale,
      scaleY:     endScale,
      alpha:      0,
      duration:   350,
      ease:       'Power2Out',
      onComplete: () => ring.destroy(),
    });
    // Kleiner weißer Kernblitz
    const flash = this.scene.add.circle(x, y, 8, 0xffffff, 1);
    flash.setDepth(DEPTH_FX);
    this.scene.tweens.add({
      targets:    flash,
      scaleX:     4,
      scaleY:     4,
      alpha:      0,
      duration:   180,
      ease:       'Power3Out',
      onComplete: () => flash.destroy(),
    });
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
    const fillColor = isHoly
      ? 0xffd700
      : (color ?? (isEnergy ? 0x73bed3 : 0xff2200));
    const flashColor = isEnergy ? 0xe8fbff : (isHoly ? 0xffffff : 0xffffcc);
    const haloColor = isEnergy
      ? this.mixColor(fillColor, 0xffffff, 0.45)
      : (isHoly ? 0xffee88 : this.mixColor(fillColor, 0xffffff, 0.2));
    const startRadius = 8;
    const endScale    = radius / startRadius;

    // 1. Innerer Blitz (weiß/hell)
    const flash = this.scene.add.circle(x, y, startRadius, flashColor, 1);
    flash.setDepth(DEPTH_FX + 1);
    const flashEndScale = (radius * 0.3) / startRadius;
    this.scene.tweens.add({
      targets:    flash,
      scaleX:     isEnergy ? flashEndScale * 1.2 : flashEndScale,
      scaleY:     isEnergy ? flashEndScale * 1.2 : flashEndScale,
      alpha:      0,
      duration:   isEnergy ? 180 : 150,
      ease:       'Power3Out',
      onComplete: () => flash.destroy(),
    });

    if (isEnergy) {
      const halo = this.scene.add.circle(x, y, startRadius, haloColor, 0.4);
      halo.setDepth(DEPTH_FX + 0.5);
      halo.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({
        targets:    halo,
        scaleX:     (radius * 0.9) / startRadius,
        scaleY:     (radius * 0.9) / startRadius,
        alpha:      0,
        duration:   420,
        ease:       'Sine.easeOut',
        onComplete: () => halo.destroy(),
      });
    }

    // 2. Haupt-Explosionsfüllung (wachsender Kreis)
    const blast = this.scene.add.circle(x, y, startRadius, fillColor, isEnergy ? 0.5 : 0.7);
    blast.setDepth(DEPTH_FX);
    if (isEnergy) {
      blast.setBlendMode(Phaser.BlendModes.ADD);
    }
    this.scene.tweens.add({
      targets:    blast,
      scaleX:     endScale,
      scaleY:     endScale,
      alpha:      0,
      duration:   isEnergy ? 520 : 600,
      ease:       isEnergy ? 'Sine.easeOut' : 'Power2Out',
      onComplete: () => blast.destroy(),
    });

    // 3. Schockwellen-Ring (Stroke-Kreis)
    const ringStartRadius = radius * 0.5;
    const ringEndScale    = (radius * 1.15) / ringStartRadius;
    const ring = this.scene.add.circle(x, y, ringStartRadius);
    ring.setStrokeStyle(isEnergy ? 3 : (isHoly ? 3 : 2), isEnergy ? haloColor : fillColor, 0.8);
    ring.setFillStyle(0, 0);
    ring.setDepth(DEPTH_FX);
    if (isEnergy) {
      ring.setBlendMode(Phaser.BlendModes.ADD);
    }
    this.scene.tweens.add({
      targets:    ring,
      scaleX:     ringEndScale,
      scaleY:     ringEndScale,
      alpha:      0,
      duration:   isEnergy ? 340 : 400,
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

    // 4. Funken-Partikel (explosiver Burst)
    const sparkTints = isHoly
      ? [0xffd700, 0xffffff, 0xffee88]
      : isEnergy
        ? [0xffffff, haloColor, fillColor]
        : [fillColor, 0xffaa00, 0xff6600];
    const sparkCount = Math.ceil(radius / (isHoly ? 3 : (isEnergy ? 2.4 : 5)));
    const sparkEmitter = this.scene.add.particles(x, y, TEX_EXPLOSION_SPARK, {
      lifespan:  isEnergy ? { min: 220, max: 520 } : { min: 300, max: 600 },
      speed:     isEnergy ? { min: radius * 0.5, max: radius * 1.9 } : { min: 50, max: radius * 1.5 },
      scale:     isEnergy ? { start: 1.45, end: 0 } : { start: 1.2, end: 0 },
      alpha:     { start: isEnergy ? 1.0 : 0.9, end: 0 },
      tint:      sparkTints,
      blendMode: Phaser.BlendModes.ADD,
      emitting:  false,
    });
    sparkEmitter.setDepth(DEPTH_FX);
    sparkEmitter.explode(sparkCount);
    this.scene.time.delayedCall(800, () => sparkEmitter.destroy());

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

    // 5. Glut-Partikel (langsamer, mit Gravitation)
    const emberTints = isHoly
      ? [0xffd700, 0xffcc00]
      : isEnergy
        ? [haloColor, fillColor, this.mixColor(fillColor, 0x172038, 0.45)]
        : [fillColor, 0xff4400];
    const emberCount = Math.ceil(radius / (isHoly ? 4 : (isEnergy ? 4.8 : 8)));
    const emberEmitter = this.scene.add.particles(x, y, TEX_EXPLOSION_EMBER, {
      lifespan:  isEnergy ? { min: 260, max: 620 } : { min: 500, max: 1000 },
      speed:     isEnergy ? { min: radius * 0.15, max: radius * 0.95 } : { min: 20, max: radius * 0.8 },
      scale:     isEnergy ? { start: 1.0, end: 0.1 } : { start: 0.8, end: 0.2 },
      alpha:     { start: isEnergy ? 0.8 : 0.7, end: 0 },
      tint:      emberTints,
      gravityY:  isEnergy ? -20 : 40,
      emitting:  false,
    });
    emberEmitter.setDepth(DEPTH_FX);
    emberEmitter.explode(emberCount);
    this.scene.time.delayedCall(isEnergy ? 900 : 1200, () => emberEmitter.destroy());

    // 6. Heilige Handgranate: zusätzlicher goldener Außenring + Kamera-Shake
    if (isHoly) {
      const holyRingRadius = radius * 0.6;
      const holyRingEndScale = (radius * 1.4) / holyRingRadius;
      const holyRing = this.scene.add.circle(x, y, holyRingRadius);
      holyRing.setStrokeStyle(4, 0xffd700, 0.6);
      holyRing.setFillStyle(0, 0);
      holyRing.setDepth(DEPTH_FX);
      this.scene.tweens.add({
        targets:    holyRing,
        scaleX:     holyRingEndScale,
        scaleY:     holyRingEndScale,
        alpha:      0,
        duration:   800,
        ease:       'Power2Out',
        onComplete: () => holyRing.destroy(),
      });

      this.scene.cameras.main.shake(300, 0.008);
    } else if (isEnergy) {
      this.scene.cameras.main.shake(180, 0.005);
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
  ): void {
    const palette = getBeamPaletteForPlayerColor(playerColor);
    const gfx = this.scene.add.graphics();
    gfx.setDepth(DEPTH_TRACE);

    this.strokeTracer(gfx, palette.shadow, Math.max(thickness + 6, 6), 0.20, startX, startY, endX, endY);
    this.strokeTracer(gfx, palette.glow, Math.max(thickness + 3, 4), 0.45, startX, startY, endX, endY);
    this.strokeTracer(gfx, palette.core, Math.max(thickness, 2), 0.95, startX, startY, endX, endY);

    gfx.fillStyle(palette.glow, 0.40);
    gfx.fillCircle(startX, startY, Math.max(thickness * 1.35, 4));
    gfx.fillStyle(palette.core, 0.85);
    gfx.fillCircle(startX, startY, Math.max(thickness * 0.75, 2));
    gfx.fillStyle(palette.core, 0.65);
    gfx.fillCircle(endX, endY, Math.max(thickness * 0.6, 2));

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
  ): void {
    this.pendingPredictedTracerIds.set(shotId, this.scene.time.now + 1000);
    this.playHitscanTracer(startX, startY, endX, endY, playerColor, thickness);
  }

  playSyncedHitscanTracer(trace: SyncedHitscanTrace): void {
    const { startX, startY, endX, endY, color, thickness, shooterId, shotId } = trace;
    if (this.shouldSkipSyncedTracer(shooterId, shotId)) return;
    this.playHitscanTracer(startX, startY, endX, endY, color, thickness);
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
