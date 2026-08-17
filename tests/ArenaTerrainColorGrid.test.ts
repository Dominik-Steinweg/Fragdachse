import { describe, expect, it } from 'vitest';
import {
  ArenaTerrainColorGrid,
  TERRAIN_COLOR_FALLBACK,
  multiplyTerrainColor,
} from '../src/arena/ArenaTerrainColorGrid';

/**
 * Der kompakte Terrain-Farb-Lookup. Er ersetzt eine arenagrosse CPU-Canvas samt vollstaendigem
 * `ImageData`; die entscheidende Eigenschaft ist deshalb nicht die Farbe an einem Punkt, sondern
 * dass der Speicher an der Zahl der Rasterzellen haengt und nicht an der Weltflaeche.
 */

const CELL = 32;
const GRASS = 0x204060;

describe('arena terrain colour grid', () => {
  it('costs three bytes per grid cell, not per world pixel', () => {
    const grid = new ArenaTerrainColorGrid(400, 80, CELL, GRASS);
    grid.freeze();
    expect(grid.byteLength).toBe(400 * 80 * 3);

    // Zum Vergleich: Der alte Vollflaechen-Puffer waere bei derselben Karte 12 800 x 2 560 px
    // mal vier Kanaelen gewesen.
    const oldFullSurfaceBytes = 400 * CELL * 80 * CELL * 4;
    expect(grid.byteLength * 1000).toBeLessThan(oldFullSurfaceBytes);
  });

  it('starts from the base colour and returns it for untouched cells', () => {
    const grid = new ArenaTerrainColorGrid(4, 4, CELL, GRASS);
    grid.freeze();
    expect(grid.sampleLocal(0, 0)).toBe(GRASS);
    expect(grid.sampleLocal(3 * CELL + 5, 3 * CELL + 5)).toBe(GRASS);
  });

  it('returns the fallback outside the grid', () => {
    const grid = new ArenaTerrainColorGrid(4, 4, CELL, GRASS);
    grid.freeze();
    expect(grid.sampleLocal(-1, 0)).toBe(TERRAIN_COLOR_FALLBACK);
    expect(grid.sampleLocal(0, -1)).toBe(TERRAIN_COLOR_FALLBACK);
    expect(grid.sampleLocal(4 * CELL, 0)).toBe(TERRAIN_COLOR_FALLBACK);
    expect(grid.sampleLocal(0, 4 * CELL)).toBe(TERRAIN_COLOR_FALLBACK);
  });

  it('replaces a full cell at full opacity', () => {
    const grid = new ArenaTerrainColorGrid(4, 4, CELL, 0x000000);
    grid.paintCell(1, 2, 0xffffff, 1);
    grid.freeze();
    expect(grid.sampleLocal(1 * CELL + 3, 2 * CELL + 3)).toBe(0xffffff);
    expect(grid.sampleLocal(0, 0)).toBe(0x000000);
  });

  it('weights a small mark by the area it actually covers', () => {
    const grid = new ArenaTerrainColorGrid(2, 2, CELL, 0x000000);
    // Ein 16 px grosses Decal in einer 32 px grossen Zelle deckt ein Viertel der Flaeche.
    grid.paintRect(0, 0, 16, 16, 0xffffff, 1);
    grid.freeze();
    const value = grid.sampleLocal(4, 4) & 0xff;
    expect(value).toBeGreaterThan(0x30);
    expect(value).toBeLessThan(0x50);
  });

  it('spreads a rect over every cell it touches and leaves the others alone', () => {
    const grid = new ArenaTerrainColorGrid(4, 4, CELL, 0x000000);
    grid.paintRect(CELL - 8, CELL - 8, CELL + 8, CELL + 8, 0xffffff, 1);
    grid.freeze();
    for (const [gx, gy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      expect(grid.sampleLocal(gx * CELL + 1, gy * CELL + 1)).toBeGreaterThan(0);
    }
    expect(grid.sampleLocal(2 * CELL + 1, 2 * CELL + 1)).toBe(0x000000);
  });

  it('layers contributions in order, like the visible ground bands', () => {
    const grid = new ArenaTerrainColorGrid(1, 1, CELL, 0x000000);
    grid.paintCell(0, 0, 0xff0000, 1);
    grid.paintCell(0, 0, 0x00ff00, 1);
    grid.freeze();
    // Das spaetere Band gewinnt vollstaendig – "over" mit Deckkraft 1.
    expect(grid.sampleLocal(4, 4)).toBe(0x00ff00);
  });

  it('ignores contributions without area or opacity', () => {
    const grid = new ArenaTerrainColorGrid(2, 2, CELL, 0x123456);
    grid.paintRect(0, 0, 0, 10, 0xffffff, 1);
    grid.paintRect(0, 0, 10, 10, 0xffffff, 0);
    grid.paintCell(-1, 0, 0xffffff, 1);
    grid.paintCell(5, 5, 0xffffff, 1);
    grid.freeze();
    expect(grid.sampleLocal(1, 1)).toBe(0x123456);
  });

  it('multiplies two colours channel-wise', () => {
    expect(multiplyTerrainColor(0xffffff, 0x808080)).toBe(0x808080);
    expect(multiplyTerrainColor(0x204060, 0xffffff)).toBe(0x204060);
    expect(multiplyTerrainColor(0xff0000, 0x00ff00)).toBe(0x000000);
  });
});
