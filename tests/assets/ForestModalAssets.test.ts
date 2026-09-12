import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({}));
vi.mock('../../src/ui/LivingBarEffect', () => ({ rgbStr: () => '' }));
import { MODAL_FRAME_ASSET, preloadForestModalAssets } from '../../src/ui/ForestModal';

describe('forest modal frame kit', () => {
  it('preloads the documented original PNG with transparent interior and antialiased cutout edges', async () => {
    const image = vi.fn(); preloadForestModalAssets({ image } as any);
    expect(image).toHaveBeenCalledExactlyOnceWith(MODAL_FRAME_ASSET.key, MODAL_FRAME_ASSET.file);
    const root = resolve(__dirname, '../../public/assets/ui/forest-modals');
    const prompts = JSON.parse(readFileSync(resolve(root, 'prompts.json'), 'utf8'));
    expect(prompts.assets.find((asset: any) => asset.key === MODAL_FRAME_ASSET.key)?.prompt.length).toBeGreaterThan(0);
    const png = sharp(resolve(root, 'frame-kit.png'));
    const meta = await png.metadata();
    expect(meta.format).toBe('png'); expect(meta.hasAlpha).toBe(true);
    expect(meta.width).toBe(meta.height); expect(meta.width).toBeGreaterThanOrEqual(1024);
    const alpha = await png.clone().extractChannel('alpha').raw().toBuffer();
    expect(alpha.some(a => a === 0)).toBe(true);
    expect(alpha.some(a => a > 0 && a < 255)).toBe(true);
    expect(alpha.some(a => a > 180)).toBe(true);
    const inside = await png.clone().extract({ left: Math.floor(meta.width! * .3), top: Math.floor(meta.height! * .3),
      width: Math.floor(meta.width! * .4), height: Math.floor(meta.height! * .4) }).extractChannel('alpha').raw().toBuffer();
    expect(inside.every(a => a <= 1)).toBe(true);
  });
});
