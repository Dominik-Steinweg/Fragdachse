import * as Phaser from 'phaser';
import { getPipelineAsset } from '../../config/pipelineAssets';

export const BOMBER_DRONE_BODY_ASSET_ID = 'bomber-drone-body';
export const BOMBER_DRONE_BOMB_ASSET_ID = 'bomber-drone-bomb';

export function preloadBomberSquadronAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const id of [BOMBER_DRONE_BODY_ASSET_ID, BOMBER_DRONE_BOMB_ASSET_ID]) {
    const asset = getPipelineAsset(id);
    loader.image(asset.textureKey, asset.idlePath);
    if (asset.clips.length) loader.spritesheet(asset.sheetTextureKey, asset.sheetPath, asset.layout);
  }
}
