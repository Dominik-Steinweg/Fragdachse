import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DAWN_MERCHANT_UI } from '../../src/assets/DawnMerchantUiAssets';
import { DAWN_UI_ASSETS } from '../../src/assets/DawnUiAssets';
import { DAWN_MERCHANT } from '../../src/config/dawn/merchant';

describe('Dawn merchant UI publication', () => {
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
