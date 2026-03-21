import Phaser from 'phaser';
import { COLORS, DEPTH } from '../config';
import { circleZone } from './EffectUtils';

// ── Textur-Schlüssel (einmal erzeugt, global gecacht) ──────────────────────
const TEX_BFG_CORE  = '__bfg_core';
const TEX_BFG_EMBER = '__bfg_ember';
const TEX_BFG_SPARK = '__bfg_spark';
const TEX_BFG_GLOW  = '__bfg_glow';

// ── Farb-Palette (grüne Energie, KEINE Spielerfarbe) ────────────────────────
const BFG_COLORS_CORE  = [COLORS.GREEN_1, COLORS.GREEN_2, 0xffffff, COLORS.GREEN_3];
const BFG_COLORS_OUTER = [COLORS.GREEN_3, COLORS.GREEN_4, COLORS.GREEN_5, COLORS.GREEN_6];
const BFG_COLORS_SPARK = [0xffffff, COLORS.GREEN_1, COLORS.GREEN_2];

// ── Konfigurations-Konstanten ──────────────────────────────────────────────
const CORE_LIFESPAN  = { min: 150, max: 350 };
const OUTER_LIFESPAN = { min: 250, max: 500 };
const SPARK_LIFESPAN = { min: 120, max: 350 };

const DEPTH_BFG   = DEPTH.FIRE;
const DEPTH_SPARK = DEPTH.FIRE + 0.1;

// ── Interner State pro BFG-Projektil ────────────────────────────────────────
interface BfgVisual {
  coreEmitter:  Phaser.GameObjects.Particles.ParticleEmitter;
  outerEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  sparkEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  glowImage:    Phaser.GameObjects.Image;
}

/**
 * Rendert BFG-Projektile als Phaser 3.90 Partikeleffekte.
 *
 * Drei Partikel-Emitter pro Projektil:
 * - Core: heller Kern (Weiß→Hellgrün)
 * - Outer: breiterer äußerer Energiering (Grün→Dunkelgrün)
 * - Spark: leuchtende Funken die nach außen strahlen
 *
 * Standalone-Modul – wird vom ProjectileManager für style='bfg' genutzt.
 */
export class BfgRenderer {
  private scene: Phaser.Scene;
  private visuals = new Map<number, BfgVisual>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  // ── Texturen ──────────────────────────────────────────────────────────────

