import * as Phaser from 'phaser';
import type { GroundFireVisualStyle } from '../types';
import { MAX_VISUAL_BURN_STACKS } from './EntityBurnRenderer';
import {
  FLAME_COLORS_CORE,
  FLAME_COLORS_OUTER,
  FLAME_COLORS_SPARK,
  VOID_FLAME_COLORS_CORE,
  VOID_FLAME_COLORS_OUTER,
  VOID_FLAME_COLORS_SPARK,
} from './FlameShared';
import { GpuVfxFrameId } from './gpu/GpuVfxAtlas';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import { pickGpuVfxTint } from './gpu/GpuVfxMember';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';
import { ParticleFlowScheduler } from './gpu/ParticleFlowScheduler';

/**
 * EntityBurnGpuController – ein gemeinsamer Emissions-Tick fuer *alle* brennenden Entities.
 *
 * Vorher besass jede brennende Entity drei eigene `ParticleEmitter`, die beim Entzuenden
 * entstanden und beim Verloeschen wieder zerstoert wurden. Ein Ziel, das wiederholt brennt,
 * allokierte den Satz jedes Mal neu, und die Pools hatten keine Obergrenze.
 *
 * Der Controller kehrt das um: er lebt einmal je Szene, meldet **einen** Emissions-Tick beim
 * GPUFX-Backend an und haelt je Entity nur noch Zustand – Position, Koerpergroesse, Stacks, Stil,
 * drei Flow-Scheduler und eine GPUFX-Quelle. Jeden `EntityBurnRenderer` einzeln bei
 * `registerEmission()` anzumelden waere der naheliegende, aber falsche Weg: die Registry kennt
 * kein Abmelden, die Callbacks wuerden sich ueber die Sitzung ansammeln.
 */

/** Startwerte der Flow-Countdowns; identisch mit den fruehreren `frequency`-Werten. */
const CORE_BASE_FREQUENCY_MS = 52;
const OUTER_BASE_FREQUENCY_MS = 65;
const SPARK_BASE_FREQUENCY_MS = 115;

/** Streuscheibe je Spawn, wiederverwendet – im Hotpath darf nichts allokiert werden. */
const SPAWN_CIRCLE = new Phaser.Geom.Circle(0, 0, 1);
const SPAWN_POINT = new Phaser.Math.Vector2(0, 0);

interface EntityBurnEntry {
  x: number;
  y: number;
  bodySize: number;
  visualStyle: GroundFireVisualStyle;
  /** Dirty-Check der abgeleiteten Werte, wie frueher im Renderer. */
  lastStacks: number;
  lastBodySize: number;
  coreRadius: number;
  outerRadius: number;
  sparkRadius: number;
  coreFrequency: number;
  outerFrequency: number;
  sparkFrequency: number;
  coreQuantity: number;
  outerQuantity: number;
  sparkQuantity: number;
  coreScaleStart: number;
  outerScaleStart: number;
  sparkScaleStart: number;
  coreAlphaStart: number;
  outerAlphaStart: number;
  sparkAlphaStart: number;
  coreFlow: ParticleFlowScheduler;
  outerFlow: ParticleFlowScheduler;
  sparkFlow: ParticleFlowScheduler;
  /** Alle drei Effekte dieser Entity haengen an einer Quelle. */
  source: number;
  active: boolean;
}

export class EntityBurnGpuController {
  private readonly coreSpec: GpuVfxSpawnSpec;
  private readonly outerSpec: GpuVfxSpawnSpec;
  private readonly sparkSpec: GpuVfxSpawnSpec;
  /** Indiziert ueber das Handle; Luecken bleiben stehen und werden ueber `freeHandles` recycelt. */
  private readonly entries: (EntityBurnEntry | null)[] = [];
  private readonly freeHandles: number[] = [];
  /** Dichte Liste fuer den Tick – allokationsfrei iterierbar. */
  private readonly activeEntries: EntityBurnEntry[] = [];

