import type * as Phaser from 'phaser';
import { getPipelineAsset, pipelineAnimationKey } from '../config/pipelineAssets';
import { LOBBY_BUILDINGS } from '../config/authoring/lobbyBuildings';
import { LOBBY_MERCHANT } from '../config/authoring/lobbyMerchant';

export const LOBBY_DEALER_ASSET = getPipelineAsset(LOBBY_MERCHANT.dealer.textureKey);

/** Separate from walking sheets: this character deliberately has no locomotion clip. */
export function preloadLobbyMerchantAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const building of LOBBY_BUILDINGS) {
    const asset = getPipelineAsset(building.textureKey);
    loader.image(asset.textureKey, asset.idlePath);
  }
  const { layout } = LOBBY_DEALER_ASSET;
  loader.spritesheet(LOBBY_DEALER_ASSET.sheetTextureKey, LOBBY_DEALER_ASSET.sheetPath, {
    frameWidth: layout.frameWidth, frameHeight: layout.frameHeight,
    margin: layout.margin, spacing: layout.spacing, endFrame: layout.frameCount - 1,
  });
}

/** Called only after the sheet exists; global animation registration survives World resets. */
export function registerLobbyDealerIdle(anims: Phaser.Animations.AnimationManager): string | null {
  const clip = LOBBY_DEALER_ASSET.clips.find(candidate => candidate.name === 'idle');
  if (!clip) return null;
  const key = pipelineAnimationKey(LOBBY_DEALER_ASSET, clip);
  if (!anims.exists(key)) {
    anims.create({ key,
      frames: anims.generateFrameNumbers(LOBBY_DEALER_ASSET.sheetTextureKey, { frames: [...clip.frames] }),
      frameRate: clip.frameRate, repeat: -1,
    });
  }
  return key;
}
