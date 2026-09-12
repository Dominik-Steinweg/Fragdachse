import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { FOREST_ASSETS, preloadForestAssets } from '../../src/ui/LobbyForestAssets';

const root = resolve(__dirname, '../../public/assets/ui/lobby-forest');

describe('lobby forest artwork', () => {
  it('preloads each shipped PNG and records its generation prompt', async () => {
    const image = vi.fn();
    preloadForestAssets({ image } as any);
    const prompts = JSON.parse(readFileSync(resolve(root, 'prompts.json'), 'utf8'));
    for (const [name, asset] of Object.entries(FOREST_ASSETS)) {
      const metadata = await sharp(resolve(root, asset.file)).metadata();
      expect(metadata.format).toBe('png');
      expect(metadata.width).toBeGreaterThan(0);
      expect(metadata.height).toBeGreaterThan(0);
      expect(image).toHaveBeenCalledWith(asset.key, './assets/ui/lobby-forest/' + asset.file);
      expect(prompts.assets.some((entry: { key: string; prompt: string }) => entry.key === name && entry.prompt.length > 0)).toBe(true);
    }
    expect(image).toHaveBeenCalledTimes(Object.keys(FOREST_ASSETS).length);
  });

  it.each(['frame', 'medallion'] as const)('%s leaves its central opening genuinely transparent', async (name) => {
    const source = sharp(resolve(root, FOREST_ASSETS[name].file));
    const { width, height, hasAlpha } = await source.metadata();
    expect(hasAlpha).toBe(true);
    const alpha = await source.extract({ left: Math.floor(width! * .4), top: Math.floor(height! * .4),
      width: Math.floor(width! * .2), height: Math.floor(height! * .2) }).extractChannel('alpha').raw().toBuffer();
    // Generated cutouts can retain a one-step alpha quantisation residue (1/255).
    // Reject any backing or visible haze in the opening while tolerating that residue.
    expect(alpha.every(value => value <= 1)).toBe(true);
    expect(alpha.filter(value => value === 0).length / alpha.length).toBeGreaterThan(.99);
  });

  it.each(['frame', 'leaves', 'medallion', 'relief'] as const)('%s retains alpha cutouts and softly antialiased edges', async (name) => {
    const source = sharp(resolve(root, FOREST_ASSETS[name].file));
    expect((await source.metadata()).hasAlpha).toBe(true);
    const alpha = await source.extractChannel('alpha').raw().toBuffer();
    expect(alpha.some(value => value === 0)).toBe(true);
    expect(alpha.some(value => value > 0 && value < 255)).toBe(true);
    expect(alpha.some(value => value > 180)).toBe(true);
  });
});
