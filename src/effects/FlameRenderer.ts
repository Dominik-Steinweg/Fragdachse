import Phaser from 'phaser';
import { DEPTH } from '../config';

// ── Textur-Schlüssel (einmal erzeugt, global gecacht) ──────────────────────
const TEX_FLAME_EMBER = '__flame_ember';
const TEX_FLAME_CORE  = '__flame_core';
const TEX_FLAME_SPARK = '__flame_spark';
const TEX_FLAME_GLOW  = '__flame_glow';

// ── Farb-Palette (feste Flammenfarben, KEINE Spielerfarbe) ─────────────────
const FLAME_COLORS_CORE  = [0xffee88, 0xffcc44, 0xff9922, 0xffffff];
const FLAME_COLORS_OUTER = [0xff6622, 0xff4400, 0xdd2200, 0xcc3300];
const FLAME_COLORS_SPARK = [0xffffff, 0xffee88, 0xffaa44, 0xff6622];

// ── Konfigurations-Konstanten ──────────────────────────────────────────────
const CORE_LIFESPAN    = { min: 120, max: 280 };
const OUTER_LIFESPAN   = { min: 200, max: 450 };
const SPARK_LIFESPAN   = { min: 100, max: 300 };

const DEPTH_FLAME = DEPTH.FIRE;
const DEPTH_SPARK = DEPTH.FIRE + 0.1;

// ── Interner State pro Flammen-Hitbox ──────────────────────────────────────
interface FlameVisual {
  coreEmitter:  Phaser.GameObjects.Particles.ParticleEmitter;
  outerEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  sparkEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  glowImage:    Phaser.GameObjects.Image;
}

/**
 * Rendert Flammenwerfer-Projektile als Phaser 3.90 Partikeleffekte.
 *
 * Jede Flame-Hitbox (vom Host synchronisiert) erzeugt auf Clients
 * drei Partikel-Emitter:
 * - Core: heller Kern (Weiß→Gelb→Orange)
 * - Outer: breitere äußere Flamme (Orange→Rot)
 * - Spark: vereinzelte Funken die nach oben steigen
 *
 * Standalone-Modul – wird vom ProjectileManager für style='flame' genutzt.
 */
export class FlameRenderer {
  private scene: Phaser.Scene;
  private flames = new Map<number, FlameVisual>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  // ── Texturen ──────────────────────────────────────────────────────────────