  constructor(private readonly system: GpuVfxSystem) {
    // Core und Outer stiegen schon bisher ohne Gravity auf; nur die Funken fallen zurueck.
    const core = system.createSpec(GpuVfxEffectId.EntityBurnCore);
    core.scaleEnd = 0.04;
    core.alphaEnd = 0;
    this.coreSpec = core;

    const outer = system.createSpec(GpuVfxEffectId.EntityBurnOuter);
    outer.scaleEnd = 0.06;
    outer.alphaEnd = 0;
    this.outerSpec = outer;

    // Die Lane traegt -34 px/s², `gravityFactor` bleibt deshalb auf 1.
    const spark = system.createSpec(GpuVfxEffectId.EntityBurnSpark);
    spark.yMode = GpuVfxEase.Gravity;
    spark.scaleEnd = 0.05;
    spark.alphaEnd = 0;
    this.sparkSpec = spark;

    system.registerEmission((deltaMs, nowMs) => this.emitParticles(deltaMs, nowMs));
  }

  /** Meldet eine brennende Entity an. Das Handle lebt so lange wie ihr `EntityBurnRenderer`. */
  acquire(): number {
    const entry: EntityBurnEntry = {
      x: 0,
      y: 0,
      bodySize: 0,
      visualStyle: 'normal',
      lastStacks: -1,
      lastBodySize: -1,
      coreRadius: 0,
      outerRadius: 0,
      sparkRadius: 0,
      coreFrequency: CORE_BASE_FREQUENCY_MS,
      outerFrequency: OUTER_BASE_FREQUENCY_MS,
      sparkFrequency: SPARK_BASE_FREQUENCY_MS,
      coreQuantity: 1,
      outerQuantity: 1,
      sparkQuantity: 1,
      coreScaleStart: 0.4,
      outerScaleStart: 0.56,
      sparkScaleStart: 0.68,
      coreAlphaStart: 1,
      outerAlphaStart: 0.82,
      sparkAlphaStart: 1,
      coreFlow: new ParticleFlowScheduler(CORE_BASE_FREQUENCY_MS),
      outerFlow: new ParticleFlowScheduler(OUTER_BASE_FREQUENCY_MS),
      sparkFlow: new ParticleFlowScheduler(SPARK_BASE_FREQUENCY_MS),
      source: this.system.createSource(GpuVfxEffectId.EntityBurnCore),
      active: false,
    };

    const recycled = this.freeHandles.pop();
    if (recycled !== undefined) {
      this.entries[recycled] = entry;
      return recycled;
    }
    this.entries.push(entry);
    return this.entries.length - 1;
  }

  /**
   * Uebernimmt Position und Brandstaerke einer Entity. Die abgeleiteten Werte werden nur bei
   * geaenderten Stacks oder Koerpergroesse neu gerechnet – dieselbe Ersparnis wie frueher im
   * Renderer.
   */
  update(
    handle: number,
    x: number,
    y: number,
    bodySize: number,
    stacks: number,
    visualStyle: GroundFireVisualStyle,
  ): void {
    const entry = this.entries[handle];
    if (!entry) return;

    entry.x = x;
    entry.y = y;
    entry.bodySize = bodySize;
    entry.visualStyle = visualStyle;
    if (!entry.active) {
      entry.active = true;
      this.activeEntries.push(entry);
    }

    const clampedStacks = Math.min(Math.max(1, Math.floor(stacks)), MAX_VISUAL_BURN_STACKS);
    if (clampedStacks === entry.lastStacks && bodySize === entry.lastBodySize) return;
    entry.lastStacks = clampedStacks;
    entry.lastBodySize = bodySize;

    const intensity = Phaser.Math.Clamp(Math.log2(clampedStacks + 1) / 5, 0.2, 1);
    const spread = Math.max(bodySize * Phaser.Math.Linear(0.42, 0.88, intensity), 10);
    entry.coreRadius = spread * 0.5;
    entry.outerRadius = spread * 0.7;
    entry.sparkRadius = spread * 0.58;

    entry.coreFrequency = Math.round(Phaser.Math.Linear(52, 14, intensity));
    entry.outerFrequency = Math.round(Phaser.Math.Linear(65, 18, intensity));
    entry.sparkFrequency = Math.round(Phaser.Math.Linear(115, 32, intensity));
    entry.coreQuantity = clampedStacks >= 8 ? 2 : 1;
    entry.outerQuantity = clampedStacks >= 12 ? 2 : 1;
    entry.sparkQuantity = 1;

    entry.coreScaleStart = 0.38 + intensity * 0.34;
    entry.outerScaleStart = 0.46 + intensity * 0.42;
    entry.sparkScaleStart = 0.48 + intensity * 0.34;

    // `emitter.setAlpha()` war die AlphaSingle-Komponente des Emitters, also ein Multiplikator
    // *ueber* der Partikelkurve – nicht deren Startwert. Deshalb hier das Produkt aus dem
    // Startwert der alten Emitter-Config und dem stackabhaengigen Faktor.
    entry.coreAlphaStart = 1 * (0.72 + intensity * 0.28);
    entry.outerAlphaStart = 0.82 * (0.55 + intensity * 0.34);
    entry.sparkAlphaStart = 1 * (0.62 + intensity * 0.38);
  }

