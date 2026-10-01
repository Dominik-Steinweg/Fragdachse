import { TerrainSnapshotStaging } from '../src/arena/TerrainSnapshotStaging';
import { DirtSurfaceField } from '../src/arena/DirtSurfaceField';
import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => ({ ...(await import('./fakeArenaRenderScene')).createFakePhaserModule(), Textures: { FilterMode: { LINEAR: 0 } } }));
import { createFakeArenaScene } from './fakeArenaRenderScene';
import { GroundSurfaceStreamer, GROUND_DIRT_LAYER_ID } from '../src/arena/chunks/GroundSurfaceStreamer';
import { ChunkedRenderSurface } from '../src/arena/chunks/ChunkedRenderSurface';
import type { ArenaLayout } from '../src/types';
import type { GroundMaterialSamples } from '../src/arena/GroundMaterialSamples';

const groundMaterials: GroundMaterialSamples = {
  dirt: { width: 8, height: 8, rgba: Uint8ClampedArray.from({ length: 256 }, (_, i) => (i * 37) & 255) },
  grassHeight: { width: 8, height: 8, data: Uint8Array.from({ length: 64 }, (_, i) => (i * 53) & 255) },
};

function harness() {
  const scene = createFakeArenaScene();
  const uploads: Array<{ width: number; data: Uint8ClampedArray }> = [];
  const gpuUploads: Array<{ width: number; data: Uint8ClampedArray }> = [];
  const alive = new Set<string>();
  const createCanvas = vi.fn((key: string, width: number, height: number) => {
    alive.add(key);
    const data = new Uint8ClampedArray(width * height * 4);
    return { key, setFilter() {}, context: {
      createImageData: () => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
      clearRect: () => data.fill(0),
      putImageData: (image: { width: number; height: number; data: Uint8ClampedArray }, x = 0, y = 0,
        _sx = 0, _sy = 0, w = image.width, h = image.height) => {
        uploads.push({ width: image.width, data: image.data.slice() });
        for (let row = 0; row < Math.min(h, height - y); row++) {
          data.set(image.data.subarray(row * image.width * 4, (row * image.width + Math.min(w, width - x)) * 4),
            ((row + y) * width + x) * 4);
        }
      },
    }, refresh() { gpuUploads.push({ width, data: data.slice() }); } };
  });
  Object.assign(scene.textures, { createCanvas, remove: (key: string) => alive.delete(key) });
  const frame = { offsetX: 37, offsetY: 19, width: 4096, height: 512 };
  const layout: ArenaLayout = { seed: 17, rocks: [], trees: [], tracks: [], powerUpPedestals: [],
    dirt: Array.from({ length: 12 * 8 }, (_, i) => ({ gridX: 1 + i % 12, gridY: 1 + Math.floor(i / 12) })) };
  const ground = new GroundSurfaceStreamer({ scene: scene as never, frame, layout, groundCoverPlacements: [], chunkSize: 128, groundMaterials });
  return { scene, ground, frame, uploads, gpuUploads, alive, createCanvas, layout };
}

describe('soil streaming and snapshot parity', () => {
  it('reuses one surface canvas, restores evicted soil identically and releases resources', () => {
    const h = harness(), view = { x: 37, y: 19, width: 128, height: 128 };
    const show = (x: number) => { h.ground.updateResidency({ ...view, x }); ChunkedRenderSurface.drainBakeQueue(h.scene as never); };
    show(37);
    const firstSurface = h.uploads[0].data;
    expect(firstSurface.some((value, index) => index % 4 === 3 && value === 255)).toBe(true);
    show(3500);
    expect(h.ground.getChunkTexture(GROUND_DIRT_LAYER_ID, 0, 0)).toBeNull();
    h.uploads.length = 0; show(37);
    expect(h.uploads[0].data).toEqual(firstSurface);
    expect(h.createCanvas).toHaveBeenCalledTimes(1);
    h.ground.destroy(); expect(h.alive.size).toBe(0);
  });

  it('uses identical native soil pixels for display and reduced terrain snapshots', () => {
    const h = harness();
    h.ground.updateResidency({ x: 37, y: 19, width: 128, height: 128 });
    ChunkedRenderSurface.drainBakeQueue(h.scene as never);
    const normal = h.uploads[0]; h.uploads.length = 0;
    const target = h.scene.add.renderTexture(0, 0, 32, 32);
    const staging = new TerrainSnapshotStaging(h.scene as never, 512);
    for (const _ of h.ground.renderSnapshotDirt(target as never, { worldX: 37, worldY: 19, width: 128, height: 128 }, staging)) { /* build */ }
    const snapshot = h.uploads[0];
    for (let y = 0; y < 128; y++) {
      expect(snapshot.data.slice(y * snapshot.width * 4, (y * snapshot.width + 128) * 4))
        .toEqual(normal.data.slice(((y + 2) * normal.width + 2) * 4, ((y + 2) * normal.width + 130) * 4));
    }
    staging.destroy(); h.ground.destroy(); target.destroy(); expect(h.alive.size).toBe(0);
  });
  it('stages native pixels before yielding, batches uploads and clears reused regions', () => {
    const h = harness(), staging = new TerrainSnapshotStaging(h.scene as never, 512);
    const target = h.scene.add.renderTexture(0, 0, 256, 128);
    const work = h.ground.renderSnapshotDirt(target as never,
      { worldX: 37, worldY: 19, width: 1024, height: 512 }, staging);
    work.next(); expect(h.gpuUploads).toHaveLength(0);
    // Ordinary chunk baking can reuse the source pixels while the snapshot yields.
    h.ground.updateResidency({ x: 37 + 128, y: 19, width: 128, height: 128 });
    ChunkedRenderSurface.drainBakeQueue(h.scene as never);
    h.gpuUploads.length = 0;
    for (const _ of work) { /* remaining slices */ }
    const expected = new Uint8ClampedArray(512 * 512 * 4);
    new DirtSurfaceField(h.layout.seed, h.layout.dirt, h.frame).writeSurface(expected, 512, 37, 19, 512, groundMaterials);
    expect(h.gpuUploads).toHaveLength(2); // one upload per batch, never one per native tile
    expect(h.gpuUploads[1].data.every(value => value === 0)).toBe(true);
    expect(Buffer.from(h.gpuUploads[0].data).equals(Buffer.from(expected))).toBe(true);
    for (const _ of h.ground.renderSnapshotDirt(target as never,
      { worldX: 37 + 3500, worldY: 19, width: 512, height: 512 }, staging)) { /* clear region */ }
    expect(h.gpuUploads).toHaveLength(2);
    staging.destroy(); staging.destroy(); h.ground.destroy(); target.destroy();
    expect(h.alive.size).toBe(0);
  });

  it('releases staging on cancellation without uploading borrowed partial pixels', () => {
    const h = harness(), staging = new TerrainSnapshotStaging(h.scene as never, 512);
    const target = h.scene.add.renderTexture(0, 0, 128, 128);
    const work = h.ground.renderSnapshotDirt(target as never,
      { worldX: 37, worldY: 19, width: 512, height: 512 }, staging);
    work.next(); work.return(); staging.destroy(); h.ground.destroy(); target.destroy();
    expect(h.gpuUploads).toHaveLength(0); expect(h.alive.size).toBe(0);
  });
});