  /**
   * Erzeugt alle benötigten Texturen prozedural (einmalig pro Scene).
   * Muss vor createFlameVisual() aufgerufen werden.
   */
  generateTextures(): void {
    const texMgr = this.scene.textures;

    // Ember: weicher Kreis 16×16 – Basis für Kern- und Außenflamme
    if (!texMgr.exists(TEX_FLAME_EMBER)) {
      const s = 16;
      const canvas = texMgr.createCanvas(TEX_FLAME_EMBER, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(255,255,255,1.0)');
      grad.addColorStop(0.3, 'rgba(255,238,136,0.8)');
      grad.addColorStop(0.7, 'rgba(255,153,34,0.4)');
      grad.addColorStop(1, 'rgba(255,68,0,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }

    // Core-Textur: größerer weicher Kreis 24×24
    if (!texMgr.exists(TEX_FLAME_CORE)) {
      const s = 24;
      const canvas = texMgr.createCanvas(TEX_FLAME_CORE, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(255,255,255,1.0)');
      grad.addColorStop(0.4, 'rgba(255,255,200,0.7)');
      grad.addColorStop(0.8, 'rgba(255,200,100,0.2)');
      grad.addColorStop(1, 'rgba(255,100,0,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }

    // Spark: kleiner heller Punkt 6×6
    if (!texMgr.exists(TEX_FLAME_SPARK)) {
      const s = 6;
      const canvas = texMgr.createCanvas(TEX_FLAME_SPARK, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(255,255,255,1.0)');
      grad.addColorStop(0.5, 'rgba(255,238,136,0.6)');
      grad.addColorStop(1, 'rgba(255,170,68,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }

    // Glow: großer weicher Kreis 48×48 – additiver Leucht-Halo pro Hitbox
    if (!texMgr.exists(TEX_FLAME_GLOW)) {
      const s = 48;
      const canvas = texMgr.createCanvas(TEX_FLAME_GLOW, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(255,200,80,0.6)');
      grad.addColorStop(0.4, 'rgba(255,140,30,0.3)');
      grad.addColorStop(0.7, 'rgba(255,80,0,0.1)');
      grad.addColorStop(1, 'rgba(255,40,0,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Registriert eine neue Flammen-Hitbox für die visuelle Darstellung. */
  createFlameVisual(id: number, x: number, y: number, size: number): void {
    if (this.flames.has(id)) return;

    const spread = Math.max(size * 0.4, 4);

    // Kern-Flamme: heller, kleinerer Bereich
    const coreEmitter = this.scene.add.particles(x, y, TEX_FLAME_CORE, {
      lifespan:  CORE_LIFESPAN,
      frequency: 16,
      quantity:  2,
      speedX:    { min: -8, max: 8 },
      speedY:    { min: -30, max: -8 },
      scale:     { start: 0.3 + size * 0.01, end: 0.05 },
      alpha:     { start: 0.9, end: 0 },
      tint:      FLAME_COLORS_CORE,
      rotate:    { min: 0, max: 360 },
      blendMode: Phaser.BlendModes.ADD,
      emitting:  true,
    });
    coreEmitter.setDepth(DEPTH_FLAME + 0.05);
    coreEmitter.addEmitZone({
      type:     'random',
      source:   new Phaser.Geom.Circle(0, 0, spread * 0.4),
      quantity: 2,
    });

    // Äußere Flamme: breiter, weniger opak
    const outerEmitter = this.scene.add.particles(x, y, TEX_FLAME_EMBER, {
      lifespan:  OUTER_LIFESPAN,
      frequency: 20,
      quantity:  2,
      speedX:    { min: -14, max: 14 },
      speedY:    { min: -40, max: -5 },
      scale:     { start: 0.4 + size * 0.015, end: 0.05 },
      alpha:     { start: 0.7, end: 0 },
      tint:      FLAME_COLORS_OUTER,
      rotate:    { min: 0, max: 360 },
      blendMode: Phaser.BlendModes.ADD,
      emitting:  true,
    });
    outerEmitter.setDepth(DEPTH_FLAME);
    outerEmitter.addEmitZone({
      type:     'random',
      source:   new Phaser.Geom.Circle(0, 0, spread),
      quantity: 2,
    });

    // Funken: kleine leuchtende Partikel
    const sparkEmitter = this.scene.add.particles(x, y, TEX_FLAME_SPARK, {
      lifespan:  SPARK_LIFESPAN,
      frequency: 50,
      quantity:  1,
      speedX:    { min: -20, max: 20 },
      speedY:    { min: -50, max: -15 },
      scale:     { start: 0.6, end: 0.1 },
      alpha:     { start: 1.0, end: 0 },
      tint:      FLAME_COLORS_SPARK,
      gravityY:  -30,
      blendMode: Phaser.BlendModes.ADD,
      emitting:  true,
    });
    sparkEmitter.setDepth(DEPTH_SPARK);
    sparkEmitter.addEmitZone({
      type:     'random',
      source:   new Phaser.Geom.Circle(0, 0, spread * 0.6),
      quantity: 1,
    });

    // Glow: additiver Leucht-Halo der mit der Hitbox wächst
    const glowImage = this.scene.add.image(x, y, TEX_FLAME_GLOW);
    glowImage.setBlendMode(Phaser.BlendModes.ADD);
    glowImage.setDepth(DEPTH_FLAME - 0.1);
    glowImage.setAlpha(0.55);
    const glowScale = Math.max(size / 48 * 2.5, 0.5);
    glowImage.setScale(glowScale);
    glowImage.setTint(0xffaa44);

    this.flames.set(id, { coreEmitter, outerEmitter, sparkEmitter, glowImage });
  }

  /** Aktualisiert Position, Größe und Richtung einer Flammen-Hitbox. */
  updateFlameVisual(
    id: number, x: number, y: number,
    size: number, vx: number, vy: number,
  ): void {
    const visual = this.flames.get(id);
    if (!visual) return;

    // Emitter-Position nachführen
    visual.coreEmitter.setPosition(x, y);
    visual.outerEmitter.setPosition(x, y);
    visual.sparkEmitter.setPosition(x, y);
    visual.glowImage.setPosition(x, y);

    // Glow-Größe an Hitbox anpassen
    const glowScale = Math.max(size / 48 * 2.5, 0.5);
    visual.glowImage.setScale(glowScale);

    // Emit-Zone-Radius an wachsende Hitbox-Größe anpassen
    const spread = Math.max(size * 0.4, 4);

    visual.coreEmitter.clearEmitZones();
    visual.coreEmitter.addEmitZone({
      type:     'random',
      source:   new Phaser.Geom.Circle(0, 0, spread * 0.4),
      quantity: 2,
    });

    visual.outerEmitter.clearEmitZones();
    visual.outerEmitter.addEmitZone({
      type:     'random',
      source:   new Phaser.Geom.Circle(0, 0, spread),
      quantity: 2,
    });

    visual.sparkEmitter.clearEmitZones();
    visual.sparkEmitter.addEmitZone({
      type:     'random',
      source:   new Phaser.Geom.Circle(0, 0, spread * 0.6),
      quantity: 1,
    });

    // Skalierung an Größe anpassen: größere Hitbox = größere Partikel
    const scaleFactor = 0.3 + size * 0.01;
    visual.coreEmitter.setParticleScale(scaleFactor, 0.05);
    visual.outerEmitter.setParticleScale(0.4 + size * 0.015, 0.05);
  }

  /** Entfernt eine Flammen-Hitbox-Visualisierung. */
  destroyFlameVisual(id: number): void {
    const visual = this.flames.get(id);
    if (!visual) return;

    visual.coreEmitter.stop();
    visual.coreEmitter.destroy();
    visual.outerEmitter.stop();
    visual.outerEmitter.destroy();
    visual.sparkEmitter.stop();
    visual.sparkEmitter.destroy();
    visual.glowImage.destroy();

    this.flames.delete(id);
  }

  /** Prüft ob eine Flammen-Visualisierung existiert. */
  has(id: number): boolean {
    return this.flames.has(id);
  }

  /** Gibt alle aktiven Flammen-IDs zurück (für Orphan-Cleanup). */
  getActiveIds(): number[] {
    return [...this.flames.keys()];
  }

  /** Entfernt alle Flammen-Visualisierungen. */
  destroyAll(): void {
    for (const [id] of this.flames) {
      this.destroyFlameVisual(id);
    }
  }
}
