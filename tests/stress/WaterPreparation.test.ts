import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({}));
import { WaterSurfaceRenderer } from '../../src/arena/WaterSurfaceRenderer';
import { WaterSurfaceModel, WATER_MASK_HALO, WATER_MASK_STEP } from '../../src/arena/WaterSurfaceModel';
import { ARENA_RENDER_CHUNK_SIZE } from '../../src/arena/chunks/ArenaChunkGrid';
import { CELL_SIZE } from '../../src/config';
import map from '../../src/config/coopDefenseMaps/00-test.json';

describe('world water preparation capacity', () => {
  it.each(['authored Map 0', '4096 lake', '8192 lake', '8192 dry'])(
    'reports CPU cache and loading work for %s', async name => {
      const size = name.startsWith('4096') ? 4096 : 8192;
      const water = name.includes('dry') ? [] : name === 'authored Map 0' ? map.water :
        Array.from({ length: (size / CELL_SIZE) ** 2 }, (_, i) => ({
          gridX: i % (size / CELL_SIZE), gridY: Math.floor(i / (size / CELL_SIZE)),
        }));
      const frame = { offsetX: 0, offsetY: 0,
        width: name === 'authored Map 0' ? map.arenaWidthCells * CELL_SIZE : size,
        height: name === 'authored Map 0' ? map.arenaHeightCells * CELL_SIZE : size };
      const expected = new WaterSurfaceModel(water, frame)
        .getChunkOrigins(ARENA_RENDER_CHUNK_SIZE, frame.width, frame.height).length;
      const start = performance.now();
      const renderer = new WaterSurfaceRenderer({} as never, frame, water, 1);
      const topologyMs = performance.now() - start;
      let frames = 0, cpuMs = 0, maxBatchMs = 0;
      while (!renderer.isPrepared()) {
        const before = performance.now();
        renderer.prepareMasks();
        const elapsed = performance.now() - before;
        cpuMs += elapsed; maxBatchMs = Math.max(maxBatchMs, elapsed); frames++;
        // Exercise resumability with an event-loop pause, not a draining microtask loop.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      const maskBytes = ((ARENA_RENDER_CHUNK_SIZE + 2 * WATER_MASK_HALO) / WATER_MASK_STEP) ** 2 * 4;
      expect(renderer.getPreparationState()).toEqual({ pending: 0, completed: expected, bytes: expected * maskBytes });
      console.log(JSON.stringify({ name, chunks: expected, cacheMiB: expected * maskBytes / 2 ** 20,
        topologyMs, cpuMs, frames, estimatedLoadSecondsAt60Hz: frames / 60, maxBatchMs }));
      renderer.destroy();
      renderer.prepareMasks();
      expect(renderer.getPreparationState()).toEqual({ pending: 0, completed: 0, bytes: 0 });
    }, 120_000,
  );
});
