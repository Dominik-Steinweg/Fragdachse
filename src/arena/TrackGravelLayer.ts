import * as Phaser from 'phaser';
import type { ArenaTrackColumnSpec } from './ArenaVisualFactory';
import type { ChunkWorldFrame } from './chunks/ArenaChunkGrid';
import type { ChunkBakeRegion } from './chunks/ChunkedRenderSurface';
import type { GroundMaterialSamples } from './GroundMaterialSamples';
import { writeTrackBallast } from './TrackGravelField';

let nextCanvasId = 0;

/** World-owned railway ballast bed: one reusable CPU canvas, shared by chunk bakes and snapshots. */
export class TrackGravelLayer {
  private readonly texture: Phaser.Textures.CanvasTexture;
  private readonly image: Phaser.GameObjects.Image;
  private readonly pixels: ImageData;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly seed: number,
    private readonly columns: readonly ArenaTrackColumnSpec[],
    private readonly frame: ChunkWorldFrame,
    size: number,
    private readonly materials: GroundMaterialSamples,
  ) {
    const key = `__track_ballast_${nextCanvasId++}`;
    const texture = scene.textures.createCanvas(key, size, size);
    if (!texture) throw new Error('[TrackGravelLayer] Could not allocate the ballast canvas.');
    this.texture = texture;
    this.pixels = texture.context.createImageData(size, size);
    this.image = new Phaser.GameObjects.Image(scene, 0, 0, key).setOrigin(0, 0);
  }

  bake(target: Phaser.GameObjects.RenderTexture, region: ChunkBakeRegion): void {
    target.clear();
    const gravel = this.materials.gravel;
    if (gravel) {
      writeTrackBallast(this.pixels.data, this.pixels.width, this.seed, this.columns, this.frame, region,
        { gravel, soil: this.materials.dirt });
      this.texture.context.putImageData(this.pixels, 0, 0);
      this.texture.refresh();
      target.draw(this.image);
    }
    // Flush before another bake overwrites the shared canvas or the scratch target.
    target.render();
  }

  destroy(): void {
    this.image.destroy();
    this.scene.textures.remove(this.texture.key);
  }
}
