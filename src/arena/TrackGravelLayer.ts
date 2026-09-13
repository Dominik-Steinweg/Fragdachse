import * as Phaser from 'phaser';
import type { ArenaTrackColumnSpec } from './ArenaVisualFactory';
import type { ChunkWorldFrame } from './chunks/ArenaChunkGrid';
import type { ChunkBakeRegion } from './chunks/ChunkedRenderSurface';
import { ArenaPointBucketIndex } from './chunks/ArenaPointBucketIndex';
import { generateTrackGravelPlacements, writeTrackGravelCutout } from './TrackGravelField';
import type { TrackGravelPlacement } from './TrackGravelField';
import { TRACK_GRAVEL_CONFIG } from './TrackGravelConfig';

let nextMaskId = 0;

/** World-owned gravel placements and one reusable CPU/GPU cutout, shared by chunks and snapshots. */
export class TrackGravelLayer {
  private readonly placements: readonly TrackGravelPlacement[];
  private readonly index: ArenaPointBucketIndex<TrackGravelPlacement>;
  private readonly candidates: number[] = [];
  private readonly maskTexture: Phaser.Textures.CanvasTexture;
  private readonly maskImage: Phaser.GameObjects.Image;
  private readonly maskPixels: ImageData;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly seed: number,
    private readonly columns: readonly ArenaTrackColumnSpec[],
    private readonly frame: ChunkWorldFrame,
    maskSize: number,
  ) {
    this.placements = generateTrackGravelPlacements(seed, columns, frame);
    this.index = new ArenaPointBucketIndex(frame, placement => ({ x: placement.worldX, y: placement.worldY }));
    this.index.sync(this.placements);
    const key = `__track_gravel_cutout_${nextMaskId++}`;
    const texture = scene.textures.createCanvas(key, maskSize, maskSize);
    if (!texture) throw new Error('[TrackGravelLayer] Could not allocate the gravel cutout.');
    this.maskTexture = texture;
    this.maskPixels = texture.context.createImageData(maskSize, maskSize);
    this.maskImage = new Phaser.GameObjects.Image(scene, 0, 0, key).setOrigin(0, 0);
  }

  bake(target: Phaser.GameObjects.RenderTexture, region: ChunkBakeRegion): void {
    target.clear();
    const ids = this.index.collect(region.localX, region.localY, region.size,
      TRACK_GRAVEL_CONFIG.maxStampSizePx * Math.SQRT1_2, this.candidates);
    ids.sort((a, b) => a - b);
    for (const id of ids) {
      const placement = this.placements[id];
      const textureFrame = this.scene.textures.getFrame(placement.textureKey);
      const scale = placement.sizePx / Math.max(textureFrame.width, textureFrame.height);
      target.stamp(placement.textureKey, undefined,
        placement.worldX - region.worldX, placement.worldY - region.worldY, {
          scaleX: placement.mirrorX ? -scale : scale,
          scaleY: placement.mirrorY ? -scale : scale,
          rotation: placement.rotation,
          tint: placement.tint,
          alpha: placement.alpha,
        });
    }
    if (ids.length > 0) {
      writeTrackGravelCutout(this.maskPixels.data, this.maskPixels.width,
        this.seed, this.columns, this.frame, region);
      this.maskTexture.context.putImageData(this.maskPixels, 0, 0);
      this.maskTexture.refresh();
      target.erase(this.maskImage);
    }
    // Flush before another bake overwrites the shared mask or the scratch target.
    target.render();
  }

  destroy(): void {
    this.index.clear();
    this.maskImage.destroy();
    this.scene.textures.remove(this.maskTexture.key);
  }
}
