import type * as Phaser from 'phaser';

const CANOPY_ASSET_PATH = './assets/sprites/canopies';

export const CANOPY_VARIANTS = [
  { textureKey: 'bg_canopy_01', fileName: 'canopy01.png' },
  { textureKey: 'bg_canopy_02', fileName: 'canopy02.png' },
  { textureKey: 'bg_canopy_03', fileName: 'canopy03.png' },
  { textureKey: 'bg_canopy_04', fileName: 'canopy04.png' },
] as const;

export const CANOPY_TEXTURE_KEYS = CANOPY_VARIANTS.map(({ textureKey }) => textureKey);

export function preloadCanopyAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const { textureKey, fileName } of CANOPY_VARIANTS) {
    loader.image(textureKey, `${CANOPY_ASSET_PATH}/${fileName}`);
  }
}
