import * as Phaser from 'phaser';
import { BLOOD_HIT_VFX } from '../../config';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { getVisibleWorldView } from '../../ui/HostileBaseIndicator';
import { WaterDisturbanceField } from '../../arena/WaterDisturbanceField';
import type { FormationCoverageBinding } from '../../arena/rocks/RockFormationLighting';
import type { SunCloudState } from '../sunlight/cloudShadow';
import { BloodChannel, BloodFieldModel, BloodMarkKind } from './BloodFieldModel';
import { BloodMarkPlanner, type BloodFlightKind, type BloodHitInput } from './BloodMarkPlanner';
import { BloodFieldRenderer, type BloodNightLight } from './BloodFieldRenderer';
import type { BloodLanding, BloodTerrain } from './BloodTerrain';

type Rect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

/** The current World as the blood field sees it; every member is read-only presentation input. */
export interface BloodWorld {
  readonly terrain: BloodTerrain;
  rockCoverage(): FormationCoverageBinding | null;
  /** Standing bridge decks in world space. */
  decks(): readonly Rect[];
  sunlight(): SunCloudState | undefined;
  night(): BloodNightLight | null;
  /** Receives the water channel as dye; null on Worlds without water. */
  water(): BloodWaterDyeTarget | null;
}

/** Water surface input for the blood clouds (see `WaterSurfaceRenderer.setDye`). */
export interface BloodWaterDyeTarget {
  setDye(binding: { readonly textureKey: string; readonly rect: Float32Array; readonly flipY: boolean;
    readonly hueKey?: string | null } | null): void;
}

/** What the combat gore renderer needs to land its spray and leave marks. */
export interface BloodHitPort {
  beginHit(hit: Omit<BloodHitInput, 'nowMs'>): void;
  land(startX: number, startY: number, endX: number, endY: number, over: number, out: BloodLanding): BloodLanding;
  flight(kind: BloodFlightKind, landing: Readonly<BloodLanding>, startX: number, startY: number,
    travelRatio: number, sizeScale: number, delayMs: number): void;
  endHit(): void;
}

export interface BloodFieldStats {
  readonly marks: number;
  readonly pools: number;
  readonly rock: number;
  readonly water: number;
  readonly budget: number;
}

/**
 * Scene owner of the persistent blood: the mark model, the planner that turns hits into marks,
 * and the GPU field. World terrain arrives through a provider; a new World starts a clean field.
 * Pure presentation: nothing here is replicated or read by gameplay.
 */
const instances = new WeakMap<Phaser.Scene, BloodFieldSystem>();

export class BloodFieldSystem implements BloodHitPort {
  /** The scene's blood field; secondary blood sources (rage bursts) pour into it. */
  static for(scene: Phaser.Scene): BloodFieldSystem | null { return instances.get(scene) ?? null; }
  readonly model: BloodFieldModel;
  private readonly planner: BloodMarkPlanner;
  private readonly renderer: BloodFieldRenderer;
  private worldSource: (() => BloodWorld | null) | null = null;
  private world: BloodWorld | null = null;
  private dyeTarget: BloodWaterDyeTarget | null = null;
  private dyeKey: string | null = null;
  private dyeHueKey: string | null = null;
  private destroyed = false;
  // Bound once: listeners need no emitter context and come off exactly.
  private readonly postUpdate = (): void => this.onPostUpdate();
  private readonly preRender = (): void => this.onPreRender();
  private readonly shutdown = (): void => this.destroy();

