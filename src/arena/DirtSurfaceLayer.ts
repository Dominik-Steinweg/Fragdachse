import * as Phaser from 'phaser';
import type { DirtCell, WaterCell } from '../types';
import { DirtSurfaceField } from './DirtSurfaceField';
import type { GroundMaterialSamples } from './GroundMaterialSamples';
import type { ChunkWorldFrame } from './chunks/ArenaChunkGrid';
import type { ChunkBakeRegion } from './chunks/ChunkedRenderSurface';

let nextId = 0;

/** One reusable soil and riverbank canvas per World, not one texture/object per soil tile. */
export class DirtSurfaceLayer {
  private readonly field: DirtSurfaceField;
  private readonly surface: Phaser.Textures.CanvasTexture;
  private readonly image: Phaser.GameObjects.Image;
  private readonly pixels: ImageData;

  constructor(private readonly scene: Phaser.Scene, seed: number, dirt: readonly DirtCell[],
    frame: ChunkWorldFrame, size: number, private readonly materials: GroundMaterialSamples,
    water: readonly WaterCell[] = []) {
    this.field = new DirtSurfaceField(seed, dirt, frame, water);
    const key = `__dirt_surface_${nextId++}`;
    const surface = scene.textures.createCanvas(key, size, size);
    if (!surface) throw new Error('[DirtSurfaceLayer] Could not allocate soil surface.');
    this.surface = surface;
    this.pixels = surface.context.createImageData(size, size);
    this.image = new Phaser.GameObjects.Image(scene, 0, 0, key).setOrigin(0);
  }

  bake(target: Phaser.GameObjects.RenderTexture, region: ChunkBakeRegion): void {
    this.field.writeSurface(this.pixels.data, this.pixels.width, region.worldX, region.worldY, region.size, this.materials);
    this.surface.context.putImageData(this.pixels, 0, 0);
    this.surface.refresh();
    target.clear();
    target.draw(this.image);
    // Flush while this canvas still belongs to this region.
    target.render();
  }

  destroy(): void {
    this.image.destroy();
    this.scene.textures.remove(this.surface.key);
  }
}
