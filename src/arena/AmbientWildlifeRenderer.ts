import * as Phaser from 'phaser';
import { DEPTH, DEPTH_LIGHTING } from '../config';
import { registerGraphicsObject } from '../effects/EffectUtils';
import { LIGHT_PRESETS } from '../effects/LightingConfig';
import type { LightingSystem } from '../effects/LightingSystem';
import type { ArenaLayout } from '../types';
import type { ChunkWorldFrame, ChunkWorldRect } from './chunks/ArenaChunkGrid';
import { prepareWildlifeVisuals } from './AmbientWildlifeGeometry';
import { fireflyGlowStrength } from './AmbientWildlifeAppearance';
import { createAmbientWildlifeLayer, type AmbientWildlifeLayer } from './AmbientWildlifeLayer';
import { AmbientWildlifeModel, type WildlifeAnimal, type WildlifePlayer } from './AmbientWildlifeModel';

type WildlifeLighting = Pick<LightingSystem, 'setLight' | 'releaseLight'>;
let nextLightOwner = 0;

/** World-owned cosmetic presentation, following the existing lighting clock. */
export class AmbientWildlifeRenderer {
  readonly model: AmbientWildlifeModel;
  private readonly ground: AmbientWildlifeLayer;
  private readonly fish: AmbientWildlifeLayer;
  private readonly fireflies: AmbientWildlifeLayer;
  private destroyed = false;
  private visualTime = 0;
  private lighting: WildlifeLighting | null = null;
  private readonly fireflyLights: { animal: WildlifeAnimal; key: string; active: boolean }[];

  constructor(scene: Phaser.Scene, frame: ChunkWorldFrame, layout: ArenaLayout) {
    this.model = new AmbientWildlifeModel(layout, frame);
    const lightOwner = nextLightOwner++;
    this.fireflyLights = this.model.animals.filter(a => a.kind === 'firefly')
      .map((animal, i) => ({ animal, key: `wildlife:${lightOwner}:${i}`, active: false }));
    // ArenaBuilder constructs this under the existing loading veil. Allocate every mesh
    // and bounded output buffer here, including animals outside the initial viewport.
    const visuals = prepareWildlifeVisuals(this.model.animals);
    this.ground = createAmbientWildlifeLayer(scene, visuals.filter(v => v.animal.kind !== 'fish' && v.animal.kind !== 'firefly'),
      DEPTH.DECALS + .4, 'ambient-wildlife-land');
    this.fish = createAmbientWildlifeLayer(scene, visuals.filter(v => v.animal.kind === 'fish'),
      DEPTH.WATER + .1, 'ambient-wildlife-fish');
    // Self-lit insects stay above the darkening composite, but below occluding canopies.
    this.fireflies = createAmbientWildlifeLayer(scene, visuals.filter(v => v.animal.kind === 'firefly'),
      DEPTH_LIGHTING + .1, 'ambient-wildlife-fireflies');
    registerGraphicsObject(scene, 'ambientWildlife', this.ground);
    registerGraphicsObject(scene, 'ambientWildlife', this.fish);
    registerGraphicsObject(scene, 'ambientWildlife', this.fireflies);
  }

  update(deltaMs: number, players: readonly WildlifePlayer[], view: ChunkWorldRect, timeOfDayMinutes?: number,
    lighting?: WildlifeLighting): void {
    if (this.destroyed) return;
    this.visualTime += Math.max(0, Math.min(deltaMs / 1000, .05));
    this.model.update(deltaMs, players, view, timeOfDayMinutes);
    this.ground.updatePose(view, this.visualTime);
    this.fish.updatePose(view, this.visualTime);
    this.fireflies.updatePose(view, this.visualTime);
    if (lighting && lighting !== this.lighting) {
      this.clearLights();
      this.lighting = lighting;
    }
    this.syncFireflyLights(view);
  }

  private syncFireflyLights(view: ChunkWorldRect): void {
    if (!this.lighting) return;
    const preset = LIGHT_PRESETS.firefly;
    for (const source of this.fireflyLights) {
      const a = source.animal, radius = preset.radiusPx;
      const visible = a.opacity > .005 && a.x + radius >= view.x && a.y + radius >= view.y
        && a.x - radius <= view.x + view.width && a.y - radius <= view.y + view.height;
      if (visible) {
        const pulse = fireflyGlowStrength(this.visualTime, a.variation, a.phaseOffset);
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

  notifyShot(x: number, y: number): void {
    if (!this.destroyed) this.model.notifyShot(x, y);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearLights();
    this.fireflyLights.length = 0;
    this.ground.destroy(); this.fish.destroy(); this.fireflies.destroy(); this.model.destroy();
  }
}
