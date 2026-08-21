import * as Phaser from 'phaser';
import { CELL_SIZE } from '../../config';
import { ArenaVisualFactory } from '../ArenaVisualFactory';
import type { RockWorldFrame } from '../ArenaBuilder';
import { RockLayerGrid } from '../chunks/RockLayerGrid';
import { RockViewportCuller } from '../chunks/RockViewportCuller';
import type { ChunkWorldRect } from '../chunks/ArenaChunkGrid';
import type { RockVisualState } from './RockVisualState';
import { resolveRockCornerTints } from './RockVisualState';

/** Der bestehende Image-Pfad, jetzt als reiner Consumer von `RockVisualState`. */
export class ClassicRockRenderer {
  private readonly layers: RockLayerGrid;
  private readonly images: Array<Phaser.GameObjects.Image | null> = [];
  private readonly culler: RockViewportCuller;

  constructor(
    private readonly scene: Phaser.Scene,
    frame: RockWorldFrame,
    private readonly states: readonly (RockVisualState | undefined)[],
  ) {
    this.layers = new RockLayerGrid(scene, frame);
    for (let id = 0; id < states.length; id += 1) this.syncOne(id, false);
    this.culler = new RockViewportCuller(frame, states, this.images, this.layers);
  }

  applyDirty(ids: readonly number[]): void {
    for (const id of ids) this.syncOne(id, true);
  }

  updateVisibility(view: ChunkWorldRect): void {
    this.culler.update(view);
  }

  destroy(): void {
    for (const image of this.images) image?.destroy();
    this.images.length = 0;
    this.layers.destroy();
  }

  private syncOne(id: number, applyCulling: boolean): void {
    const state = this.states[id];
    const current = this.images[id] ?? null;
    if (!state?.active) {
      current?.destroy();
      this.images[id] = null;
      return;
    }

    const image = current ?? ArenaVisualFactory.createRock(
      this.scene,
      state.x,
      state.y,
      state.frame,
      undefined,
      this.layers.layerFor(state.gridX, state.gridY),
    );
    this.images[id] = image;
    image
      .setPosition(state.x, state.y)
      .setFrame(state.frame)
      .setDisplaySize(CELL_SIZE, CELL_SIZE)
      .setScale(state.scaleX, state.scaleY)
      .setAlpha(state.alpha)
      .setTint(...resolveRockCornerTints(state));
    if (!current && applyCulling) this.culler.applyTo(image, state.gridX, state.gridY);
  }
}
