import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { FOREST_ASSETS, preloadForestAssets } from '../../src/ui/LobbyForestAssets';
import { createHash } from 'node:crypto';
import { DAWN_UI_ASSETS } from '../../src/assets/DawnUiAssets';
import { runtimeAssetUrl } from '../../src/assets/RuntimeAssetUrls';

const root = resolve(__dirname, '../../public/assets/ui/lobby-forest');

describe('lobby forest artwork', () => {
  it('preloads only exported artwork and retains its original and generation prompt', async () => {
    const image = vi.fn();
    preloadForestAssets({ image } as any);
    const prompts = JSON.parse(readFileSync(resolve(root, 'prompts.json'), 'utf8'));
    for (const [name, asset] of Object.entries(FOREST_ASSETS)) {
      const metadata = await sharp(resolve(root, asset.file)).metadata();
      expect(['png', 'webp']).toContain(metadata.format);
      expect(asset.file.startsWith('runtime/')).toBe(true);
      expect(metadata.width).toBe(asset.width);
      expect(metadata.height).toBe(asset.height);
      const original = resolve(root, asset.file.replace('runtime/', '').replace(/\.(png|webp)$/, '.png'));
      expect((await sharp(original).metadata()).format).toBe('png');
      expect(readFileSync(resolve(root, asset.file)).length).toBeLessThan(readFileSync(original).length);
      expect(image).toHaveBeenCalledWith(asset.key, './assets/ui/lobby-forest/' + asset.file);
      expect(prompts.assets.some((entry: { key: string; prompt: string }) => entry.key === name && entry.prompt.length > 0)).toBe(true);
    }
    expect(image).toHaveBeenCalledTimes(Object.keys(FOREST_ASSETS).length + DAWN_UI_ASSETS.length);
  });

  it('loads square Dawn artwork including future categories through content-versioned URLs', async () => {
    const image = vi.fn();
    preloadForestAssets({ image } as any);
    expect(new Set(DAWN_UI_ASSETS.map(asset => asset.key)).size).toBe(DAWN_UI_ASSETS.length);
    for (const asset of DAWN_UI_ASSETS) {
      const file = `assets/ui/dawn/runtime/${asset.file}`;
      const bytes = readFileSync(resolve(__dirname, '../../public', file));
      const metadata = await sharp(bytes).metadata();
      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(metadata.height);
      expect(metadata.hasAlpha).toBe(true);
      const url = runtimeAssetUrl('./' + file);
      expect(url).toBe(`./${file}?v=${createHash('sha256').update(bytes).digest('hex')}`);
      expect(image).toHaveBeenCalledWith(asset.key, url);
    }
  });

  it.each(['frame', 'buttonFrame', 'medallion', 'ready', 'world'] as const)('%s leaves its central opening genuinely transparent', async (name) => {
    const source = sharp(resolve(root, FOREST_ASSETS[name].file));
    const { width, height, hasAlpha } = await source.metadata();
    expect(hasAlpha).toBe(true);
    // Generation margins have already been trimmed by the exporter.
    const alpha = await source.extract({ left: Math.floor(width! * .4), top: Math.floor(height! * .4),
      width: Math.floor(width! * .2), height: Math.floor(height! * .2) }).extractChannel('alpha').raw().toBuffer();
    // Generated cutouts can retain a one-step alpha quantisation residue (1/255).
    // Reject any backing or visible haze in the opening while tolerating that residue.
    expect(alpha.every(value => value <= 1)).toBe(true);
    // Require genuine cutouts without pinning the generator's proportion of 1/255 residue.
    expect(alpha.some(value => value === 0)).toBe(true);
  });

  it.each(['frame', 'buttonFrame', 'leaves', 'medallion', 'relief', 'ready', 'world'] as const)('%s retains alpha cutouts and softly antialiased edges', async (name) => {
    const source = sharp(resolve(root, FOREST_ASSETS[name].file));
    expect((await source.metadata()).hasAlpha).toBe(true);
    const alpha = await source.extractChannel('alpha').raw().toBuffer();
    expect(alpha.some(value => value === 0)).toBe(true);
    expect(alpha.some(value => value > 0 && value < 255)).toBe(true);
    expect(alpha.some(value => value > 180)).toBe(true);
  });
});
