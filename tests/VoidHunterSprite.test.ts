import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Jimp } from 'jimp';

describe('Leerenjäger sprite asset', () => {
  it('is a compact RGBA PNG with transparent corners and visible center pixels', async () => {
    const path = fileURLToPath(new URL(
      '../public/assets/sprites/enemies/enemy_void_hunter.png',
      import.meta.url,
    ));
    const image = await Jimp.read(path);
    expect(image.bitmap.width).toBe(128);
    expect(image.bitmap.height).toBe(128);

    const alphaAt = (x: number, y: number) => image.bitmap.data[(y * image.bitmap.width + x) * 4 + 3];
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(127, 0)).toBe(0);
    expect(alphaAt(0, 127)).toBe(0);
    expect(alphaAt(127, 127)).toBe(0);
    expect(alphaAt(64, 64)).toBeGreaterThan(200);
  });
});
