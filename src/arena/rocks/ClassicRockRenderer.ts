import { WOODLAND_ROCK_COLOUR_KEY } from '../../assets/WoodlandAssetManifest';
import * as Phaser from 'phaser';
import { CELL_SIZE } from '../../config';
import { ArenaVisualFactory } from '../ArenaVisualFactory';
import type { RockWorldFrame } from '../ArenaBuilder';
import { RockLayerGrid } from '../chunks/RockLayerGrid';
import { RockViewportCuller } from '../chunks/RockViewportCuller';
import type { ChunkWorldRect } from '../chunks/ArenaChunkGrid';
import type { RockVisualState } from './RockVisualState';
import { resolveRockCornerTints, resolveRockTexture } from './RockVisualState';
import { type RockLightingState } from './RockLightingState';

/** Der bestehende Image-Pfad, jetzt als reiner Consumer von `RockVisualState`. */
export class ClassicRockRenderer {
  private readonly layers: RockLayerGrid;
  private readonly images: Array<Phaser.GameObjects.Image | null> = [];
  private readonly culler: RockViewportCuller;
  private formationMaterial = false;
  private formationTextureKey = WOODLAND_ROCK_COLOUR_KEY;

  constructor(
    private readonly scene: Phaser.Scene,
    frame: RockWorldFrame,
    private readonly states: readonly (RockVisualState | undefined)[],
    initialMaterial?: RockLightingState,
  ) {
    this.formationMaterial=initialMaterial?.material==='mineral';
    this.formationTextureKey=initialMaterial?.colourTextureKey??WOODLAND_ROCK_COLOUR_KEY;
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

  setMaterialLighting(state: RockLightingState): void {
    const active = state.material === 'mineral';
    const key = state.colourTextureKey ?? WOODLAND_ROCK_COLOUR_KEY;
    if (this.formationMaterial === active && (!active || this.formationTextureKey === key)) return;
    this.formationMaterial = active;
    this.formationTextureKey = key;
    for (const s of this.states) if (s?.active) this.syncOne(s.id, false);
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

    const resolved = resolveRockTexture(state), frame = resolved.frame;
    const key = this.formationMaterial && state.material !== 'walls' ? this.formationTextureKey : resolved.key;
    const image = current ?? ArenaVisualFactory.createRock(
      this.scene,
      state.x,
      state.y,
      frame,
      undefined,
      this.layers.layerFor(state.gridX, state.gridY),
      key,
    );
    this.images[id] = image;
    if (image.texture?.key !== key) image.setTexture(key, frame);
    image
      .setPosition(state.x, state.y)
      .setFrame(frame)
      .setScale(state.scaleX * CELL_SIZE / image.frame.realWidth, state.scaleY * CELL_SIZE / image.frame.realHeight)
      .setAlpha(state.alpha)
      .setTint(...resolveRockCornerTints(state, this.formationMaterial));
    if (!current && applyCulling) this.culler.applyTo(image, state.gridX, state.gridY);
  }
}
