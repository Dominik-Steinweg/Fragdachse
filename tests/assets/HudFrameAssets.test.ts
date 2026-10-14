import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import exportsJson from '../../src/ui/hudFrameExports.json';
import { HUD_FRAME_TEXTURE, HUD_TONES, preloadHudFrameAssets } from '../../src/ui/HudFrameAssets';
import { DAWN_UI_ASSETS } from '../../src/assets/DawnUiAssets';
import { DAWN_CLOCK_PARTS, dawnClockTexture, preloadDawnClockAssets } from '../../src/assets/DawnClockAssets';
import { GAME_WIDTH } from '../../src/config';
import clockManifest from '../../public/assets/ui/dawn-clock/runtime/manifest.json';
import { runtimeAssetUrl } from '../../src/assets/RuntimeAssetUrls';

const root = resolve(__dirname, '../../public/assets/ui/hud-frames');
const frames = exportsJson.atlas.frames as Record<string, { frame: { x: number; y: number; w: number; h: number } }>;

describe('HUD frame artwork', () => {
  it.each([1, 2])('registers all sundial layers at %ix with their common canvas', async scale => {
    const image = vi.fn();
    preloadDawnClockAssets({ image, scene: { scale: { width: GAME_WIDTH * scale } } } as never);
    expect(image).toHaveBeenCalledTimes(DAWN_CLOCK_PARTS.length);
    for (const part of DAWN_CLOCK_PARTS) {
      const relative = `assets/ui/dawn-clock/runtime/${part}-${scale}x.webp`;
      expect(image).toHaveBeenCalledWith(dawnClockTexture(part), runtimeAssetUrl(`./${relative}`));
      const metadata = await sharp(resolve(__dirname, '../../public', relative)).metadata();
      expect(metadata.format).toBe('webp');
      expect([metadata.width, metadata.height]).toEqual([clockManifest.designCanvas.width * scale, clockManifest.designCanvas.height * scale]);
      expect(clockManifest.assets[part].origin).toEqual([clockManifest.pivot.x, clockManifest.pivot.y]);
    }
  });

  it('preloads the exported atlas and Dawn icons and retains its original and generation prompt', async () => {
    const atlas = vi.fn();
    const image = vi.fn();
    preloadHudFrameAssets({ atlas, image, scene: { scale: { width: GAME_WIDTH } } } as never);
    for (const asset of DAWN_UI_ASSETS) {
      expect(image).toHaveBeenCalledWith(asset.key, runtimeAssetUrl(`./assets/ui/dawn/${asset.path}`));
    }
    expect(atlas).toHaveBeenCalledExactlyOnceWith(HUD_FRAME_TEXTURE, './assets/ui/hud-frames/' + exportsJson.file, exportsJson.atlas);
    expect(exportsJson.file.startsWith('runtime/')).toBe(true);

    const runtime = resolve(root, exportsJson.file);
    const metadata = await sharp(runtime).metadata();
    expect(metadata.format).toBe('webp');
    expect([metadata.width, metadata.height]).toEqual([exportsJson.width, exportsJson.height]);
    const original = resolve(root, exportsJson.source);
    expect((await sharp(original).metadata()).format).toBe('png');
    expect(readFileSync(runtime).length).toBeLessThan(readFileSync(original).length);
    const prompts = JSON.parse(readFileSync(resolve(root, 'prompts.json'), 'utf8'));
    expect(prompts.assets.some((entry: { file: string; prompt: string }) =>
      entry.file === exportsJson.source && entry.prompt.length > 0)).toBe(true);
  });

  it('offers one card frame per tone family, plus strip and divider, inside the atlas', () => {
    for (const tone of Object.keys(HUD_TONES)) expect(frames[`card-${tone}`]).toBeDefined();
    expect(frames.strip).toBeDefined();
    expect(frames.divider).toBeDefined();
    for (const { frame } of Object.values(frames)) {
      expect(frame.x + frame.w).toBeLessThanOrEqual(exportsJson.width);
      expect(frame.y + frame.h).toBeLessThanOrEqual(exportsJson.height);
    }
  });

  it.each(Object.keys(HUD_TONES))('card-%s keeps its interior genuinely transparent', async (tone) => {
    const { frame } = frames[`card-${tone}`];
    const card = exportsJson.card;
    // Innenraum zwischen den Ecken und zwischen oberer Schiene und Rinne: Die Welt bleibt sichtbar.
    const alpha = await sharp(resolve(root, exportsJson.file))
      .extract({
        left: frame.x + card.cap,
        top: frame.y + card.interiorTop + 6,
        width: frame.w - card.cap * 2,
        height: card.interiorBottom - card.interiorTop - 12,
      })
      .extractChannel('alpha').raw().toBuffer();
    // Der Generator hinterlässt unter der Schiene einen unsichtbaren Schattenrest (≤ 3/255);
    // alles darüber wäre eine sichtbare Trübung der Welt.
    expect(alpha.every((value) => value <= 4)).toBe(true);
  });
});
