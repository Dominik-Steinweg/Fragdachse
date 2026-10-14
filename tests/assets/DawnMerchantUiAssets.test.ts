import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DAWN_MERCHANT_UI, DAWN_MERCHANT_ITEM_TEXTURES, dawnMerchantArtTexture } from '../../src/assets/DawnMerchantUiAssets';
import { DAWN_UI_ASSETS } from '../../src/assets/DawnUiAssets';
import { DAWN_MERCHANT } from '../../src/config/dawn/merchant';

describe('Dawn merchant UI publication', () => {
  it('maps every merchant item slot to woodcut card and detail exports', () => {
    const manifest = JSON.parse(readFileSync('public/assets/ui/dawn/runtime/manifest.json', 'utf8'));
    expect(Object.keys(DAWN_MERCHANT_ITEM_TEXTURES).sort()).toEqual(['armor', 'boots', 'gloves', 'helmet']);
    for (const [slot, key] of Object.entries(DAWN_MERCHANT_ITEM_TEXTURES)) {
      expect(key).toBe(`dawn-ui-item-${slot}`);
      for (const size of [64, 128]) {
        const texture = dawnMerchantArtTexture(key, size);
        const asset = DAWN_UI_ASSETS.find(asset => asset.key === texture);
        const source = manifest.assets[`item-${slot}`].exports.find((entry: { width: number }) => entry.width === size);
        expect(asset?.path).toBe(source.file);
        expect(existsSync(`public/assets/ui/dawn/${asset?.path}`)).toBe(true);
      }
    }
  });

  it('uses distinct 32px woodcuts for the six subcategories and preserves the kit exceptions', () => {
    const manifest = JSON.parse(readFileSync('public/assets/ui/dawn/runtime/manifest.json', 'utf8'));
    for (const id of ['base', 'drones', 'branches', 'boss-points', 'round-offers', 'crafting']) {
      const key = DAWN_MERCHANT.categories.find(category => category.id === id)?.iconKey;
      expect(key).toBe(`dawn-ui-dealer-sub-${id}`);
      const asset = DAWN_UI_ASSETS.find(asset => asset.key === key);
      expect(asset?.path).toBe(manifest.assets[`dealer-sub-${id}`].exports.find((entry: { width: number }) => entry.width === 32).file);
      expect(existsSync(`public/assets/ui/dawn/${asset?.path}`)).toBe(true);
    }
    for (const id of ['sensors', 'supply']) {
      expect(DAWN_MERCHANT.categories.find(category => category.id === id)?.iconKey).toBe(`dawn-merchant/category-${id}`);
    }
    for (const id of ['expansion', 'infrastructure', 'upgrades', 'equipment']) {
      expect(DAWN_MERCHANT.categories.find(category => category.id === id)?.iconKey).toBe(`dawn-ui-dealer-${id}`);
    }
  });

  it('uses the exported 1x files and slice insets without a second authored definition', () => {
    const manifest = JSON.parse(readFileSync('public/assets/ui/dawn-merchant/runtime/manifest.json', 'utf8'));
    expect(Object.keys(DAWN_MERCHANT_UI)).toEqual(Object.keys(manifest.assets));
    for (const [id, runtime] of Object.entries(DAWN_MERCHANT_UI)) {
      const asset = manifest.assets[id], source = asset.exports.find((entry: { scale: number }) => entry.scale === 1);
      expect(runtime).toEqual({ key: asset.key, file: source.file, insets: source.insets });
      expect(existsSync(`public/assets/ui/dawn-merchant/runtime/${runtime.file}`)).toBe(true);
      if (runtime.insets) {
        expect(runtime.insets.left + runtime.insets.right).toBeLessThan(source.width);
        expect(runtime.insets.top + runtime.insets.bottom).toBeLessThan(source.height);
      }
    }
    const keys = new Set<string>([...DAWN_UI_ASSETS.map(asset => asset.key), ...Object.values(DAWN_MERCHANT_UI).map(asset => asset.key)]);
    for (const category of DAWN_MERCHANT.categories) expect(keys.has(category.iconKey)).toBe(true);
  });
});
