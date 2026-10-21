import * as Phaser from 'phaser';
import { DEPTH, DEPTH_LIGHTING } from '../config';
import { MOON_TUNING } from '../config/sunlight';
import { characterShadowOpacity } from '../effects/CharacterShadowModel';
import { registerGraphicsObject } from '../effects/EffectUtils';
import { LIGHT_PRESETS } from '../effects/LightingConfig';
import type { LightingSystem } from '../effects/LightingSystem';
import { CHARACTER_SHADOW_CONFIG } from '../effects/ShadowConfig';
import type { SunCloudState } from '../effects/sunlight/cloudShadow';
import { resolveMoonBase } from '../effects/sunlight/MoonSky';
import { cloudShadowAt } from '../effects/sunlight/SunFieldModel';
import { DEFAULT_TIME_OF_DAY_MINUTES } from '../effects/TimeOfDay';
import type { ArenaLayout } from '../types';
import type { ChunkWorldFrame, ChunkWorldRect } from './chunks/ArenaChunkGrid';
import { prepareWildlifeVisuals } from './AmbientWildlifeGeometry';
import { prepareBirdVisuals, type BirdVisual } from './AmbientWildlifeBirdGeometry';
import { birdDrawScale, writeBirdLayerWeights } from './AmbientWildlifeBirds';
import { fireflyGlowStrength } from './AmbientWildlifeAppearance';
import { createAmbientWildlifeLayer, type AmbientWildlifeLayer, type WildlifeLayerProjection } from './AmbientWildlifeLayer';
import { AmbientWildlifeModel, type WildlifeAnimal, type WildlifeImpulseKind, type WildlifeMover } from './AmbientWildlifeModel';

type WildlifeLighting = Pick<LightingSystem, 'setLight' | 'releaseLight'> & Partial<Pick<LightingSystem, 'resolveCanopyTint'>>;
let nextLightOwner = 0;

/**
 * Bird bands: grounded birds under the ground fog; projected flight shadows in the figure-shadow band
 * (under fog and crowns); low flight above the lightmap but under crowns; high flight above crowns and
 * below bombers. Both flight bands lie above the lightmap and take the canopy tint instead.
 */
export const BIRD_LAYER_DEPTHS = {
  ground: DEPTH.GROUND_FOG - .005,
  shadows: CHARACTER_SHADOW_CONFIG.depth - .005,
  low: DEPTH.CANOPY - .24,
  high: DEPTH.CANOPY + .3,
} as const;

/** Flight shadows stretch with low sun, but never further than this from their bird. */
const MAX_SHADOW_REACH = 220;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** World-owned cosmetic presentation, following the existing lighting clock. */
export class AmbientWildlifeRenderer {
  readonly model: AmbientWildlifeModel;
  private readonly ground: AmbientWildlifeLayer;
  private readonly fish: AmbientWildlifeLayer;
  private readonly fireflies: AmbientWildlifeLayer;
  private readonly birds: readonly BirdVisual[];
  private readonly birdLayers: readonly AmbientWildlifeLayer[];
  private readonly weights = { ground: 0, low: 0, high: 0 };
  private readonly moonBase = { weight: 0, cover: 0 };
  private destroyed = false;
  private visualTime = 0;
  private lighting: WildlifeLighting | null = null;
  private sunlight: SunCloudState | undefined;
  private readonly fireflyLights: { animal: WildlifeAnimal; key: string; active: boolean }[];

