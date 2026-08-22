import * as Phaser from 'phaser';
import { COLORS, DEPTH, DEPTH_TRACE } from '../config';
import {
  blendBeamPaths,
  createJitteredBeamPath,
  reanchorBeamPathStart,
  resampleBeamSpline,
  sampleBeamPath,
  sampleBeamTangent,
  strokeBeamPolyline,
  type BeamPoint,
} from './BeamPathShared';
import {
  configureAdditiveImage,
  createEmitter,
  destroyEmitter,
  fillRadialGradientTexture,
  makeAdditive,
  setCircleEmitZone,
} from './EffectUtils';
import { emissiveAlpha } from './EmissiveScale';

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

const BFG_GLOW_ALPHA = 0.2;
const BFG_GLOW_TINT = 0xa6ff86;
const BFG_GLOW_SCALE_PER_SIZE = 12;
const BFG_GLOW_MIN_SCALE = 0.6;
const BFG_GLOW_PULSE_SCALE = 0.07;
const BFG_GLOW_PULSE_ALPHA = 0.06;
const BFG_GLOW_PULSE_SPEED = (Math.PI * 2 * 1.1) / 1000;

const DEPTH_BFG   = DEPTH.FIRE;
const DEPTH_SPARK = DEPTH.FIRE + 0.1;

const BFG_BEAM_HOLD_MS = 240;
const BFG_BEAM_FADE_MS = 160;
const BFG_BEAM_GEOMETRY_REFRESH_MS = 38;
const BFG_BEAM_CONTROL_POINT_SPACING_PX = 92;
const BFG_BEAM_RESAMPLE_SPACING_PX = 9;
const BFG_BEAM_MIN_CONTROL_POINTS = 4;
const BFG_BEAM_MAX_CONTROL_POINTS = 8;
const BFG_BEAM_MIN_RESAMPLED_POINTS = 14;
const BFG_BEAM_MAX_RESAMPLED_POINTS = 72;
const BFG_BEAM_MAX_SIDE_BRANCHES = 1;
const BFG_BEAM_DEPTH = DEPTH_TRACE + 0.18;

interface BfgLaserLine {
  readonly sx: number;
  readonly sy: number;
  readonly ex: number;
  readonly ey: number;
}

interface BfgBeamVisual {
  readonly root: Phaser.GameObjects.Container;
  readonly glow: Phaser.GameObjects.Graphics;
  readonly body: Phaser.GameObjects.Graphics;
  readonly core: Phaser.GameObjects.Graphics;
  readonly branches: Phaser.GameObjects.Graphics;
  projectileId: number;
  path: BeamPoint[];
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  activeUntil: number;
  fadeEndsAt: number;
  nextGeometryAt: number;
}

