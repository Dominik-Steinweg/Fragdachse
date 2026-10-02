import type * as Phaser from 'phaser';
import { WoodlandImageFile } from './WoodlandAssets';
import { CHARACTER_SHADOW_FILES } from './CharacterShadowAssetManifest';
import { CHARACTER_SHADOW_MASKS_ENABLED } from '../effects/ShadowConfig';

export function preloadCharacterShadowAssets(scene: Phaser.Scene): void {
  if (!CHARACTER_SHADOW_MASKS_ENABLED) return;
  for (const asset of CHARACTER_SHADOW_FILES) {
    if (!scene.textures.exists(asset.key)) scene.load.addFile(new WoodlandImageFile(scene.load, asset));
  }
}

export function assertCharacterShadowAssetsReady(scene: Phaser.Scene): void {
  if (!CHARACTER_SHADOW_MASKS_ENABLED) return;
  for (const asset of CHARACTER_SHADOW_FILES) {
    if (!scene.textures.exists(asset.key)) throw new Error('Figurenschatten konnte nicht geladen werden: ' + asset.url);
  }
}
