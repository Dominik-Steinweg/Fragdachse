import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { BASE_AUTOTILE } from '../../src/arena/AutoTiler';
import { BASE_ACCENT_PADDING, buildBaseAccentMask } from '../../src/arena/BaseAccentMask';
import { acquireBaseAccentGlowTexture } from '../../src/arena/BaseAccentGlowTexture';

afterEach(() => vi.unstubAllGlobals());

describe('Base accent masks', () => {
  it('extracts blue paint while excluding gray metal, other hues and transparent pixels', () => {
    const pixels = [96, 150, 168, 255, 80, 80, 80, 255, 77, 89, 90, 255,
      160, 40, 200, 255, 30, 180, 45, 255, 96, 150, 168, 0];
    const mask = buildBaseAccentMask(pixels, 6, { x: 0, y: 0, width: 6, height: 1 });
    const alphas = Array.from({ length: 6 }, (_, x) => mask.core[((BASE_ACCENT_PADDING * mask.width) + BASE_ACCENT_PADDING + x) * 4 + 3]);
    expect(alphas[0]).toBeGreaterThan(0);
    expect(alphas.slice(1)).toEqual([0, 0, 0, 0, 0]);
    expect(mask.halo[(BASE_ACCENT_PADDING * mask.width + BASE_ACCENT_PADDING - 1) * 4 + 3]).toBeGreaterThan(0);
    const neighbor = buildBaseAccentMask(pixels, 6, { x: 1, y: 0, width: 1, height: 1 });
    expect(neighbor.hasAccent).toBe(false);
    expect(neighbor.halo.every((value, i) => i % 4 !== 3 || value === 0)).toBe(true);
  });

  it('preserves every authored autotile frame and keeps the halo inside its padded atlas slot', async () => {
    const { data, info } = await sharp('public/assets/sprites/base47blob.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let lit = 0, empty = 0;
    for (const frame of new Set(BASE_AUTOTILE.bitmaskToFrame)) {
      const x = frame % (info.width / 32) * 32, y = Math.floor(frame / (info.width / 32)) * 32;
      expect(y + 32).toBeLessThanOrEqual(info.height);
      const mask = buildBaseAccentMask(data, info.width, { x, y, width: 32, height: 32 });
      if (mask.hasAccent) lit++; else empty++;
      for (let my = 0; my < mask.height; my++) {
        for (let mx = 0; mx < mask.width; mx++) {
          const i = (my * mask.width + mx) * 4 + 3;
          if (mx === 0 || my === 0 || mx === mask.width - 1 || my === mask.height - 1) expect(mask.halo[i]).toBe(0);
          if (mask.core[i] === 0) continue;
          const sx = mx - BASE_ACCENT_PADDING, sy = my - BASE_ACCENT_PADDING;
          expect(sx >= 0 && sx < 32 && sy >= 0 && sy < 32).toBe(true);
          const source = ((y + sy) * info.width + x + sx) * 4;
          expect(data[source + 1]).toBeGreaterThan(data[source]);
          expect(data[source + 2]).toBeGreaterThan(data[source]);
          expect(data[source + 3]).toBeGreaterThan(0);
        }
      }
    }
    expect(lit).toBeGreaterThan(0);
    expect(empty).toBeGreaterThan(0);
  });

  it('shares one bake, retains source frame names and releases only after the last user', () => {
    const pixels = new Uint8ClampedArray([96, 150, 168, 255, 80, 80, 80, 255]);
    const drawImage = vi.fn();
    vi.stubGlobal('document', { createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({ drawImage, getImageData: () => ({ data: pixels }) }),
    }) });
    const written: Array<{ name: string; x: number; y: number; width: number; height: number }> = [];
    const source = {
      getFrameNames: () => ['17', '3'],
      getSourceImage: () => ({ width: 2, height: 1 }),
      get: (name: string) => ({ cutX: name === '3' ? 0 : 1, cutY: 0, cutWidth: 1, cutHeight: 1 }),
    };
    const textures = {
      get: () => source,
      createCanvas: vi.fn(() => ({
        context: { createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: vi.fn() },
        add: (name: string, _index: number, x: number, y: number, width: number, height: number) => written.push({ name, x, y, width, height }),
        refresh: vi.fn(),
      })),
      remove: vi.fn(),
    };
    const first = acquireBaseAccentGlowTexture(textures as never);
    const second = acquireBaseAccentGlowTexture(textures as never);
    expect(textures.createCanvas).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect([...first.frames]).toEqual(['3']);
    expect(written.map(frame => frame.name)).toEqual(['3:core', '3:halo']);
    expect(written[1].x).toBeGreaterThanOrEqual(written[0].x + written[0].width);
    first.release(); first.release();
    expect(textures.remove).not.toHaveBeenCalled();
    second.release();
    expect(textures.remove).toHaveBeenCalledExactlyOnceWith(first.key);
    const next = acquireBaseAccentGlowTexture(textures as never);
    expect(drawImage).toHaveBeenCalledTimes(2);
    next.release();
  });
});