  constructor(scene: Phaser.Scene, frame: ChunkWorldFrame, layout: ArenaLayout) {
    this.model = new AmbientWildlifeModel(layout, frame);
    const lightOwner = nextLightOwner++;
    this.fireflyLights = this.model.animals.filter(a => a.kind === 'firefly')
      .map((animal, i) => ({ animal, key: `wildlife:${lightOwner}:${i}`, active: false }));
    // ArenaBuilder constructs this under the existing loading veil. Allocate every mesh
    // and bounded output buffer here, including animals outside the initial viewport.
    const visuals = prepareWildlifeVisuals(this.model.animals.filter(a => !a.bird));
    this.ground = createAmbientWildlifeLayer(scene, visuals.filter(v => v.animal.kind !== 'fish' && v.animal.kind !== 'firefly'),
      DEPTH.GROUND_FOG - .01, 'ambient-wildlife-land');
    this.fish = createAmbientWildlifeLayer(scene, visuals.filter(v => v.animal.kind === 'fish'),
      DEPTH.WATER + .025, 'ambient-wildlife-fish');
    // Self-lit insects stay above the darkening composite, but below occluding canopies.
    this.fireflies = createAmbientWildlifeLayer(scene, visuals.filter(v => v.animal.kind === 'firefly'),
      DEPTH_LIGHTING + .1, 'ambient-wildlife-fireflies');
    registerGraphicsObject(scene, 'ambientWildlife', this.ground);
    registerGraphicsObject(scene, 'ambientWildlife', this.fish);
    registerGraphicsObject(scene, 'ambientWildlife', this.fireflies);
    // Every bird is sampled once per frame by `updateBirds`; its layers only place the copy they draw.
    this.birds = prepareBirdVisuals(this.model.animals);
    const place = (v: BirdVisual, out: WildlifeLayerProjection, weight: number, tint: number): void => {
      out.x = v.animal.x; out.y = v.animal.y; out.angle = v.animal.angle;
      out.scale = v.presence.scale; out.radius = v.presence.radius; out.weight = weight; out.tint = tint;
    };
    this.birdLayers = [
      createAmbientWildlifeLayer(scene, this.birds, BIRD_LAYER_DEPTHS.ground, 'ambient-wildlife-birds-ground',
        { project: (v, out) => place(v, out, v.presence.ground, 0xffffff) }),
      createAmbientWildlifeLayer(scene, this.birds.map(v => v.shadow), BIRD_LAYER_DEPTHS.shadows, 'ambient-wildlife-bird-shadows',
        { project: (s, out) => {
          const p = s.owner.presence;
          place(s.owner, out, p.shadowAlpha, 0xffffff);
          out.x += p.shadowX; out.y += p.shadowY;
        } }),
      createAmbientWildlifeLayer(scene, this.birds, BIRD_LAYER_DEPTHS.low, 'ambient-wildlife-birds-low',
        { project: (v, out) => place(v, out, v.presence.low, v.presence.tint) }),
      createAmbientWildlifeLayer(scene, this.birds, BIRD_LAYER_DEPTHS.high, 'ambient-wildlife-birds-high',
        { project: (v, out) => place(v, out, v.presence.high, v.presence.tint) }),
    ];
    for (const layer of this.birdLayers) registerGraphicsObject(scene, 'ambientWildlife', layer);
  }

  /** Borrow the active World atmosphere; depths also remain valid during a terrain handoff. */
  setSunlight(state: SunCloudState | undefined): void {
    if (this.destroyed) return;
    this.sunlight = state;
  }

  update(deltaMs: number, movers: readonly WildlifeMover[], view: ChunkWorldRect, timeOfDayMinutes?: number,
    lighting?: WildlifeLighting): void {
    if (this.destroyed) return;
    this.visualTime += Math.max(0, Math.min(deltaMs / 1000, .05));
    this.model.update(deltaMs, movers, view, timeOfDayMinutes);
    this.ground.updatePose(view, this.visualTime);
    this.fish.updatePose(view, this.visualTime);
    this.fireflies.updatePose(view, this.visualTime, this.sunlight);
    this.updateBirds(view, timeOfDayMinutes ?? DEFAULT_TIME_OF_DAY_MINUTES, lighting);
    for (const layer of this.birdLayers) layer.updatePose(view, this.visualTime);
    if (lighting && lighting !== this.lighting) {
      this.clearLights();
      this.lighting = lighting;
    }
    this.syncFireflyLights(view);
  }

