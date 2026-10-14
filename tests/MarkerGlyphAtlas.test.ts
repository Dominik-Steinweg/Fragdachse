import { describe, expect, it } from 'vitest';
import { markerGlyphAtlasFrames, MARKER_GLYPH_PATHS, MARKER_GLYPH_SIZES } from '../src/effects/markers/MarkerGlyphAtlas';
import { MARKER_GLYPH_IDS } from '../src/effects/markers/MarkerTypes';

describe('replaceable marker glyph atlas', () => {
  it('covers every public glyph ID with an independent silhouette', () => {
    expect(Object.keys(MARKER_GLYPH_PATHS).sort()).toEqual([...MARKER_GLYPH_IDS].sort());
    expect(new Set(Object.values(MARKER_GLYPH_PATHS)).size).toBe(MARKER_GLYPH_IDS.length);
    for (const path of Object.values(MARKER_GLYPH_PATHS)) expect(path).toMatch(/^M.+Z$/);
  });
  it('provides untrimmed 16/24/32 frames and canonical ID aliases without overlap/bleeding', () => {
    const atlas = markerGlyphAtlasFrames();
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    for (const id of MARKER_GLYPH_IDS) {
      expect(atlas.frames[id]).toBe(atlas.frames[`${id}@32`]);
      for (const size of MARKER_GLYPH_SIZES) {
        const entry = atlas.frames[`${id}@${size}`], f = entry.frame;
        expect(entry.rotated || entry.trimmed).toBe(false); expect(f.w).toBe(size); expect(f.h).toBe(size);
        expect(f.x).toBeGreaterThanOrEqual(2); expect(f.y).toBeGreaterThanOrEqual(2);
        expect(f.x + f.w + 2).toBeLessThanOrEqual(atlas.meta.size.w);
        expect(f.y + f.h + 2).toBeLessThanOrEqual(atlas.meta.size.h);
        for (const other of rects) expect(f.x >= other.x + other.w + 2 || other.x >= f.x + f.w + 2 ||
          f.y >= other.y + other.h + 2 || other.y >= f.y + f.h + 2).toBe(true);
        rects.push(f);
      }
    }
  });
});
