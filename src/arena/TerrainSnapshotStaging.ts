import * as Phaser from 'phaser';
import { loadingTimeline } from '../diagnostics/LoadingTimeline';
import { ROCK_OVERLAY_CHUNK_SIZE } from './RockOverlayRegions';
import type { ChunkWorldFrame } from './chunks/ArenaChunkGrid';
import type { ChunkBakeRegion } from './chunks/ChunkedRenderSurface';
import type { GroundSnapshotRegion } from './chunks/GroundSurfaceStreamer';
import type { TerrainSnapshotMaterialSource } from './TerrainSnapshotMaterial';
import { TerrainSnapshotWorkerClient } from './TerrainSnapshotWorkerClient';

let nextId = 0;

/** Build-owned material staging. A single worker supplies exact linear-filter
 * support texels; the camera keeps the original filtering and premultiplied blend.
 * Headless/workerless ports retain the native bake fallback. Scratch images are
 * borrowed only until the next generator yield; false means asynchronous waiting. */
export class TerrainSnapshotStaging {
  private texture: Phaser.Textures.CanvasTexture | null = null;
  private image: Phaser.GameObjects.Image | null = null;
  private worker: TerrainSnapshotWorkerClient | null = null;
  private buffer: ArrayBuffer | null = null;

  constructor(private readonly scene: Phaser.Scene, private readonly size: number) {}

  *draw(
    target: Phaser.GameObjects.RenderTexture,
    region: GroundSnapshotRegion,
    frame: ChunkWorldFrame,
    write: (part: ChunkBakeRegion) => ImageData | null,
    source?: TerrainSnapshotMaterialSource,
  ): Generator<void | false, void> {
    if (!this.texture) {
      this.texture = this.scene.textures.createCanvas(`__terrain_snapshot_stage_${nextId++}`, this.size, this.size);
      if (!this.texture) throw new Error('[TerrainColorSnapshot] Could not allocate material staging.');
      this.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
      this.image = new Phaser.GameObjects.Image(this.scene, 0, 0, this.texture.key).setOrigin(0);
    }
    const texture = this.texture;
    if (source && typeof Worker !== 'undefined') {
      this.worker ??= new TerrainSnapshotWorkerClient();
      this.buffer ??= new ArrayBuffer(this.size * this.size * 4);
      for (let y = 0; y < region.height; y += this.size) for (let x = 0; x < region.width; x += this.size) {
        this.worker.request(source, this.size, region.worldX + x, region.worldY + y,
          Math.min(this.size, region.width - x), Math.min(this.size, region.height - y), this.buffer);
        this.buffer = null;
        while (!(this.buffer = this.worker.take())) yield false;
        const started = loadingTimeline.start();
        texture.context.putImageData(new ImageData(new Uint8ClampedArray(this.buffer), this.size, this.size), 0, 0);
        texture.refresh();
        this.image!.setPosition(region.worldX + x, region.worldY + y);
        target.draw(this.image!);
        target.render();
        loadingTimeline.end('terrain-snapshot/material-upload-draw', started);
        yield;
      }
      return;
    }
    const size = ROCK_OVERLAY_CHUNK_SIZE;
    // Batch native tiles into a bounded upload. Tile boundaries remain aligned to
    // the snapshot sampling grid; linear filtering never crosses an old tile edge.
    for (let by = 0; by < region.height; by += this.size) for (let bx = 0; bx < region.width; bx += this.size) {
      texture.context.clearRect(0, 0, this.size, this.size);
      let populated = false;
      const height = Math.min(this.size, region.height - by), width = Math.min(this.size, region.width - bx);
      for (let y = 0; y < height; y += size) for (let x = 0; x < width; x += size) {
        const worldX = region.worldX + bx + x, worldY = region.worldY + by + y;
        const localX = worldX - frame.offsetX, localY = worldY - frame.offsetY;
        const started = loadingTimeline.start();
        const pixels = write({ chunk: { cx: 0, cy: 0, localX, localY }, localX, localY,
          worldX, worldY, size, gutterPx: 0 });
        if (pixels) {
          // The original scratch clipped the larger, gutter-capable source to size.
          texture.context.putImageData(pixels, x, y, 0, 0, size, size);
          populated = true;
        }
        loadingTimeline.end('terrain-snapshot/material-cpu', started);
        yield;
      }
      if (populated) {
        const started = loadingTimeline.start();
        texture.refresh();
        this.image!.setPosition(region.worldX + bx, region.worldY + by);
        target.draw(this.image!);
        // Flush before a later batch reuses this canvas, including across frames.
        target.render();
        loadingTimeline.end('terrain-snapshot/material-upload-draw', started);
      }
      yield;
    }
  }

  destroy(): void {
    this.worker?.destroy(); this.worker = null; this.buffer = null;
    this.image?.destroy();
    if (this.texture) this.scene.textures.remove(this.texture.key);
    this.image = null;
    this.texture = null;
  }
}
