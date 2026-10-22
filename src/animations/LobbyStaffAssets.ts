import type * as Phaser from 'phaser';
import { PIPELINE_ASSETS, pipelineAnimationKey } from '../config/pipelineAssets';
import type { PipelineNormalAsset } from '../config/pipelineAssetContracts';
import type { LobbyMenu } from '../config/authoring/lobbyBuildings';
import type { LobbyStaffClip } from '../arena/lobbyStructures/LobbyStaffModel';

/** One staff member per structure, dressed for its trade. */
export const LOBBY_STAFF_ASSET_IDS: Readonly<Record<LobbyMenu, string>> = {
  upgrades: 'lobby-staff-smith',
  base: 'lobby-staff-foreman',
  items: 'lobby-staff-quartermaster',
  merchant: 'lobby-staff-dealer',
};

export function lobbyStaffAsset(menu: LobbyMenu): PipelineNormalAsset | null {
  return PIPELINE_ASSETS.find(asset => asset.id === LOBBY_STAFF_ASSET_IDS[menu]) ?? null;
}

/** Separate from walking sheets: staff never walk, they work, look up and greet. */
export function preloadLobbyStaffAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const id of new Set(Object.values(LOBBY_STAFF_ASSET_IDS))) {
    const asset = PIPELINE_ASSETS.find(candidate => candidate.id === id);
    if (!asset) continue;
    const { layout } = asset;
    loader.spritesheet(asset.sheetTextureKey, asset.sheetPath, {
      frameWidth: layout.frameWidth, frameHeight: layout.frameHeight,
      margin: layout.margin, spacing: layout.spacing, endFrame: layout.frameCount - 1,
    });
  }
}

/**
 * Registers the idle, work and greet clips once (the AnimationManager is global) and returns their
 * keys; called only after the sheet exists. Greet plays once, the loops repeat.
 */
export function registerLobbyStaffClips(anims: Phaser.Animations.AnimationManager,
  asset: PipelineNormalAsset): Partial<Record<LobbyStaffClip, string>> {
  const keys: Partial<Record<LobbyStaffClip, string>> = {};
  for (const name of ['idle', 'work', 'greet'] as const) {
    const clip = asset.clips.find(candidate => candidate.name === name);
    if (!clip) continue;
    const key = pipelineAnimationKey(asset, clip);
    if (!anims.exists(key)) {
      anims.create({ key, frames: anims.generateFrameNumbers(asset.sheetTextureKey, { frames: [...clip.frames] }),
        frameRate: clip.frameRate, repeat: clip.loop ? -1 : 0 });
    }
    keys[name] = key;
  }
  return keys;
}

/** Frame index (0-based within the clip) of each marker of the work clip. */
export function lobbyStaffWorkMarkers(asset: PipelineNormalAsset): Readonly<Record<string, number>> {
  return asset.clips.find(clip => clip.name === 'work')?.markers ?? {};
}