  constructor(private readonly scene: Phaser.Scene) {
    const field = BLOOD_HIT_VFX.field;
    this.model = new BloodFieldModel(field.budget.high, scene.time.now);
    this.planner = new BloodMarkPlanner(this.model, field);
    this.renderer = new BloodFieldRenderer(scene, this.model);
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.postUpdate);
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.preRender);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown);
    instances.set(scene, this);
  }

  /** Current World provider; evaluated every frame, a different World clears the field. */
  setWorldSource(source: (() => BloodWorld | null) | null): void {
    this.worldSource = source;
    this.syncWorld();
  }

  beginHit(hit: Omit<BloodHitInput, 'nowMs'>): void {
    // Hits carry their body's blood colour (absent = the default red).
    if (this.destroyed) return;
    this.syncWorld();
    this.planner.beginHit({ ...hit, nowMs: this.scene.time.now });
  }

  land(startX: number, startY: number, endX: number, endY: number, over: number, out: BloodLanding): BloodLanding {
    return this.planner.land(startX, startY, endX, endY, over, out);
  }

  flight(kind: BloodFlightKind, landing: Readonly<BloodLanding>, startX: number, startY: number,
    travelRatio: number, sizeScale: number, delayMs: number): void {
    if (!this.destroyed) this.planner.flight(kind, landing, startX, startY, travelRatio, sizeScale, delayMs);
  }

  endHit(): void { if (!this.destroyed) this.planner.endHit(); }

  /** Blood poured without a shot direction (rage burst, bleeding); merges like hit pools. */
  pour(x: number, y: number, area: number, seed: number, delayMs = 0, lifeMs: number = BLOOD_HIT_VFX.field.lifeMs.medium,
    color?: number): void {
    if (this.destroyed) return;
    this.syncWorld();
    this.planner.pourAt(x, y, area, this.scene.time.now + delayMs, lifeMs, seed, undefined, color);
  }

  /** World teardown: every mark and ripple goes; the clock restarts. */
  clear(): void {
    if (this.destroyed) return;
    this.model.clear(this.scene.time.now);
    this.planner.clear();
    this.renderer.hide();
    this.releaseDye();
  }

  getStats(): BloodFieldStats {
    return {
      marks: this.model.count,
      pools: this.model.countOf(BloodMarkKind.Pool, BloodChannel.Ground),
      rock: this.model.countOf(undefined, BloodChannel.Rock),
      water: this.model.countOf(undefined, BloodChannel.Water),
      budget: BLOOD_HIT_VFX.field.budget[getGraphicsQualityProfile(this.scene).level],
    };
  }

  /** Receiver diagnostics for the review lab. */
  debugState() {
    return { ...this.renderer.debugState(), world: !!this.world, rockSource: !!this.world?.rockCoverage(),
      tinted: this.model.tintedCount, dye: this.dyeKey, dyeHue: this.dyeHueKey, water: !!this.dyeTarget };
  }

  /** Shader warmup of the accumulation program. */
  prepare(context: Phaser.Renderer.WebGL.DrawingContext): boolean { return this.renderer.prepare(context); }

  destroy(): void {
    if (this.destroyed) return;
    this.releaseDye();
    this.destroyed = true;
    if (instances.get(this.scene) === this) instances.delete(this.scene);
    this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.postUpdate);
    this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.preRender);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.shutdown);
    this.renderer.destroy();
    this.model.clear();
    this.planner.clear();
    this.worldSource = null;
    this.world = null;
  }

  private syncWorld(): void {
    const world = this.worldSource?.() ?? null;
    if (world === this.world) return;
    if (this.world) this.clear();
    this.world = world;
    this.planner.setTerrain(world?.terrain ?? null);
  }

  private onPostUpdate(): void {
    if (this.destroyed) return;
    this.syncWorld();
    const now = this.scene.time.now, field = BLOOD_HIT_VFX.field;
    const budget = field.budget[getGraphicsQualityProfile(this.scene).level];
    this.planner.beginFrame(now, this.model.count / budget);
    this.model.update(now, budget, field.pressure, field.evictionFadeMs);
    this.submitRipples(now);
  }

  private onPreRender(): void {
    if (this.destroyed) return;
    const world = this.world;
    const view = getVisibleWorldView(this.scene.cameras.main);
    this.renderer.render(this.scene.time.now, view, {
      rockCoverage: world?.rockCoverage() ?? null,
      decks: world?.decks() ?? NO_DECKS,
      sunlight: world?.sunlight(),
      night: world?.night() ?? null,
    });
    this.syncDye(world);
  }

  private syncDye(world: BloodWorld | null): void {
    const target = world?.water() ?? null;
    const key = this.renderer.hasWater ? this.renderer.textureKey : null;
    if (target !== this.dyeTarget) { this.releaseDye(); this.dyeTarget = target; }
    const hueKey = key ? this.renderer.tintKey : null;
    if (!target || (key === this.dyeKey && hueKey === this.dyeHueKey)) return;
    // The rect is mutated in place every frame; the binding only changes with the textures.
    target.setDye(key ? { textureKey: key, rect: this.renderer.fieldRect, flipY: false, hueKey } : null);
    this.dyeKey = key;
    this.dyeHueKey = hueKey;
  }

  private releaseDye(): void {
    if (this.dyeKey) this.dyeTarget?.setDye(null);
    this.dyeKey = null;
    this.dyeHueKey = null;
    this.dyeTarget = null;
  }

  private submitRipples(now: number): void {
    const ripples = this.planner.ripples;
    if (!ripples.length) return;
    const surface = WaterDisturbanceField.for(this.scene);
    if (!surface) return;
    for (const ripple of ripples) {
      const age = (now - ripple.bornAtMs) / 1000;
      if (age < 0) continue;
      surface.submit({ kind: 'splat', x: ripple.x, y: ripple.y, age, radius: ripple.radius, strength: ripple.strength });
    }
  }
}

const NO_DECKS: readonly Rect[] = [];
