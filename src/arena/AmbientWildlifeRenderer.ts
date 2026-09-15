import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { registerGraphicsObject } from '../effects/EffectUtils';
import type { ArenaLayout } from '../types';
import type { ChunkWorldFrame, ChunkWorldRect } from './chunks/ArenaChunkGrid';
import { prepareWildlifeVisuals } from './AmbientWildlifeGeometry';
import { createAmbientWildlifeLayer, type AmbientWildlifeLayer } from './AmbientWildlifeLayer';
import { AmbientWildlifeModel, type WildlifePlayer } from './AmbientWildlifeModel';

/** World-owned presentation; model and its interaction/animation clocks remain unchanged. */
export class AmbientWildlifeRenderer {
  readonly model: AmbientWildlifeModel;
  private readonly ground: AmbientWildlifeLayer;
  private readonly fish: AmbientWildlifeLayer;
  private destroyed = false;
  private visualTime = 0;

  constructor(scene: Phaser.Scene, frame: ChunkWorldFrame, layout: ArenaLayout) {
    this.model = new AmbientWildlifeModel(layout, frame);
    // ArenaBuilder constructs this under the existing loading veil. Allocate every mesh
    // and bounded output buffer here, including animals outside the initial viewport.
    const visuals = prepareWildlifeVisuals(this.model.animals);
    this.ground = createAmbientWildlifeLayer(scene, visuals.filter(v => v.animal.kind !== 'fish'),
      DEPTH.DECALS + .4, 'ambient-wildlife-land');
    this.fish = createAmbientWildlifeLayer(scene, visuals.filter(v => v.animal.kind === 'fish'),
      DEPTH.WATER + .1, 'ambient-wildlife-fish');
    registerGraphicsObject(scene, 'ambientWildlife', this.ground);
    registerGraphicsObject(scene, 'ambientWildlife', this.fish);
  }

  update(deltaMs: number, players: readonly WildlifePlayer[], view: ChunkWorldRect): void {
    if (this.destroyed) return;
    this.visualTime += Math.max(0, Math.min(deltaMs / 1000, .05));
    this.model.update(deltaMs, players, view);
    this.ground.updatePose(view, this.visualTime);
    this.fish.updatePose(view, this.visualTime);
  }

  notifyShot(x: number, y: number): void {
    if (!this.destroyed) this.model.notifyShot(x, y);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ground.destroy(); this.fish.destroy(); this.model.destroy();
  }
}
