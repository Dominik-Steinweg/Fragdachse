import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { markerGlyphAtlasFrames, markerGlyphSize, markerGlyphUvs, validMarkerGlyphSource, MARKER_GLYPH_PATHS, MARKER_GLYPH_SIZES } from '../src/effects/markers/MarkerGlyphAtlas';
import { runtimeAssetUrl } from '../src/assets/RuntimeAssetUrls';
import { MARKER_GLYPH_IDS } from '../src/effects/markers/MarkerTypes';

describe('replaceable marker glyph atlas', () => {
  it.each(MARKER_GLYPH_SIZES)('accepts the published flat %i px contract and versions both downloads by content', size => {
    const base = `assets/ui/markers/runtime/marker-glyphs-${size}`;
    const atlas = JSON.parse(readFileSync(`public/${base}.json`, 'utf8'));
    expect(validMarkerGlyphSource(atlas, size)).toBe(true);
    for (const ext of ['json', 'webp']) {
      const path = `${base}.${ext}`, hash = createHash('sha256').update(readFileSync(`public/${path}`)).digest('hex');
      expect(runtimeAssetUrl(`/${path}`)).toBe(`/${path}?v=${hash}`);
    }
    expect(validMarkerGlyphSource({ ...atlas, frames: { ...atlas.frames, base: { x: -1, y: 2, w: size, h: size } } }, size)).toBe(false);
    expect(validMarkerGlyphSource({ ...atlas, file: '../other.webp' }, size)).toBe(false);
    expect(validMarkerGlyphSource({ ...atlas, trimmed: true }, size)).toBe(false);
    expect(validMarkerGlyphSource({ ...atlas, size: 64 }, size)).toBe(false);
  });
  it('chooses the smallest adequate raster in actual render pixels', () => {
    expect([7, 16, 16.1, 24, 25, 64].map(markerGlyphSize)).toEqual([16, 16, 24, 24, 32, 32]);
  });
  it('uses sized frames while retaining the preloaded canonical-ID contract', () => {
    const sized = { u0: .1, v0: .2, u1: .3, v1: .4 }, canonical = { u0: .5, v0: .6, u1: .7, v1: .8 };
    const texture = { has: (id: string) => id.endsWith('@16'), get: (id: string) => id.endsWith('@16') ? sized : canonical };
    expect(markerGlyphUvs(texture as never, 16).boss).toEqual(sized);
    expect(markerGlyphUvs(texture as never, 24).boss).toEqual(canonical);
  });
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
