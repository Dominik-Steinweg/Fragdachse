import { describe, expect, it } from 'vitest';
import {
  ARENA_RENDER_CHUNK_SIZE,
  ArenaChunkGrid,
  worldRectToLocalRect,
} from '../src/arena/chunks/ArenaChunkGrid';
import { ROCK_OVERLAY_CHUNK_SIZE } from '../src/arena/RockOverlayRegions';

/**
 * Die Rastergeometrie der gestreamten Weltschichten. Sie entscheidet, welche Chunks resident
 * werden, und damit auch, ob am Rand einer Karte Chunks angefordert werden, die es gar nicht gibt.
 */

const FRAME = { offsetX: 100, offsetY: 12, width: 12_800, height: 2_560 };

describe('arena chunk grid', () => {
  it('nests the 128 px dirty granularity inside a render chunk', () => {
    // Bliebe diese Beziehung nicht ganzzahlig, laege ein Dirty-Chunk teils in zwei Renderzielen
    // und ein einzelner Blit koennte ihn nicht mehr schreiben.
    expect(ARENA_RENDER_CHUNK_SIZE % ROCK_OVERLAY_CHUNK_SIZE).toBe(0);
    expect(ARENA_RENDER_CHUNK_SIZE).toBeGreaterThan(ROCK_OVERLAY_CHUNK_SIZE);

    const grid = new ArenaChunkGrid(1024, 1024, ARENA_RENDER_CHUNK_SIZE);
    const regions = grid.dirtyRegionsOf(grid.coord(1, 1));
    expect(regions).toHaveLength((ARENA_RENDER_CHUNK_SIZE / ROCK_OVERLAY_CHUNK_SIZE) ** 2);
    for (const region of regions) {
      expect(region.localX % ROCK_OVERLAY_CHUNK_SIZE).toBe(0);
      expect(region.localY % ROCK_OVERLAY_CHUNK_SIZE).toBe(0);
      expect(grid.chunkAt(region.localX, region.localY)).toMatchObject({ cx: 1, cy: 1 });
    }
  });

  it('rejects a render chunk size that is not a multiple of the dirty granularity', () => {
    expect(() => new ArenaChunkGrid(1024, 1024, 300)).toThrow();
  });

  it('covers the frame completely, including a partial last chunk', () => {
    const grid = new ArenaChunkGrid(FRAME.width, FRAME.height, 512);
    expect(grid.cols).toBe(25);
    expect(grid.rows).toBe(5);
    // 2560 / 512 geht exakt auf; eine Zeile mehr waere eine Zeile ohne Inhalt.
    expect(grid.rows * 512).toBeGreaterThanOrEqual(FRAME.height);

    const uneven = new ArenaChunkGrid(513, 129, 128);
    expect(uneven.cols).toBe(5);
    expect(uneven.rows).toBe(2);
  });

  it('clamps a view that hangs over the world edge instead of asking for missing chunks', () => {
    const grid = new ArenaChunkGrid(1024, 512, 512);

    // Kamera weit im Westen und Norden: Der lokale Ausschnitt beginnt negativ.
    const westOfWorld = grid.chunksInLocalRect({ localX: -900, localY: -400, width: 1000, height: 500 });
    expect(westOfWorld.every((chunk) => chunk.cx >= 0 && chunk.cy >= 0)).toBe(true);
    expect(westOfWorld).toContainEqual({ cx: 0, cy: 0, localX: 0, localY: 0 });

    // Kamera weit im Osten: kein Chunk jenseits der letzten Spalte.
    const eastOfWorld = grid.chunksInLocalRect({ localX: 900, localY: 0, width: 2000, height: 400 });
    expect(eastOfWorld.every((chunk) => chunk.cx < grid.cols && chunk.cy < grid.rows)).toBe(true);

    // Vollstaendig ausserhalb: gar nichts.
    expect(grid.chunksInLocalRect({ localX: 4000, localY: 0, width: 100, height: 100 })).toEqual([]);
    expect(grid.chunksInLocalRect({ localX: -4000, localY: 0, width: 100, height: 100 })).toEqual([]);
  });

  it('does not pull in the chunk behind a rect that ends exactly on a boundary', () => {
    const grid = new ArenaChunkGrid(2048, 512, 512);
    const flush = grid.chunksInLocalRect({ localX: 0, localY: 0, width: 512, height: 512 });
    expect(flush.map((chunk) => chunk.cx)).toEqual([0]);

    const oneOver = grid.chunksInLocalRect({ localX: 0, localY: 0, width: 513, height: 512 });
    expect(oneOver.map((chunk) => chunk.cx)).toEqual([0, 1]);
  });

  it('grows the requested set with the margin', () => {
    const grid = new ArenaChunkGrid(2048, 2048, 512);
    const rect = { localX: 600, localY: 600, width: 100, height: 100 };
    expect(grid.chunksInLocalRect(rect)).toHaveLength(1);
    expect(grid.chunksInLocalRect(rect, 128).length).toBeGreaterThan(1);
  });

  it('maps a world view into frame-local coordinates', () => {
    const local = worldRectToLocalRect({ x: 612, y: 12, width: 1920, height: 1080 }, FRAME);
    expect(local).toEqual({ localX: 512, localY: 0, width: 1920, height: 1080 });
  });

  it('round-trips chunk keys', () => {
    const grid = new ArenaChunkGrid(FRAME.width, FRAME.height, 512);
    for (const [cx, cy] of [[0, 0], [24, 4], [7, 3]] as const) {
      expect(grid.coordFromKey(grid.key(cx, cy))).toMatchObject({ cx, cy });
    }
  });

  /**
   * Die eigentliche Zusicherung von Block A: Die residente Renderziel-Flaeche haengt am
   * sichtbaren Ausschnitt, nicht an der Weltflaeche.
   */
  it('keeps the resident chunk count independent of the world size', () => {
    const view = { localX: 0, localY: 0, width: 1920, height: 1080 };
    const small = new ArenaChunkGrid(1920, 1088, 512).chunksInLocalRect(view, 128).length;
    const huge = new ArenaChunkGrid(12_800, 2_560, 512).chunksInLocalRect(view, 128).length;
    // Die grosse Karte ist rund 15-mal so gross und darf trotzdem nicht mehr Chunks anfordern,
    // als der Ausschnitt selbst beruehrt.
    expect(huge).toBeLessThanOrEqual(small + 2);
  });
});
