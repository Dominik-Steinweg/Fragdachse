import type * as Phaser from 'phaser';

export const BASE_GROUNDING_ASSET_PATH = './assets/sprites/base-grounding';
export const BASE_GROUNDING_ASSETS = [
  'edge-a', 'edge-b', 'edge-c', 'corner-a', 'corner-b', 'scatter',
] as const;
export type BaseGroundingAsset = typeof BASE_GROUNDING_ASSETS[number];

export function baseGroundingTextureKey(asset: BaseGroundingAsset): string {
  return `base-grounding-${asset}`;
}

export function preloadBaseGroundingAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const asset of BASE_GROUNDING_ASSETS) {
    loader.image(baseGroundingTextureKey(asset), `${BASE_GROUNDING_ASSET_PATH}/${asset}.png`);
  }
}
