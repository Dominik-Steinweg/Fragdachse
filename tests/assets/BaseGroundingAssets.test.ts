import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { BASE_GROUNDING_ASSETS, baseGroundingTextureKey, preloadBaseGroundingAssets } from '../../src/arena/BaseGroundingConfig';

describe('Generated foundation textures', () => {
  it('loads every selected asset through the runtime registry', async () => {
    const loaded = new Map<string, string>();
    preloadBaseGroundingAssets({ image: (key: string, path: string) => loaded.set(key, path) } as never);
    expect(loaded.size).toBe(BASE_GROUNDING_ASSETS.length);
    for (const asset of BASE_GROUNDING_ASSETS) {
      const path = resolve('public', loaded.get(baseGroundingTextureKey(asset))!);
      const metadata = await sharp(path).metadata();
      expect(metadata.format).toBe('png');
      expect(metadata.hasAlpha).toBe(true);
      const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let visible = 0, transparent = 0;
      let left = info.width, top = info.height, right = -1, bottom = -1;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const alpha = data[(y * info.width + x) * 4 + 3];
          if (alpha > 0) visible++; else transparent++;
          if (alpha >= 8) {
            left = Math.min(left, x); right = Math.max(right, x);
            top = Math.min(top, y); bottom = Math.max(bottom, y);
          }
          if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) expect(alpha).toBe(0);
        }
      }
      expect(visible).toBeGreaterThan(0);
      expect(transparent).toBeGreaterThan(0);
      // Invisible generator specks must not shrink the subject into a small canvas corner.
      expect(right - left + 1).toBeGreaterThan(info.width / 2);
      expect(bottom - top + 1).toBeGreaterThan(info.height / 2);
    }
  });
});