  /** Erzeugt alle benötigten Texturen prozedural (einmalig pro Scene). */
  generateTextures(): void {
    const texMgr = this.scene.textures;

    // Core: 24×24 – heller grüner Kern
    if (!texMgr.exists(TEX_BFG_CORE)) {
      const s = 24;
      const canvas = texMgr.createCanvas(TEX_BFG_CORE, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(255,255,255,1.0)');
      grad.addColorStop(0.3, 'rgba(208,218,145,0.8)');   // GREEN_1-ish
      grad.addColorStop(0.7, 'rgba(168,202,88,0.3)');    // GREEN_2-ish
      grad.addColorStop(1, 'rgba(117,167,67,0.0)');      // GREEN_3-ish
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }

    // Ember: 16×16 – äußerer Energiering
    if (!texMgr.exists(TEX_BFG_EMBER)) {
      const s = 16;
      const canvas = texMgr.createCanvas(TEX_BFG_EMBER, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(168,202,88,0.9)');      // GREEN_2-ish
      grad.addColorStop(0.4, 'rgba(117,167,67,0.6)');    // GREEN_3-ish
      grad.addColorStop(0.8, 'rgba(70,130,50,0.2)');     // GREEN_4-ish
      grad.addColorStop(1, 'rgba(37,86,46,0.0)');        // GREEN_5-ish
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }

    // Spark: 6×6 – kleine leuchtende Funken
    if (!texMgr.exists(TEX_BFG_SPARK)) {
      const s = 6;
      const canvas = texMgr.createCanvas(TEX_BFG_SPARK, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(255,255,255,1.0)');
      grad.addColorStop(0.5, 'rgba(208,218,145,0.6)');   // GREEN_1-ish
      grad.addColorStop(1, 'rgba(168,202,88,0.0)');      // GREEN_2-ish
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }

    // Glow: 48×48 – großer weicher grüner Halo
    if (!texMgr.exists(TEX_BFG_GLOW)) {
      const s = 48;
      const canvas = texMgr.createCanvas(TEX_BFG_GLOW, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(168,202,88,0.6)');      // GREEN_2-ish
      grad.addColorStop(0.4, 'rgba(117,167,67,0.3)');    // GREEN_3-ish
      grad.addColorStop(0.7, 'rgba(70,130,50,0.1)');     // GREEN_4-ish
      grad.addColorStop(1, 'rgba(37,86,46,0.0)');        // GREEN_5-ish
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Registriert ein neues BFG-Projektil für die visuelle Darstellung. */
  createVisual(id: number, x: number, y: number, size: number): void {
    if (this.visuals.has(id)) return;

    const spread = Math.max(size * 0.5, 6);

    // Kern: heller grüner Bereich
    const coreEmitter = this.scene.add.particles(x, y, TEX_BFG_CORE, {
      lifespan:  CORE_LIFESPAN,
      frequency: 14,
      quantity:  3,
      speedX:    { min: -12, max: 12 },
      speedY:    { min: -12, max: 12 },
      scale:     { start: 0.4 + size * 0.012, end: 0.05 },
      alpha:     { start: 0.95, end: 0 },
      tint:      BFG_COLORS_CORE,
      rotate:    { min: 0, max: 360 },
      blendMode: Phaser.BlendModes.ADD,
      emitting:  true,
    });
    coreEmitter.setDepth(DEPTH_BFG + 0.05);
    coreEmitter.addEmitZone(circleZone(spread * 0.35, 3));
    const outerEmitter = this.scene.add.particles(x, y, TEX_BFG_EMBER, {
      lifespan:  OUTER_LIFESPAN,
      frequency: 18,
      quantity:  2,
      speedX:    { min: -18, max: 18 },
      speedY:    { min: -18, max: 18 },
      scale:     { start: 0.45 + size * 0.015, end: 0.05 },
      alpha:     { start: 0.7, end: 0 },
      tint:      BFG_COLORS_OUTER,
      rotate:    { min: 0, max: 360 },
      blendMode: Phaser.BlendModes.ADD,
      emitting:  true,
    });
    outerEmitter.setDepth(DEPTH_BFG);
    outerEmitter.addEmitZone(circleZone(spread, 2));
    const sparkEmitter = this.scene.add.particles(x, y, TEX_BFG_SPARK, {
      lifespan:  SPARK_LIFESPAN,
      frequency: 40,
      quantity:  1,
      speedX:    { min: -30, max: 30 },
      speedY:    { min: -30, max: 30 },
      scale:     { start: 0.7, end: 0.1 },
      alpha:     { start: 1.0, end: 0 },
      tint:      BFG_COLORS_SPARK,
      blendMode: Phaser.BlendModes.ADD,
      emitting:  true,
    });
    sparkEmitter.setDepth(DEPTH_SPARK);
    sparkEmitter.addEmitZone(circleZone(spread * 0.5, 1));

    // Glow: additiver grüner Halo
    const glowImage = this.scene.add.image(x, y, TEX_BFG_GLOW);
    glowImage.setBlendMode(Phaser.BlendModes.ADD);
    glowImage.setDepth(DEPTH_BFG - 0.1);
    glowImage.setAlpha(0.6);
    const glowScale = Math.max(size / 48 * 3.0, 0.6);
    glowImage.setScale(glowScale);
    glowImage.setTint(COLORS.GREEN_3);

    this.visuals.set(id, { coreEmitter, outerEmitter, sparkEmitter, glowImage });
  }

  /** Aktualisiert Position und Größe eines BFG-Projektils. */
  updateVisual(id: number, x: number, y: number, size: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;

    // Emitter-Position nachführen
    visual.coreEmitter.setPosition(x, y);
    visual.outerEmitter.setPosition(x, y);
    visual.sparkEmitter.setPosition(x, y);
    visual.glowImage.setPosition(x, y);

    // Glow-Größe an Projektil anpassen
    const glowScale = Math.max(size / 48 * 3.0, 0.6);
    visual.glowImage.setScale(glowScale);

    // Emit-Zone-Radius an Größe anpassen
    const spread = Math.max(size * 0.5, 6);

    visual.coreEmitter.clearEmitZones();
    visual.coreEmitter.addEmitZone(circleZone(spread * 0.35, 3));

    visual.outerEmitter.clearEmitZones();
    visual.outerEmitter.addEmitZone(circleZone(spread, 2));

    visual.sparkEmitter.clearEmitZones();
    visual.sparkEmitter.addEmitZone(circleZone(spread * 0.5, 1));

    // Skalierung an Größe anpassen
    visual.coreEmitter.setParticleScale(0.4 + size * 0.012, 0.05);
    visual.outerEmitter.setParticleScale(0.45 + size * 0.015, 0.05);
  }

  /** Entfernt eine BFG-Projektil-Visualisierung. */
  destroyVisual(id: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;

    visual.coreEmitter.stop();
    visual.coreEmitter.destroy();
    visual.outerEmitter.stop();
    visual.outerEmitter.destroy();
    visual.sparkEmitter.stop();
    visual.sparkEmitter.destroy();
    visual.glowImage.destroy();

    this.visuals.delete(id);
  }

  /** Prüft ob eine BFG-Visualisierung existiert. */
  has(id: number): boolean {
    return this.visuals.has(id);
  }

  /** Gibt alle aktiven BFG-IDs zurück (für Orphan-Cleanup). */
  getActiveIds(): number[] {
    return [...this.visuals.keys()];
  }

  /** Entfernt alle BFG-Visualisierungen. */
  destroyAll(): void {
    for (const [id] of this.visuals) {
      this.destroyVisual(id);
    }
  }
}
