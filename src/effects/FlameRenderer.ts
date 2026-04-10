import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { circleZone } from './EffectUtils';
import {
  ensureFlameTextures,
  FLAME_COLORS_CORE,
  FLAME_COLORS_OUTER,
  FLAME_COLORS_SPARK,
  TEX_FLAME_CORE,
  TEX_FLAME_EMBER,
  TEX_FLAME_SPARK,
  TEX_FLAME_GLOW,
} from './FlameShared';

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
    ensureFlameTextures(this.scene);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Registriert eine neue Flammen-Hitbox für die visuelle Darstellung. */
  createVisual(id: number, x: number, y: number, size: number): void {
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
    coreEmitter.addEmitZone(circleZone(spread * 0.4, 2));
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
    outerEmitter.addEmitZone(circleZone(spread, 2));
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
    sparkEmitter.addEmitZone(circleZone(spread * 0.6, 1));

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
  updateVisual(
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
    visual.coreEmitter.addEmitZone(circleZone(spread * 0.4, 2));

    visual.outerEmitter.clearEmitZones();
    visual.outerEmitter.addEmitZone(circleZone(spread, 2));

    visual.sparkEmitter.clearEmitZones();
    visual.sparkEmitter.addEmitZone(circleZone(spread * 0.6, 1));

    // Skalierung an Größe anpassen: größere Hitbox = größere Partikel
    const scaleFactor = 0.3 + size * 0.01;
    visual.coreEmitter.setParticleScale(scaleFactor, 0.05);
    visual.outerEmitter.setParticleScale(0.4 + size * 0.015, 0.05);
  }

  /** Entfernt eine Flammen-Hitbox-Visualisierung. */
  destroyVisual(id: number): void {
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
      this.destroyVisual(id);
    }
  }
}