// ── Interner State pro BFG-Projektil ────────────────────────────────────────
interface BfgVisual {
  coreEmitter:  Phaser.GameObjects.Particles.ParticleEmitter;
  outerEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  sparkEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  glowImage:    Phaser.GameObjects.Image;
  glowBaseScale: number;
  glowPhase: number;
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
  private visuals = new Map<number, BfgVisual>();
  private readonly beams = new Map<string, BfgBeamVisual>();
  private readonly beamPool: BfgBeamVisual[] = [];
  private readonly projectilePositions = new Map<number, BeamPoint>();
  private nextBeamId = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroyAll, this);
  }

  // ── Texturen ──────────────────────────────────────────────────────────────

  /** Erzeugt alle benötigten Texturen prozedural (einmalig pro Scene). */
  generateTextures(): void {
    const texMgr = this.scene.textures;

    // Core: 24×24 – heller grüner Kern
    fillRadialGradientTexture(texMgr, TEX_BFG_CORE, 24, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.3, 'rgba(208,218,145,0.8)'],
      [0.7, 'rgba(168,202,88,0.3)'],
      [1, 'rgba(117,167,67,0.0)'],
    ]);

    // Ember: 16×16 – äußerer Energiering
    fillRadialGradientTexture(texMgr, TEX_BFG_EMBER, 16, [
      [0, 'rgba(168,202,88,0.9)'],
      [0.4, 'rgba(117,167,67,0.6)'],
      [0.8, 'rgba(70,130,50,0.2)'],
      [1, 'rgba(37,86,46,0.0)'],
    ]);

    // Spark: 6×6 – kleine leuchtende Funken
    fillRadialGradientTexture(texMgr, TEX_BFG_SPARK, 6, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.5, 'rgba(208,218,145,0.6)'],
      [1, 'rgba(168,202,88,0.0)'],
    ]);

    // Glow: 48×48 – großer weicher grüner Halo
    fillRadialGradientTexture(texMgr, TEX_BFG_GLOW, 48, [
      [0, 'rgba(176,255,143,0.72)'],
      [0.35, 'rgba(154,255,128,0.38)'],
      [0.68, 'rgba(91,190,70,0.14)'],
      [0.86, 'rgba(50,116,40,0.04)'],
      [1, 'rgba(37,86,46,0.0)'],
    ]);
  }

  /** Draws one authoritative pulse as a batch of short-lived, projectile-anchored beams. */
  playLaserBatch(lines: readonly BfgLaserLine[], projectileId: number): void {
    if (lines.length === 0) return;
    const now = this.scene.time.now;
    const projectilePosition = this.projectilePositions.get(projectileId);

    for (const line of lines) {
      const beamId = `${projectileId}:${this.nextBeamId++}`;
      const visual = this.acquireBeam(beamId);
      const startX = projectilePosition?.x ?? line.sx;
      const startY = projectilePosition?.y ?? line.sy;
      visual.projectileId = projectileId;
      visual.path = [
        { x: startX, y: startY },
        { x: line.ex, y: line.ey },
      ];
      visual.startX = startX;
      visual.startY = startY;
      visual.endX = line.ex;
      visual.endY = line.ey;
      visual.activeUntil = now + BFG_BEAM_HOLD_MS;
      visual.fadeEndsAt = visual.activeUntil + BFG_BEAM_FADE_MS;
      visual.nextGeometryAt = now;
      visual.root.setVisible(true).setAlpha(1);
    }
  }

  /** Advances beam lifetimes and reanchors every visible beam to its projectile each frame. */
  update(): void {
    const now = this.scene.time.now;
    for (const visual of this.visuals.values()) {
      this.updateGlowPulse(visual, now);
    }

    for (const [beamId, visual] of this.beams) {
      if (now >= visual.fadeEndsAt) {
        this.recycleBeam(beamId, visual);
        continue;
      }

      const projectilePosition = this.projectilePositions.get(visual.projectileId);
      if (projectilePosition) {
        const shiftX = projectilePosition.x - visual.startX;
        const shiftY = projectilePosition.y - visual.startY;
        if ((shiftX * shiftX) + (shiftY * shiftY) > 0.0001) {
          reanchorBeamPathStart(visual.path, shiftX, shiftY);
          visual.startX = projectilePosition.x;
          visual.startY = projectilePosition.y;
        }
      }

      if (now >= visual.nextGeometryAt) {
        this.drawBeam(visual, now);
        visual.nextGeometryAt = now + BFG_BEAM_GEOMETRY_REFRESH_MS;
      }

      const active = now <= visual.activeUntil;
      const alpha = active
        ? 1
        : Phaser.Math.Clamp(1 - ((now - visual.activeUntil) / BFG_BEAM_FADE_MS), 0, 1);
      visual.root.setAlpha(alpha);
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Registriert ein neues BFG-Projektil für die visuelle Darstellung. */
  createVisual(id: number, x: number, y: number, size: number): void {
    if (this.visuals.has(id)) return;
    this.projectilePositions.set(id, { x, y });

    const spread = Math.max(size * 0.5, 6);

    // Kern: heller grüner Bereich
    const coreEmitter = createEmitter(this.scene, x, y, TEX_BFG_CORE, {
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
    }, DEPTH_BFG + 0.05);
    setCircleEmitZone(coreEmitter, spread * 0.35, 3);

    const outerEmitter = createEmitter(this.scene, x, y, TEX_BFG_EMBER, {
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
    }, DEPTH_BFG);
    setCircleEmitZone(outerEmitter, spread, 2);

    const sparkEmitter = createEmitter(this.scene, x, y, TEX_BFG_SPARK, {
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
    }, DEPTH_SPARK);
    setCircleEmitZone(sparkEmitter, spread * 0.5, 1);

    // Glow: additiver grüner Halo
    const glowImage = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_BFG_GLOW),
      DEPTH_BFG - 0.1,
      BFG_GLOW_ALPHA,
      BFG_GLOW_TINT,
    );
    const glowBaseScale = this.getGlowScale(size);
    glowImage.setScale(glowBaseScale);

    this.visuals.set(id, {
      coreEmitter,
      outerEmitter,
      sparkEmitter,
      glowImage,
      glowBaseScale,
      glowPhase: id * 0.37,
    });
  }

  /** Aktualisiert Position und Größe eines BFG-Projektils. */
  updateVisual(id: number, x: number, y: number, size: number): void {
    this.projectilePositions.set(id, { x, y });
    const visual = this.visuals.get(id);
    if (!visual) return;

    // Emitter-Position nachführen
    visual.coreEmitter.setPosition(x, y);
    visual.outerEmitter.setPosition(x, y);
    visual.sparkEmitter.setPosition(x, y);
    visual.glowImage.setPosition(x, y);

    // Glow-Größe an Projektil anpassen
    visual.glowBaseScale = this.getGlowScale(size);

    // Emit-Zone-Radius an Größe anpassen
    const spread = Math.max(size * 0.5, 6);

    setCircleEmitZone(visual.coreEmitter, spread * 0.35, 3, true);

    setCircleEmitZone(visual.outerEmitter, spread, 2, true);

    setCircleEmitZone(visual.sparkEmitter, spread * 0.5, 1, true);

    // Skalierung an Größe anpassen
    visual.coreEmitter.setParticleScale(0.4 + size * 0.012, 0.05);
    visual.outerEmitter.setParticleScale(0.45 + size * 0.015, 0.05);
  }

  /** Entfernt eine BFG-Projektil-Visualisierung. */
  destroyVisual(id: number): void {
    this.projectilePositions.delete(id);
    const visual = this.visuals.get(id);
    if (!visual) return;

    destroyEmitter(visual.coreEmitter);
    destroyEmitter(visual.outerEmitter);
    destroyEmitter(visual.sparkEmitter);
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

  private getGlowScale(size: number): number {
    return Math.max(size / 48 * BFG_GLOW_SCALE_PER_SIZE, BFG_GLOW_MIN_SCALE);
  }

  private updateGlowPulse(visual: BfgVisual, now: number): void {
    const pulse = Math.sin(now * BFG_GLOW_PULSE_SPEED + visual.glowPhase);
    visual.glowImage
      .setScale(visual.glowBaseScale * (1 + pulse * BFG_GLOW_PULSE_SCALE))
      .setAlpha(emissiveAlpha(BFG_GLOW_ALPHA * (1 + pulse * BFG_GLOW_PULSE_ALPHA)));
  }

  /** Entfernt alle BFG-Visualisierungen. */
  destroyAll(): void {
    for (const [beamId, beam] of this.beams) {
      this.destroyBeamVisual(beam);
      this.beams.delete(beamId);
    }
    for (const beam of this.beamPool) this.destroyBeamVisual(beam);
    this.beamPool.length = 0;
    this.projectilePositions.clear();
    for (const [id] of this.visuals) {
      this.destroyVisual(id);
    }
  }

  private acquireBeam(beamId: string): BfgBeamVisual {
    const visual = this.beamPool.pop() ?? this.createBeamVisual();
    visual.projectileId = -1;
    visual.path = [];
    visual.startX = 0;
    visual.startY = 0;
    visual.endX = 0;
    visual.endY = 0;
    visual.activeUntil = 0;
    visual.fadeEndsAt = 0;
    visual.nextGeometryAt = this.scene.time.now;
    visual.root.setVisible(true).setAlpha(1);
    this.beams.set(beamId, visual);
    return visual;
  }

  private createBeamVisual(): BfgBeamVisual {
    const root = this.scene.add.container(0, 0).setDepth(BFG_BEAM_DEPTH);
    const glow = makeAdditive(this.scene.add.graphics());
    const body = makeAdditive(this.scene.add.graphics());
    const core = makeAdditive(this.scene.add.graphics());
    const branches = makeAdditive(this.scene.add.graphics());
    root.add([glow, body, core, branches]);
    return {
      root,
      glow,
      body,
      core,
      branches,
      projectileId: -1,
      path: [],
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      activeUntil: 0,
      fadeEndsAt: 0,
      nextGeometryAt: 0,
    };
  }

  private recycleBeam(beamId: string, visual: BfgBeamVisual): void {
    visual.glow.clear();
    visual.body.clear();
    visual.core.clear();
    visual.branches.clear();
    visual.path = [];
    visual.root.setVisible(false).setAlpha(0);
    this.beams.delete(beamId);
    this.beamPool.push(visual);
  }

  private destroyBeamVisual(visual: BfgBeamVisual): void {
    visual.root.removeAll(true);
    visual.root.destroy();
  }

  private drawBeam(visual: BfgBeamVisual, now: number): void {
    const dx = visual.endX - visual.startX;
    const dy = visual.endY - visual.startY;
    const length = Math.hypot(dx, dy);
    const controlCount = Phaser.Math.Clamp(
      Math.ceil(length / BFG_BEAM_CONTROL_POINT_SPACING_PX) + 1,
      BFG_BEAM_MIN_CONTROL_POINTS,
      BFG_BEAM_MAX_CONTROL_POINTS,
    );
    const divisions = Phaser.Math.Clamp(
      Math.ceil(length / BFG_BEAM_RESAMPLE_SPACING_PX),
      BFG_BEAM_MIN_RESAMPLED_POINTS,
      BFG_BEAM_MAX_RESAMPLED_POINTS,
    );
    const jitter = Phaser.Math.Clamp(length * 0.005 + 0.55, 1.1, 4.6);
    const phase = now * 0.008 + visual.projectileId * 0.19;
    const start = { x: visual.startX, y: visual.startY };
    const end = { x: visual.endX, y: visual.endY };
    const nextPath = createJitteredBeamPath(start, end, controlCount, divisions, jitter, phase);
    visual.path = blendBeamPaths(visual.path, nextPath, 0.46, start, end);

    visual.glow.clear();
    strokeBeamPolyline(visual.glow, visual.path, 7.2, COLORS.GREEN_5, 0.09);
    strokeBeamPolyline(visual.glow, visual.path, 3.8, COLORS.GREEN_3, 0.18);

    visual.body.clear();
    strokeBeamPolyline(visual.body, visual.path, 2.1, COLORS.GREEN_2, 0.78);

    visual.core.clear();
    strokeBeamPolyline(visual.core, visual.path, 0.72, COLORS.GREEN_1, 0.94);
    visual.core.fillStyle(COLORS.GREEN_1, 0.72);
    visual.core.fillCircle(visual.startX, visual.startY, 2.4);
    visual.core.fillCircle(visual.endX, visual.endY, 1.8);

    visual.branches.clear();
    this.drawSideBranches(visual.branches, visual.path, length, jitter, phase);
  }

  private drawSideBranches(
    graphics: Phaser.GameObjects.Graphics,
    path: readonly BeamPoint[],
    length: number,
    jitter: number,
    phase: number,
  ): void {
    if (path.length < 4 || Math.random() >= 0.18) return;
    for (let branch = 0; branch < BFG_BEAM_MAX_SIDE_BRANCHES; branch += 1) {
      const pivotT = Phaser.Math.FloatBetween(0.28, 0.78);
      const pivot = sampleBeamPath(path, pivotT);
      const tangent = sampleBeamTangent(path, pivotT);
      const side = Math.random() < 0.5 ? -1 : 1;
      const angle = Math.atan2(tangent.y, tangent.x) + side * Phaser.Math.FloatBetween(0.72, 1.02);
      const branchLength = Phaser.Math.Clamp(length * Phaser.Math.FloatBetween(0.035, 0.06), 8, 18);
      const end = {
        x: pivot.x + Math.cos(angle) * branchLength,
        y: pivot.y + Math.sin(angle) * branchLength,
      };
      const branchPath = resampleBeamSpline(
        [
          { ...pivot },
          {
            x: Phaser.Math.Linear(pivot.x, end.x, 0.5) + Phaser.Math.FloatBetween(-jitter, jitter),
            y: Phaser.Math.Linear(pivot.y, end.y, 0.5) + Phaser.Math.FloatBetween(-jitter, jitter),
          },
          { ...end },
        ],
        7,
      );
      strokeBeamPolyline(graphics, branchPath, 2.5, COLORS.GREEN_4, 0.11);
      strokeBeamPolyline(graphics, branchPath, 0.62, COLORS.GREEN_1, 0.72 + Math.sin(phase) * 0.08);
    }
  }
}
