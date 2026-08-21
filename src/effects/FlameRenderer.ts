import * as Phaser from 'phaser';
import { DEPTH, VOID_FIRE_COLOR } from '../config';
import { emissiveAlpha } from './EmissiveScale';
import {
  ensureFlameTextures,
  ensureVoidFlameTextures,
  FLAME_COLORS_CORE,
  FLAME_COLORS_OUTER,
  FLAME_COLORS_SPARK,
  TEX_FLAME_GLOW,
  TEX_VOID_FLAME_GLOW,
  VOID_FLAME_COLORS_CORE,
  VOID_FLAME_COLORS_OUTER,
  VOID_FLAME_COLORS_SPARK,
} from './FlameShared';
import { FLAME_LIGHT_ID_STRIDE } from './LightingConfig';
import type { LightingSystem } from './LightingSystem';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import { GpuVfxFrameId } from './gpu/GpuVfxAtlas';
import { pickGpuVfxTint } from './gpu/GpuVfxMember';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';
import { GPU_VFX_NO_SOURCE_HANDLE, type GpuVfxSystem } from './gpu/GpuVfxSystem';
import { ParticleFlowScheduler } from './gpu/ParticleFlowScheduler';

// ── Konfigurations-Konstanten ──────────────────────────────────────────────
const CORE_LIFESPAN  = { min: 120, max: 280 };
const OUTER_LIFESPAN = { min: 200, max: 450 };
const SPARK_LIFESPAN = { min: 100, max: 300 };

const CORE_FREQUENCY_MS  = 16;
const OUTER_FREQUENCY_MS = 20;
const SPARK_FREQUENCY_MS = 50;

const DEPTH_FLAME = DEPTH.FIRE;

/** Scratch-Geometrie fuer die drei zufaelligen Kreis-Zonen; nie im Frame neu angelegt. */
const SPAWN_CIRCLE = new Phaser.Geom.Circle(0, 0, 1);
const SPAWN_POINT = new Phaser.Math.Vector2(0, 0);

// ── Interner State pro Flammen-Hitbox ──────────────────────────────────────
interface FlameVisual {
  x: number;
  y: number;
  size: number;
  coreFlow: ParticleFlowScheduler;
  outerFlow: ParticleFlowScheduler;
  sparkFlow: ParticleFlowScheduler;
  /** Alle drei Effekte einer Hitbox haengen an dieser Flame-Quelle. */
  source: number;
  coreTints: readonly number[];
  outerTints: readonly number[];
  sparkTints: readonly number[];
  glowImage: Phaser.GameObjects.Image;
  isVoid: boolean;
}

/**
 * Rendert Flammenwerfer-Projektile ueber die gemeinsamen GPU-VFX-Lanes.
 *
 * Die Glow-Image- und Lighting-Anteile bleiben CPU-seitig. Die drei kontinuierlichen Partikel-
 * Stroeme teilen sich die szenenweiten SpriteGPULayer, waehrend Countdown und aktueller Spawn-
 * Zustand je FlameVisual erhalten bleiben.
 */
export class FlameRenderer {
  private readonly scene: Phaser.Scene;
  private readonly flames = new Map<number, FlameVisual>();
  /** Parallel zur Map, damit der GPU-Emissionstick ohne Iterator-Allokation laeuft. */
  private readonly activeFlames: FlameVisual[] = [];
  private lighting: LightingSystem | null = null;