  /** Cull, weigh, tint and shadow each bird, then sample its pose once for all of its layers. */
  private updateBirds(view: ChunkWorldRect, minutes: number, lighting: WildlifeLighting | undefined): void {
    for (const v of this.birds) {
      const a = v.animal, bird = a.bird!, p = v.presence;
      p.scale = birdDrawScale(bird.altitude);
      p.radius = v.reach * p.scale + 2;
      this.projectShadow(v, minutes);
      const reach = p.radius + Math.abs(p.shadowX) + Math.abs(p.shadowY);
      if (a.opacity <= .005 || a.x < view.x - reach || a.y < view.y - reach
        || a.x > view.x + view.width + reach || a.y > view.y + view.height + reach) {
        p.ground = p.low = p.high = p.shadowAlpha = 0;
        continue;
      }
      writeBirdLayerWeights(bird.altitude, this.weights);
      p.ground = this.weights.ground; p.low = this.weights.low; p.high = this.weights.high;
      // Above the lightmap, birds darken exactly like tree crowns; the tint only multiplies.
      p.tint = p.low + p.high > 0 && lighting?.resolveCanopyTint ? lighting.resolveCanopyTint(a.x, a.y) : 0xffffff;
      v.sample(this.visualTime);
    }
  }

  /** Sun by day (as a held weapon's shadow), a faint moon shadow at night; none on the ground. */
  private projectShadow(v: BirdVisual, minutes: number): void {
    const p = v.presence, a = v.animal, height = a.bird!.altitude, sun = this.sunlight?.sunPath;
    p.shadowX = p.shadowY = p.shadowAlpha = 0;
    if (height < 1 || !sun || !this.sunlight) return;
    const fade = clamp01((height - 1) / 3) * (1 - .45 * clamp01(height / 130));
    const day = sun.strength > 0 && sun.elevation > 0 ? characterShadowOpacity(sun.strength, sun.elevation) : 0;
    if (day > 0) {
      const reach = Math.min(MAX_SHADOW_REACH, height / Math.tan(Math.max(sun.elevation, .26)));
      p.shadowX = -sun.direction[0] * reach; p.shadowY = -sun.direction[1] * reach;
      p.shadowAlpha = day * cloudShadowAt(a.x + p.shadowX, a.y + p.shadowY, this.sunlight) * fade;
      return;
    }
    const moon = resolveMoonBase(minutes, this.moonBase).weight;
    if (moon <= 0) return;
    const cast = sun.castAzimuth * Math.PI / 180;
    const reach = Math.min(MAX_SHADOW_REACH, height / Math.tan(MOON_TUNING.elevationDegrees * Math.PI / 180));
    p.shadowX = -Math.cos(cast) * reach; p.shadowY = Math.sin(cast) * reach;
    p.shadowAlpha = .12 * moon * fade;
  }

  private syncFireflyLights(view: ChunkWorldRect): void {
    if (!this.lighting) return;
    const preset = LIGHT_PRESETS.firefly;
    for (const source of this.fireflyLights) {
      const a = source.animal, radius = preset.radiusPx;
      const visible = a.opacity > .005 && a.x + radius >= view.x && a.y + radius >= view.y
        && a.x - radius <= view.x + view.width && a.y - radius <= view.y + view.height;
      if (visible) {
        const pulse = fireflyGlowStrength(this.visualTime, a.variation, a.phaseOffset, a.speed);
        this.lighting.setLight(source.key, 'firefly', a.x, a.y, { intensity: preset.intensity * a.opacity * pulse });
      } else if (source.active) this.lighting.releaseLight(source.key, { immediate: true });
      source.active = visible;
    }
  }

  /** Presentation handoff can stop lights while retaining the drawn World. */
  clearLights(): void {
    for (const source of this.fireflyLights) {
      if (source.active) this.lighting?.releaseLight(source.key, { immediate: true });
      source.active = false;
    }
    this.lighting = null;
  }

  notifyImpulse(kind: WildlifeImpulseKind, x: number, y: number, radius?: number): void {
    if (!this.destroyed) this.model.notifyImpulse(kind, x, y, radius);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.sunlight = undefined;
    this.clearLights();
    this.fireflyLights.length = 0;
    this.ground.destroy(); this.fish.destroy(); this.fireflies.destroy();
    for (const layer of this.birdLayers) layer.destroy();
    this.model.destroy();
  }
}
