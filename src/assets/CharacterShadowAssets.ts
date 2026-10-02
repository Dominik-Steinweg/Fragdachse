import type * as Phaser from 'phaser';
import { WoodlandImageFile } from './WoodlandAssets';
import { CHARACTER_SHADOW_FILES } from './CharacterShadowAssetManifest';

export function preloadCharacterShadowAssets(scene: Phaser.Scene): void {
  for (const asset of CHARACTER_SHADOW_FILES) {
    if (!scene.textures.exists(asset.key)) scene.load.addFile(new WoodlandImageFile(scene.load, asset));
  }
}

export function assertCharacterShadowAssetsReady(scene: Phaser.Scene): void {
  for (const asset of CHARACTER_SHADOW_FILES) {
    if (!scene.textures.exists(asset.key)) throw new Error('Figurenschatten konnte nicht geladen werden: ' + asset.url);
  }
}
