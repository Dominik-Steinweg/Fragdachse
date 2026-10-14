import type * as Phaser from 'phaser';
import manifest from './manifests/dawn-merchant-ui.json';
import { runtimeAssetUrl } from './RuntimeAssetUrls';

export const DAWN_MERCHANT_UI = manifest;
export type DawnMerchantUiPart = keyof typeof DAWN_MERCHANT_UI;
const LARGE_ART = ['dealer-expansion', 'dealer-infrastructure', 'dealer-upgrades', 'dealer-equipment',
  'scrap-magnet', 'scrap-scanner', 'recalibration-core'];

export function dawnMerchantArtTexture(key: string, size: number): string {
  return size > 64 && LARGE_ART.some(id => key === `dawn-ui-${id}`) ? `${key}-merchant` : key;
}

export function preloadDawnMerchantUiAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const asset of Object.values(DAWN_MERCHANT_UI)) {
    loader.image(asset.key, runtimeAssetUrl(`./assets/ui/dawn-merchant/runtime/${asset.file}`));
  }
  for (const id of LARGE_ART) loader.image(`dawn-ui-${id}-merchant`, runtimeAssetUrl(`./assets/ui/dawn/runtime/${id}-128.webp`));
}

/** Manifest insets and the registered 1x source use the same design pixels. */
export function addDawnMerchantSlice(scene: Phaser.Scene, parent: Phaser.GameObjects.Container,
  part: DawnMerchantUiPart, x: number, y: number, width: number, height: number): Phaser.GameObjects.NineSlice {
  const asset = DAWN_MERCHANT_UI[part];
  if (!asset.insets) throw new Error(`Merchant UI part ${part} is not sliceable`);
  const { left, right, top, bottom } = asset.insets;
  const slice = scene.add.nineslice(x, y, asset.key, undefined, width, height, left, right, top, bottom).setOrigin(0);
  parent.add(slice);
  return slice;
}