  /**
   * Die Entity brennt nicht mehr oder ist unsichtbar. Ihre lebenden Member werden sofort
   * stillgelegt – genau das tat frueher `emitter.stop(true)`.
   */
  setInactive(handle: number): void {
    const entry = this.entries[handle];
    if (!entry || !entry.active) return;
    this.deactivate(entry);
  }

  /** Gibt Handle und Quelle frei. Der Effekt ist `kill-with-source`, die Member verschwinden. */
  release(handle: number): void {
    const entry = this.entries[handle];
    if (!entry) return;
    if (entry.active) this.deactivate(entry);
    this.system.releaseSource(entry.source);
    this.entries[handle] = null;
    this.freeHandles.push(handle);
  }

  /**
   * Rundenteardown: legt alles Sichtbare still, laesst die Handles aber gueltig. Die Entities
   * geben ihre Handles selbst beim Zerstoeren frei.
   */
  clearAll(): void {
    while (this.activeEntries.length > 0) {
      this.deactivate(this.activeEntries[this.activeEntries.length - 1]);
    }
  }

  private deactivate(entry: EntityBurnEntry): void {
    this.system.clearSource(entry.source);
    entry.active = false;
    // Beim naechsten Entzuenden sollen die abgeleiteten Werte neu gerechnet werden.
    entry.lastStacks = -1;
    entry.lastBodySize = -1;
    const index = this.activeEntries.indexOf(entry);
    if (index >= 0) this.activeEntries.splice(index, 1);
  }

  /** Vom GpuVfxSystem pro Renderframe nach dem Retire-Sweep gerufen. */
  private emitParticles(deltaMs: number, nowMs: number): void {
    const system = this.system;
    for (let index = 0; index < this.activeEntries.length; index += 1) {
      const entry = this.activeEntries[index];

      const coreFrequency = system.quality.scaleFrequency(entry.coreFrequency, GpuVfxEffectId.EntityBurnCore);
      if (coreFrequency > 0) {
        entry.coreFlow.setFrequency(coreFrequency);
        const due = entry.coreFlow.tick(deltaMs);
        for (let n = 0; n < due; n += 1) {
          for (let q = 0; q < entry.coreQuantity; q += 1) this.spawnCore(entry, nowMs);
        }
      } else {
        system.recordQualityDrop(GpuVfxEffectId.EntityBurnCore);
      }

      const outerFrequency = system.quality.scaleFrequency(entry.outerFrequency, GpuVfxEffectId.EntityBurnOuter);
      if (outerFrequency > 0) {
        entry.outerFlow.setFrequency(outerFrequency);
        const due = entry.outerFlow.tick(deltaMs);
        for (let n = 0; n < due; n += 1) {
          for (let q = 0; q < entry.outerQuantity; q += 1) this.spawnOuter(entry, nowMs);
        }
      } else {
        system.recordQualityDrop(GpuVfxEffectId.EntityBurnOuter);
      }

      const sparkFrequency = system.quality.scaleFrequency(entry.sparkFrequency, GpuVfxEffectId.EntityBurnSpark);
      if (sparkFrequency > 0) {
        entry.sparkFlow.setFrequency(sparkFrequency);
        const due = entry.sparkFlow.tick(deltaMs);
        for (let n = 0; n < due; n += 1) {
          for (let q = 0; q < entry.sparkQuantity; q += 1) this.spawnSpark(entry, nowMs);
        }
      } else {
        system.recordQualityDrop(GpuVfxEffectId.EntityBurnSpark);
      }
    }
  }