  private gpuVfx: GpuVfxSystem | null = null;
  private coreSpec: GpuVfxSpawnSpec | null = null;
  private outerSpec: GpuVfxSpawnSpec | null = null;
  private sparkSpec: GpuVfxSpawnSpec | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
  }

  // ── Texturen ──────────────────────────────────────────────────────────────

  /** Erzeugt alle benoetigten Flame-Texturen prozedural (idempotent pro Scene). */
  generateTextures(): void {
    ensureFlameTextures(this.scene);
    ensureVoidFlameTextures(this.scene);
  }

  /** Meldet die drei Flame-Effekte beim szenenweiten GPUFX-Backend an. */
  registerGpuVfx(system: GpuVfxSystem): void {
    if (this.gpuVfx) return;
    this.gpuVfx = system;

    this.coreSpec = system.createSpec(GpuVfxEffectId.FlameCore);
    this.coreSpec.scaleEnd = 0.05;
    this.coreSpec.alphaStart = 0.9;
    this.coreSpec.alphaEnd = 0;

    this.outerSpec = system.createSpec(GpuVfxEffectId.FlameOuter);
    this.outerSpec.scaleEnd = 0.05;
    this.outerSpec.alphaStart = 0.7;
    this.outerSpec.alphaEnd = 0;

    this.sparkSpec = system.createSpec(GpuVfxEffectId.FlameSpark);
    this.sparkSpec.scaleStart = 0.6;
    this.sparkSpec.scaleEnd = 0.1;
    this.sparkSpec.alphaStart = 1;
    this.sparkSpec.alphaEnd = 0;
    this.sparkSpec.yMode = GpuVfxEase.Gravity;

    system.registerEmission((deltaMs, nowMs) => this.emitParticles(deltaMs, nowMs));
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Registriert eine neue Flammen-Hitbox fuer die visuelle Darstellung. */
  createVisual(id: number, x: number, y: number, size: number, color: number): void {
    if (this.flames.has(id)) return;

    const isVoid = color === VOID_FIRE_COLOR;
    const coreTints = isVoid ? VOID_FLAME_COLORS_CORE : FLAME_COLORS_CORE;
    const outerTints = isVoid ? VOID_FLAME_COLORS_OUTER : FLAME_COLORS_OUTER;
    const sparkTints = isVoid ? VOID_FLAME_COLORS_SPARK : FLAME_COLORS_SPARK;

    // Glow: additiver Leucht-Halo der mit der Hitbox waechst.
    const glowImage = this.scene.add.image(
      x,
      y,
      isVoid ? TEX_VOID_FLAME_GLOW : TEX_FLAME_GLOW,
    );
    glowImage.setBlendMode(Phaser.BlendModes.ADD);
    glowImage.setDepth(DEPTH_FLAME - 0.1);
    glowImage.setAlpha(emissiveAlpha(isVoid ? 0.82 : 0.55));
    glowImage.setScale(Math.max(size / 48 * 2.5, 0.5));
    glowImage.setTint(isVoid ? VOID_FIRE_COLOR : 0xffaa44);

    const visual: FlameVisual = {
      x,
      y,
      size,
      coreFlow: new ParticleFlowScheduler(CORE_FREQUENCY_MS),
      outerFlow: new ParticleFlowScheduler(OUTER_FREQUENCY_MS),
      sparkFlow: new ParticleFlowScheduler(SPARK_FREQUENCY_MS),
      source: this.gpuVfx?.createSource(GpuVfxEffectId.FlameCore) ?? GPU_VFX_NO_SOURCE_HANDLE,
      coreTints,
      outerTints,
      sparkTints,
      glowImage,
      isVoid,
    };

    this.flames.set(id, visual);
    this.activeFlames.push(visual);
  }

  /** Aktualisiert Position, Groesse und Richtung einer Flammen-Hitbox. */
  updateVisual(
    id: number,
    x: number,
    y: number,
    size: number,
    vx: number,
    vy: number,
  ): void {
    const visual = this.flames.get(id);
    if (!visual) return;

    // Bereits gespawnte GPU-Member werden nicht editiert; nur der naechste Spawn nimmt den
    // aktuellen Hitbox-Zustand auf. vx/vy bleiben Teil des bestehenden Renderer-Vertrags.
    void vx;
    void vy;
    visual.x = x;
    visual.y = y;
    visual.size = size;
    visual.glowImage.setPosition(x, y);
    visual.glowImage.setScale(Math.max(size / 48 * 2.5, 0.5));

    // Nur jede n-te Hitbox traegt Licht – sonst ueberstrahlt ein einzelner Strahl das gesamte
    // Frame-Budget. Freigabe laeuft ueber destroyVisual().
    if (id % FLAME_LIGHT_ID_STRIDE === 0) {
      this.lighting?.setLight(`flame:${id}`, visual.isVoid ? 'voidFlameProjectile' : 'flameProjectile', x, y, {
        radiusPx: visual.isVoid ? 96 + size * 2.55 : 80 + size * 2.2,
      });
    }
  }

  /** Entfernt eine Flammen-Hitbox-Visualisierung und nur deren GPUFX-Quelle. */
  destroyVisual(id: number): void {
    this.lighting?.releaseLight(`flame:${id}`);
    const visual = this.flames.get(id);
    if (!visual) return;

    this.gpuVfx?.releaseSource(visual.source);
    visual.glowImage.destroy();

    const index = this.activeFlames.indexOf(visual);
    if (index >= 0) this.activeFlames.splice(index, 1);
    this.flames.delete(id);
  }

  /** Prueft ob eine Flammen-Visualisierung existiert. */
  has(id: number): boolean {
    return this.flames.has(id);
  }

  /** Gibt alle aktiven Flammen-IDs zurueck (fuer Orphan-Cleanup). */
  getActiveIds(): number[] {
    return [...this.flames.keys()];
  }

  /** Entfernt alle Flammen-Visualisierungen und laesst andere GPUFX-Effekte unangetastet. */
  destroyAll(): void {
    for (const [id] of this.flames) this.destroyVisual(id);
  }

  // ── GPU-Emission ──────────────────────────────────────────────────────────

  /** Vom GpuVfxSystem pro Renderframe nach dem Retire-Sweep gerufen. */
  private emitParticles(deltaMs: number, nowMs: number): void {
    const system = this.gpuVfx;
    const coreSpec = this.coreSpec;
    const outerSpec = this.outerSpec;
    const sparkSpec = this.sparkSpec;
    if (!system || !coreSpec || !outerSpec || !sparkSpec) return;

    const coreFrequency = system.quality.scaleFrequency(CORE_FREQUENCY_MS, GpuVfxEffectId.FlameCore);
    const outerFrequency = system.quality.scaleFrequency(OUTER_FREQUENCY_MS, GpuVfxEffectId.FlameOuter);
    const sparkFrequency = system.quality.scaleFrequency(SPARK_FREQUENCY_MS, GpuVfxEffectId.FlameSpark);

    for (let index = 0; index < this.activeFlames.length; index += 1) {
      const visual = this.activeFlames[index];

      if (coreFrequency > 0) {
        visual.coreFlow.setFrequency(coreFrequency);
        const due = visual.coreFlow.tick(deltaMs);
        for (let n = 0; n < due; n += 1) {
          this.spawnCore(visual, coreSpec, nowMs);
          this.spawnCore(visual, coreSpec, nowMs);
        }
      } else {
        system.recordQualityDrop(GpuVfxEffectId.FlameCore);
      }

      if (outerFrequency > 0) {
        visual.outerFlow.setFrequency(outerFrequency);
        const due = visual.outerFlow.tick(deltaMs);
        for (let n = 0; n < due; n += 1) {
          this.spawnOuter(visual, outerSpec, nowMs);
          this.spawnOuter(visual, outerSpec, nowMs);
        }
      } else {
        system.recordQualityDrop(GpuVfxEffectId.FlameOuter);
      }

      if (sparkFrequency > 0) {
        visual.sparkFlow.setFrequency(sparkFrequency);
        const due = visual.sparkFlow.tick(deltaMs);
        for (let n = 0; n < due; n += 1) this.spawnSpark(visual, sparkSpec, nowMs);
      } else {
        system.recordQualityDrop(GpuVfxEffectId.FlameSpark);
      }
    }
  }

  private spawnCore(visual: FlameVisual, spec: GpuVfxSpawnSpec, nowMs: number): void {
    const system = this.gpuVfx;
    if (!system) return;

    spec.frame = visual.isVoid ? GpuVfxFrameId.FlameCoreVoid : GpuVfxFrameId.FlameCore;
    spec.lifeMs = Phaser.Math.FloatBetween(CORE_LIFESPAN.min, CORE_LIFESPAN.max);
    this.setSpawnPoint(visual, Math.max(visual.size * 0.4, 4) * 0.4, spec);
    spec.vx = Phaser.Math.FloatBetween(-8, 8);
    spec.vy = Phaser.Math.FloatBetween(-30, -8);
    spec.rotation = Phaser.Math.FloatBetween(0, 360) * Math.PI / 180;
    spec.scaleStart = 0.3 + visual.size * 0.01;
    spec.tint = pickGpuVfxTint(visual.coreTints);
    system.spawn(spec, visual.source, nowMs);
  }

  private spawnOuter(visual: FlameVisual, spec: GpuVfxSpawnSpec, nowMs: number): void {
    const system = this.gpuVfx;
    if (!system) return;

    spec.frame = visual.isVoid ? GpuVfxFrameId.FlameOuterVoid : GpuVfxFrameId.FlameOuter;
    spec.lifeMs = Phaser.Math.FloatBetween(OUTER_LIFESPAN.min, OUTER_LIFESPAN.max);
    this.setSpawnPoint(visual, Math.max(visual.size * 0.4, 4), spec);
    spec.vx = Phaser.Math.FloatBetween(-14, 14);
    spec.vy = Phaser.Math.FloatBetween(-40, -5);
    spec.rotation = Phaser.Math.FloatBetween(0, 360) * Math.PI / 180;
    spec.scaleStart = 0.4 + visual.size * 0.015;
    spec.tint = pickGpuVfxTint(visual.outerTints);
    system.spawn(spec, visual.source, nowMs);
  }

  private spawnSpark(visual: FlameVisual, spec: GpuVfxSpawnSpec, nowMs: number): void {
    const system = this.gpuVfx;
    if (!system) return;

    spec.frame = visual.isVoid ? GpuVfxFrameId.FlameSparkVoid : GpuVfxFrameId.FlameSpark;
    spec.lifeMs = Phaser.Math.FloatBetween(SPARK_LIFESPAN.min, SPARK_LIFESPAN.max);
    this.setSpawnPoint(visual, Math.max(visual.size * 0.4, 4) * 0.6, spec);
    spec.vx = Phaser.Math.FloatBetween(-20, 20);
    spec.vy = Phaser.Math.FloatBetween(-50, -15);
    spec.rotation = 0;
    spec.tint = pickGpuVfxTint(visual.sparkTints);
    system.spawn(spec, visual.source, nowMs);
  }

  private setSpawnPoint(visual: FlameVisual, radius: number, spec: GpuVfxSpawnSpec): void {
    SPAWN_CIRCLE.setTo(visual.x, visual.y, radius);
    Phaser.Geom.Circle.Random(SPAWN_CIRCLE, SPAWN_POINT);
    spec.x = SPAWN_POINT.x;
    spec.y = SPAWN_POINT.y;
  }
}
