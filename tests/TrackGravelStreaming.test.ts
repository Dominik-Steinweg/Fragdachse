import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());

import { CELL_SIZE, DEPTH } from '../src/config';
import type { ArenaLayout } from '../src/types';
import { GroundSurfaceStreamer, GROUND_TRACK_GRAVEL_LAYER_ID } from '../src/arena/chunks/GroundSurfaceStreamer';
import { ChunkedRenderSurface } from '../src/arena/chunks/ChunkedRenderSurface';
import { createFakeArenaScene } from './fakeArenaRenderScene';

const FRAME = { offsetX: 37, offsetY: 19, width: 4096, height: 256 };
const VIEW = { x: FRAME.offsetX, y: FRAME.offsetY, width: 128, height: 128 };
const layout: ArenaLayout = {
  seed: 17, rocks: [], trees: [], dirt: [], decals: [], powerUpPedestals: [],
  tracks: Array.from({ length: FRAME.height / CELL_SIZE }, (_, gridY) => ({ gridX: 2, gridY })),
};

/** Canvas upload port only; mask pixels are tested directly, without pretending to emulate WebGL. */
function harness(tracks = layout.tracks) {
  const scene = createFakeArenaScene();
  const uploads: Array<{ width: number; data: Uint8ClampedArray }> = [];
  const liveMasks = new Set<string>();
  const renderTargets: Array<{ active: boolean }> = [];
  const originalCreate = scene.add.renderTexture;
  scene.add.renderTexture = (...args) => {
    const target = originalCreate(...args);
    renderTargets.push(target);
    return target;
  };
  const sceneImages = vi.spyOn(scene.add, 'image');
  const createCanvas = vi.fn((key: string, width: number, height: number) => {
    liveMasks.add(key);
    return {
      key,
      context: {
        createImageData: () => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
        putImageData: (image: { width: number; data: Uint8ClampedArray }) =>
          uploads.push({ width: image.width, data: image.data.slice() }),
      },
      refresh: vi.fn(),
    };
  });
  Object.assign(scene.textures, { createCanvas, remove: (key: string) => liveMasks.delete(key) });
  const streamer = new GroundSurfaceStreamer({
    scene: scene as never, frame: FRAME, layout: { ...layout, tracks }, groundCoverPlacements: [], chunkSize: 128,
  });
  return { scene, streamer, uploads, liveMasks, renderTargets, createCanvas, sceneImages };
}

describe('railway gravel streaming', () => {
  it('allocates gravel resources only for track worlds and releases them with presentation', () => {
    const empty = harness([]);
    const rail = harness();
    expect(empty.createCanvas).not.toHaveBeenCalled();
    expect(rail.streamer.getStats().layers).toBe(empty.streamer.getStats().layers + 1);
    expect(DEPTH.TRACK_GRAVEL).toBeGreaterThan(DEPTH.GROUND_COVER);
    expect(DEPTH.TRACK_GRAVEL).toBeLessThan(DEPTH.TRACKS);
    rail.streamer.updateResidency(VIEW);
    ChunkedRenderSurface.drainBakeQueue(rail.scene as never);
    expect(rail.streamer.getChunkTexture(GROUND_TRACK_GRAVEL_LAYER_ID, 0, 0)).not.toBeNull();
    expect(rail.sceneImages).not.toHaveBeenCalled();
    rail.streamer.destroy();
    empty.streamer.destroy();
    expect(rail.liveMasks.size).toBe(0);
    expect(rail.renderTargets.every(texture => !texture.active)).toBe(true);
  });

  it('reuses one mask and reproduces gravel after releasing and revisiting chunks', () => {
    const h = harness();
    const read = () => {
      const texture = h.streamer.getChunkTexture(GROUND_TRACK_GRAVEL_LAYER_ID, 0, 0) as unknown as { content: string[] };
      return texture.content.filter(entry => entry.includes('track_gravel_')).slice();
    };
    h.streamer.updateResidency(VIEW);
    ChunkedRenderSurface.drainBakeQueue(h.scene as never);
    const first = read();
    expect(first.length).toBeGreaterThan(0);
    h.streamer.updateResidency({ ...VIEW, x: FRAME.offsetX + 3500 });
    ChunkedRenderSurface.drainBakeQueue(h.scene as never);
    expect(h.streamer.getChunkTexture(GROUND_TRACK_GRAVEL_LAYER_ID, 0, 0)).toBeNull();
    h.streamer.updateResidency(VIEW);
    ChunkedRenderSurface.drainBakeQueue(h.scene as never);
    expect(read()).toEqual(first);
    expect(h.createCanvas).toHaveBeenCalledTimes(1);
    h.streamer.destroy();
  });

  it('uses the same world mask for normal chunks and scaled terrain snapshots', () => {
    const h = harness();
    h.streamer.updateResidency(VIEW);
    ChunkedRenderSurface.drainBakeQueue(h.scene as never);
    const normal = h.uploads[0];
    expect(normal).toBeDefined();
    h.uploads.length = 0;
    const target = h.scene.add.renderTexture(0, 0, 32, 32);
    h.streamer.renderSnapshotTrackGravel(target as never, {
      worldX: FRAME.offsetX, worldY: FRAME.offsetY, width: 128, height: 128,
    }, 0.25);
    const snapshot = h.uploads[0];
    for (let y = 0; y < 128; y += 1) {
      const normalStart = ((y + 2) * normal.width + 2) * 4;
      expect(snapshot.data.slice(y * snapshot.width * 4, (y * snapshot.width + 128) * 4))
        .toEqual(normal.data.slice(normalStart, normalStart + 128 * 4));
    }
    expect(target.content.some(entry => entry.includes('track_gravel_'))).toBe(true);
    h.streamer.destroy();
    target.destroy();
  });
});