  /** Zufallspunkt in der Streuscheibe – entspricht der fruehreren `circleZone`. */
  private setSpawnPoint(spec: GpuVfxSpawnSpec, x: number, y: number, radius: number): void {
    SPAWN_CIRCLE.setTo(x, y, radius);
    Phaser.Geom.Circle.Random(SPAWN_CIRCLE, SPAWN_POINT);
    spec.x = SPAWN_POINT.x;
    spec.y = SPAWN_POINT.y;
  }

  private spawnCore(entry: EntityBurnEntry, nowMs: number): void {
    const spec = this.coreSpec;
    const isVoid = entry.visualStyle === 'void';
    spec.frame = isVoid ? GpuVfxFrameId.FlameCoreVoid : GpuVfxFrameId.FlameCore;
    spec.lifeMs = Phaser.Math.FloatBetween(190, 360);
    this.setSpawnPoint(spec, entry.x, entry.y + entry.bodySize * 0.08, entry.coreRadius);
    spec.vx = Phaser.Math.FloatBetween(-15, 15);
    spec.vy = Phaser.Math.FloatBetween(-58, -20);
    spec.rotation = Phaser.Math.DegToRad(Phaser.Math.FloatBetween(-25, 25));
    spec.scaleStart = entry.coreScaleStart;
    spec.alphaStart = entry.coreAlphaStart;
    spec.tint = pickGpuVfxTint(isVoid ? VOID_FLAME_COLORS_CORE : FLAME_COLORS_CORE);
    this.system.spawn(spec, entry.source, nowMs);
  }

  private spawnOuter(entry: EntityBurnEntry, nowMs: number): void {
    const spec = this.outerSpec;
    const isVoid = entry.visualStyle === 'void';
    spec.frame = isVoid ? GpuVfxFrameId.FlameOuterVoid : GpuVfxFrameId.FlameOuter;
    spec.lifeMs = Phaser.Math.FloatBetween(300, 560);
    this.setSpawnPoint(spec, entry.x, entry.y + entry.bodySize * 0.1, entry.outerRadius);
    spec.vx = Phaser.Math.FloatBetween(-24, 24);
    spec.vy = Phaser.Math.FloatBetween(-52, -12);
    spec.rotation = Phaser.Math.FloatBetween(0, Math.PI * 2);
    spec.scaleStart = entry.outerScaleStart;
    spec.alphaStart = entry.outerAlphaStart;
    spec.tint = pickGpuVfxTint(isVoid ? VOID_FLAME_COLORS_OUTER : FLAME_COLORS_OUTER);
    this.system.spawn(spec, entry.source, nowMs);
  }

  private spawnSpark(entry: EntityBurnEntry, nowMs: number): void {
    const spec = this.sparkSpec;
    const isVoid = entry.visualStyle === 'void';
    spec.frame = isVoid ? GpuVfxFrameId.FlameSparkVoid : GpuVfxFrameId.FlameSpark;
    spec.lifeMs = Phaser.Math.FloatBetween(220, 520);
    this.setSpawnPoint(spec, entry.x, entry.y - entry.bodySize * 0.02, entry.sparkRadius);
    spec.vx = Phaser.Math.FloatBetween(-34, 34);
    spec.vy = Phaser.Math.FloatBetween(-92, -34);
    spec.scaleStart = entry.sparkScaleStart;
    spec.alphaStart = entry.sparkAlphaStart;
    spec.tint = pickGpuVfxTint(isVoid ? VOID_FLAME_COLORS_SPARK : FLAME_COLORS_SPARK);
    this.system.spawn(spec, entry.source, nowMs);
  }
}
