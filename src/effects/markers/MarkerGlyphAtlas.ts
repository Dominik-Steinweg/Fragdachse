import type * as Phaser from 'phaser';
import { MARKER_GLYPH_IDS, type MarkerGlyphId } from './MarkerTypes';

/** Replacement contract: Phaser JSON hash atlas, one untrimmed/unrotated square frame
 * named exactly as every MARKER_GLYPH_IDS entry (32 px), optionally `${id}@16/24/32`.
 * White alpha silhouettes, transparent gutters >= 2 px, one image, no PMA data encoding.
 * Publish marker-glyphs.json + its meta.image next to it at this URL, or preload under
 * MARKER_GLYPH_ATLAS_KEY. No renderer change is needed. Atlas textures are borrowed;
 * only this module's fallback / optional download is reference-counted and removed.
 */
export const MARKER_GLYPH_ATLAS_KEY = 'marker-glyphs';
export const MARKER_GLYPH_ATLAS_URL = '/assets/ui/markers/marker-glyphs.json';
export const MARKER_GLYPH_FALLBACK_KEY = 'marker-glyphs-placeholder';
export const MARKER_GLYPH_SIZES = [16, 24, 32] as const;

// Deliberately simple filled silhouettes; coordinates use a 16 x 16 design grid.
export const MARKER_GLYPH_PATHS: Readonly<Record<MarkerGlyphId, string>> = {
  base: 'M1 1H5V3H11V1H15V5H13V11H15V15H11V13H5V15H1V11H3V5H1Z M6 6V10H10V6Z',
  boss: 'M1 1L4 4L6 3H10L12 4L15 1L14 7L12 8L11 13H9V15H7V13H5L4 8L2 7Z M5 7L7 8L6 10Z M11 7L10 10L9 8Z',
  'site-wreck': 'M7 1H10L9 6H7Z M11 8L15 11L13 14L9 10Z M6 9L3 14L1 11L5 7Z M6 6H9V9H6Z',
  'site-extractor': 'M2 2H5V4H2Z M11 2H14V4H11Z M1 5H6V14H1Z M10 5H15V14H10Z M7 5H9V10H10L8 13L6 10H7Z',
  'site-brood-nest': 'M1 12L3 6L5 10L8 2L11 10L13 6L15 12L13 15H3Z M6 11V13H10V11Z',
  'site-supply': 'M2 5H14V15H2Z M5 1H11V4H9V3H7V4H5Z M6 8V10H4V12H6V14H10V12H12V10H10V8Z',
  'site-scrap-heaps': 'M1 10L5 8L7 14H1Z M7 6L11 5L14 9L9 12Z M3 2H7V6H3Z M11 11H15V15H11Z',
  scavenger: 'M6 1H10V5H6Z M4 6H11L15 9L13 11L10 9L9 11L13 13L12 15L6 13L5 10L2 12L1 10L4 7Z',
  'mission-destroy': 'M7 1H9L10 5L14 3L13 7L16 9L12 10L13 15L9 13L6 16L5 12L0 11L4 8L2 4L6 5Z',
  'mission-hold': 'M2 1H14V9L12 13L8 16L4 13L2 9Z M7 4V11H9V4Z',
  'mission-carry': 'M1 7H6V12H1Z M10 7H15V12H10Z M7 6V2H5L8 0L11 2H9V6Z M4 13H12V15H4Z',
  crate: 'M2 5H14V15H2Z M5 1H11L13 4H10L9 3H7L6 4H3Z M7 5V15H9V5Z',
  flag: 'M2 1H4V14H6V16H0V14H2Z M5 2L15 5L5 9Z',
  hazard: 'M6 1H10L9 10H7Z M6 12H10V16H6Z',
  timebomb: 'M6 1H10V3H6Z M11 3L13 1L15 3L13 5L15 8V12L11 16H5L1 12V8L5 4H10Z M7 6V11H12V9H9V6Z',
  tool: 'M10 1L8 5L11 8L15 6L14 10L10 11L5 16L1 12L6 7L6 3Z',
  check: 'M1 8L4 5L7 9L12 2L15 5L7 15Z',
  cross: 'M2 0L8 6L14 0L16 2L10 8L16 14L14 16L8 10L2 16L0 14L6 8L0 2Z',
};

export function markerGlyphAtlasFrames() {
  const frames: Record<string, { frame: { x: number; y: number; w: number; h: number }; rotated: false; trimmed: false }> = {};
  for (const [row, size] of MARKER_GLYPH_SIZES.entries()) {
    MARKER_GLYPH_IDS.forEach((id, col) => {
      const frame = { frame: { x: col * 36 + 2, y: row * 36 + 2, w: size, h: size }, rotated: false as const, trimmed: false as const };
      frames[`${id}@${size}`] = frame;
      if (size === 32) frames[id] = frame;
    });
  }
  return { frames, meta: { size: { w: MARKER_GLYPH_IDS.length * 36, h: 108 } } };
}

