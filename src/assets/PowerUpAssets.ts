import type * as Phaser from 'phaser';
import manifest from './manifests/powerups-powerups-r02.json';
import { runtimeAssetUrl } from './RuntimeAssetUrls';

export const POWERUP_BASE_KEY = 'powerup_layer_base';
const symbols = new Map(manifest.symbols.map(asset => [asset.spriteKey, `${asset.spriteKey}_symbol`]));

export function powerUpSymbolKey(compositeKey: string): string | undefined {
  return symbols.get(compositeKey);
}

/** Colour layers use the normal PMA image path, not the data-atlas loader. */
export const POWERUP_ASSETS = [
  { key: POWERUP_BASE_KEY, file: manifest.base.file },
  ...manifest.symbols.flatMap(asset => [
    { key: asset.spriteKey, file: asset.composite.file },
    { key: symbols.get(asset.spriteKey)!, file: asset.image.file },
  ]),
];

export function preloadPowerUpAssets(scene: Phaser.Scene): void {
  for (const asset of POWERUP_ASSETS) {
    if (!scene.textures.exists(asset.key)) scene.load.image(asset.key, runtimeAssetUrl(asset.file));
  }
}

export function assertPowerUpAssetsReady(scene: Phaser.Scene): void {
  for (const asset of POWERUP_ASSETS) {
    if (!scene.textures.exists(asset.key)) throw new Error(`Power-Up konnte nicht geladen werden: ${asset.file}`);
  }
}
