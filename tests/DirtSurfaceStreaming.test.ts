import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());
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
  const alive = new Set<string>();
  const createCanvas = vi.fn((key: string, width: number, height: number) => {
    alive.add(key);
    return { key, context: {
      createImageData: () => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: (image: { width: number; data: Uint8ClampedArray }) => uploads.push({ width: image.width, data: image.data.slice() }),
    }, refresh() {} };
  });
  Object.assign(scene.textures, { createCanvas, remove: (key: string) => alive.delete(key) });
  const frame = { offsetX: 37, offsetY: 19, width: 4096, height: 512 };
  const layout: ArenaLayout = { seed: 17, rocks: [], trees: [], tracks: [], powerUpPedestals: [],
    dirt: Array.from({ length: 12 * 8 }, (_, i) => ({ gridX: 1 + i % 12, gridY: 1 + Math.floor(i / 12) })) };
  const ground = new GroundSurfaceStreamer({ scene: scene as never, frame, layout, groundCoverPlacements: [], chunkSize: 128, groundMaterials });
  return { scene, ground, frame, uploads, alive, createCanvas };
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
    h.ground.renderSnapshotDirt(target as never, { worldX: 37, worldY: 19, width: 128, height: 128 }, .25);
    const snapshot = h.uploads[0];
    for (let y = 0; y < 128; y++) {
      expect(snapshot.data.slice(y * snapshot.width * 4, (y * snapshot.width + 128) * 4))
        .toEqual(normal.data.slice(((y + 2) * normal.width + 2) * 4, ((y + 2) * normal.width + 130) * 4));
    }
    h.ground.destroy(); target.destroy();
  });
});