export interface MarkerGlyphUv { readonly u0: number; readonly v0: number; readonly u1: number; readonly v1: number }
export function markerGlyphUvs(texture: Phaser.Textures.Texture): Record<MarkerGlyphId, MarkerGlyphUv> {
  return Object.fromEntries(MARKER_GLYPH_IDS.map(id => {
    const f = texture.get(id);
    return [id, { u0: f.u0, v0: f.v0, u1: f.u1, v1: f.v1 }];
  })) as Record<MarkerGlyphId, MarkerGlyphUv>;
}

interface Lease { refs: number; owned: Set<string>; abort: AbortController }
const leases = new WeakMap<Phaser.Textures.TextureManager, Lease>();
function complete(texture: Phaser.Textures.Texture): boolean {
  return MARKER_GLYPH_IDS.every(id => texture.has(id) && !texture.get(id).rotated && texture.get(id).sourceIndex === 0);
}

/** Called only after the renderer's WebGL/presentation guard. Never fetches in headless. */
export function acquireMarkerGlyphAtlas(scene: Phaser.Scene): { texture(): Phaser.Textures.Texture; release(): void } {
  const textures = scene.textures;
  let lease = leases.get(textures);
  if (!lease) {
    lease = { refs: 0, owned: new Set(), abort: new AbortController() };
    leases.set(textures, lease);
    if (!textures.exists(MARKER_GLYPH_FALLBACK_KEY)) {
      const atlas = markerGlyphAtlasFrames();
      const canvas = document.createElement('canvas');
      canvas.width = atlas.meta.size.w; canvas.height = atlas.meta.size.h;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      for (const [row, size] of MARKER_GLYPH_SIZES.entries()) {
        MARKER_GLYPH_IDS.forEach((id, col) => {
          ctx.save(); ctx.translate(col * 36 + 2, row * 36 + 2); ctx.scale(size / 16, size / 16);
          ctx.fill(new Path2D(MARKER_GLYPH_PATHS[id]), 'evenodd'); ctx.restore();
        });
      }
      const texture = textures.addCanvas(MARKER_GLYPH_FALLBACK_KEY, canvas)!;
      for (const [id, entry] of Object.entries(atlas.frames)) {
        const f = entry.frame; texture.add(id, 0, f.x, f.y, f.w, f.h);
      }
      lease.owned.add(MARKER_GLYPH_FALLBACK_KEY);
    }
    if (!textures.exists(MARKER_GLYPH_ATLAS_KEY)) void loadOptionalAtlas(textures, lease);
  }
  lease.refs++;
  const held = lease;
  let released = false;
  return {
    texture: () => textures.exists(MARKER_GLYPH_ATLAS_KEY) && complete(textures.get(MARKER_GLYPH_ATLAS_KEY))
      ? textures.get(MARKER_GLYPH_ATLAS_KEY) : textures.get(MARKER_GLYPH_FALLBACK_KEY),
    release: () => {
      if (released) return;
      released = true;
      if (--held.refs !== 0) return;
      held.abort.abort();
      for (const key of held.owned) if (textures.exists(key)) textures.remove(key);
      leases.delete(textures);
    },
  };
}

async function loadOptionalAtlas(textures: Phaser.Textures.TextureManager, lease: Lease): Promise<void> {
  const signal = lease.abort.signal;
  try {
    const url = new URL(MARKER_GLYPH_ATLAS_URL, window.location.href);
    const response = await fetch(url, { signal });
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return;
    const atlas = await response.json();
    if (!atlas.frames || !MARKER_GLYPH_IDS.every(id => atlas.frames[id])) return;
    const imageResponse = await fetch(new URL(atlas.meta?.image ?? 'marker-glyphs.png', url), { signal });
    if (!imageResponse.ok) return;
    const objectUrl = URL.createObjectURL(await imageResponse.blob());
    try {
      const source = new Image(); source.src = objectUrl; await source.decode();
      if (signal.aborted || textures.exists(MARKER_GLYPH_ATLAS_KEY)) return;
      const texture = textures.addAtlas(MARKER_GLYPH_ATLAS_KEY, source, atlas);
      if (!texture) return;
      if (!complete(texture)) { textures.remove(MARKER_GLYPH_ATLAS_KEY); return; }
      lease.owned.add(MARKER_GLYPH_ATLAS_KEY);
    } finally { URL.revokeObjectURL(objectUrl); }
  } catch { /* The authored atlas is optional; the complete runtime atlas remains usable. */ }
}
