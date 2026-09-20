import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { DEFERRED_ASSETS } from '../../src/assets/DeferredAssets';

describe('deferred asset manifest', () => {
  it('ships decodable images and preserves cutout alpha where present', async () => {
    for (const asset of DEFERRED_ASSETS.filter(asset => asset.type === 'image')) {
      const image = sharp(resolve(__dirname, '../../public', asset.url));
      const metadata = await image.metadata();
      expect(metadata.width).toBeGreaterThan(0);
      if (!metadata.hasAlpha) { await image.raw().toBuffer(); continue; }
      const alpha = await image.extractChannel('alpha').raw().toBuffer();
      expect(alpha.some(value => value === 0)).toBe(true);
      expect(alpha.some(value => value === 255)).toBe(true);
    }
  });
  it('references unique shipped files, with explicit failure policy and valid audio containers', () => {
    expect(new Set(DEFERRED_ASSETS.map(asset => asset.key)).size).toBe(DEFERRED_ASSETS.length);
    for (const asset of DEFERRED_ASSETS) {
      const path = resolve(__dirname, '../../public', asset.url);
      expect(statSync(path).size).toBeGreaterThan(0);
      expect(typeof asset.optional).toBe('boolean');
      if (asset.type === 'audio' && asset.url.endsWith('.ogg')) {
        expect(readFileSync(path).subarray(0, 4).toString()).toBe('OggS');
      }
    }
  });
});
