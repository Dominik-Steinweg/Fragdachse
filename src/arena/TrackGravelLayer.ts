import * as Phaser from 'phaser';
import type { ArenaTrackColumnSpec } from './ArenaVisualFactory';
import type { ChunkWorldFrame } from './chunks/ArenaChunkGrid';
import type { ChunkBakeRegion } from './chunks/ChunkedRenderSurface';
import type { GroundMaterialSamples } from './GroundMaterialSamples';
import { writeTrackBallast } from './TrackGravelField';
import type { TerrainSnapshotMaterialSource } from './TerrainSnapshotMaterial';

let nextCanvasId = 0;

/** World-owned railway ballast bed: one reusable CPU canvas, shared by chunk bakes and snapshots. */
export class TrackGravelLayer {
  readonly snapshotSource: TerrainSnapshotMaterialSource;
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
    this.snapshotSource = { kind: 'track', seed, columns, frame, materials: {
      dirt: materials.dirt, gravel: materials.gravel, grassHeight: materials.grassHeight,
    } };
    const key = `__track_ballast_${nextCanvasId++}`;
    const texture = scene.textures.createCanvas(key, size, size);
    if (!texture) throw new Error('[TrackGravelLayer] Could not allocate the ballast canvas.');
    this.texture = texture;
    this.pixels = texture.context.createImageData(size, size);
    this.image = new Phaser.GameObjects.Image(scene, 0, 0, key).setOrigin(0, 0);
  }

  bake(target: Phaser.GameObjects.RenderTexture, region: ChunkBakeRegion): void {
    target.clear();
    if (this.writeRegion(region)) {
      this.texture.context.putImageData(this.pixels, 0, 0);
      this.texture.refresh();
      target.draw(this.image);
    }
    // Flush before another bake overwrites the shared canvas or the scratch target.
    target.render();
  }

  /** Borrowed native pixels; no GPU work until the snapshot region is complete. */
  writeRegion(region: ChunkBakeRegion): ImageData | null {
    const gravel = this.materials.gravel;
    if (!gravel) return null;
    writeTrackBallast(this.pixels.data, this.pixels.width, this.seed, this.columns, this.frame, region,
      { gravel, soil: this.materials.dirt });
    return this.pixels;
  }

  destroy(): void {
    this.image.destroy();
    this.scene.textures.remove(this.texture.key);
  }
}
