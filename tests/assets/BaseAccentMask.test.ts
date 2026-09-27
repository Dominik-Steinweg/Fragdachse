import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { BASE_AUTOTILE } from '../../src/arena/AutoTiler';
import { BASE_ACCENT_PADDING, buildBaseAccentMask } from '../../src/arena/BaseAccentMask';
import { acquireBaseAccentGlowTexture } from '../../src/arena/BaseAccentGlowTexture';

afterEach(() => vi.unstubAllGlobals());

describe('Base accent masks', () => {
  it.each(['blue', 'violet'] as const)('extracts %s paint while excluding gray metal, other hues and transparent pixels', hue => {
    const accent = hue === 'violet' ? [160, 40, 200] : [96, 150, 168];
    const other = hue === 'violet' ? [96, 150, 168] : [160, 40, 200];
    const metal = hue === 'violet' ? [32, 22, 37] : [77, 89, 90];
    const pixels = [...accent, 255, 80, 80, 80, 255, ...metal, 255,
      ...other, 255, 30, 180, 45, 255, ...accent, 0];
    const mask = buildBaseAccentMask(pixels, 6, { x: 0, y: 0, width: 6, height: 1 }, hue);
    const alphas = Array.from({ length: 6 }, (_, x) => mask.core[((BASE_ACCENT_PADDING * mask.width) + BASE_ACCENT_PADDING + x) * 4 + 3]);
    expect(alphas[0]).toBeGreaterThan(0);
    expect(alphas.slice(1)).toEqual([0, 0, 0, 0, 0]);
    expect(mask.halo[(BASE_ACCENT_PADDING * mask.width + BASE_ACCENT_PADDING - 1) * 4 + 3]).toBeGreaterThan(0);
    const neighbor = buildBaseAccentMask(pixels, 6, { x: 1, y: 0, width: 1, height: 1 }, hue);
    expect(neighbor.hasAccent).toBe(false);
    expect(neighbor.halo.every((value, i) => i % 4 !== 3 || value === 0)).toBe(true);
  });

  it.each([
    ['base47blob.png', 'blue'], ['base47blob_hostile.png', 'violet'],
  ] as const)('preserves authored %s frames and keeps the halo inside each padded atlas slot', async (file, hue) => {
    const { data, info } = await sharp(`public/assets/sprites/${file}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let lit = 0, unlitMetal = 0;
    for (const frame of new Set(BASE_AUTOTILE.bitmaskToFrame)) {
      const x = frame % (info.width / 32) * 32, y = Math.floor(frame / (info.width / 32)) * 32;
      expect(y + 32).toBeLessThanOrEqual(info.height);
      const mask = buildBaseAccentMask(data, info.width, { x, y, width: 32, height: 32 }, hue);
      if (mask.hasAccent) lit++;
      for (let my = 0; my < mask.height; my++) {
        for (let mx = 0; mx < mask.width; mx++) {
          const i = (my * mask.width + mx) * 4 + 3;
          if (mx === 0 || my === 0 || mx === mask.width - 1 || my === mask.height - 1) expect(mask.halo[i]).toBe(0);
          const sx = mx - BASE_ACCENT_PADDING, sy = my - BASE_ACCENT_PADDING;
          const source = ((y + sy) * info.width + x + sx) * 4;
          if (mask.core[i] === 0) {
            if (sx >= 0 && sx < 32 && sy >= 0 && sy < 32 && data[source + 3] > 0) unlitMetal++;
            continue;
          }
          expect(sx >= 0 && sx < 32 && sy >= 0 && sy < 32).toBe(true);
          const neutral = data[source + (hue === 'violet' ? 1 : 0)];
          expect(data[source + (hue === 'violet' ? 0 : 1)]).toBeGreaterThan(neutral);
          expect(data[source + 2]).toBeGreaterThan(neutral);
          expect(data[source + 3]).toBeGreaterThan(0);
        }
      }
    }
    expect(lit).toBeGreaterThan(0);
    expect(unlitMetal).toBeGreaterThan(0);
  });

  it('shares one bake per source atlas and keeps faction masks and releases independent', () => {
    const pixels = new Uint8ClampedArray([96, 150, 168, 255, 80, 80, 80, 255]);
    const hostilePixels = new Uint8ClampedArray([80, 80, 80, 255, 160, 40, 200, 255]);
    let sampledPixels = pixels;
    const drawImage = vi.fn((image: { pixels: Uint8ClampedArray }) => { sampledPixels = image.pixels; });
    vi.stubGlobal('document', { createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({ drawImage, getImageData: () => ({ data: sampledPixels }) }),
    }) });
    const written: Array<{ name: string; x: number; y: number; width: number; height: number }> = [];
    const source = {
      getFrameNames: () => ['17', '3'],
      get: (name: string) => ({ cutX: name === '3' ? 0 : 1, cutY: 0, cutWidth: 1, cutHeight: 1 }),
    };
    const textures = {
      get: (key: string) => ({ ...source, getSourceImage: () => ({
        width: 2, height: 1, pixels: key === 'base_hostile' ? hostilePixels : pixels,
      }) }),
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
    const hostile = acquireBaseAccentGlowTexture(textures as never, 'base_hostile');
    const otherHostile = acquireBaseAccentGlowTexture(textures as never, 'base_hostile');
    expect(hostile.key).not.toBe(first.key);
    expect([...hostile.frames]).toEqual(['17']);
    expect([...first.frames]).toEqual(['3']);
    expect(drawImage).toHaveBeenCalledTimes(2);
    first.release(); first.release();
    expect(textures.remove).not.toHaveBeenCalled();
    second.release();
    expect(textures.remove).toHaveBeenCalledExactlyOnceWith(first.key);
    const next = acquireBaseAccentGlowTexture(textures as never);
    expect(drawImage).toHaveBeenCalledTimes(3);
    next.release();
    hostile.release();
    expect(textures.remove).not.toHaveBeenCalledWith(hostile.key);
    otherHostile.release();
    expect(textures.remove).toHaveBeenLastCalledWith(hostile.key);
  });
});
