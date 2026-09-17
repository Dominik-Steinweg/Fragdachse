import type * as Phaser from 'phaser';
import exports from './lobbyForestExports.json';

/** Generated runtime files; sourceWidth/sourceHeight retain the authored trim's coordinate system. */
export const FOREST_ASSETS = {
  frame: { key: 'lobby_forest_frame', ...exports.frame },
  wood: { key: 'lobby_forest_wood', ...exports.wood },
  buttonFrame: { key: 'lobby_forest_button_frame', ...exports.buttonFrame, corner: 128 },
  leaves: { key: 'lobby_forest_leaves', ...exports.leaves },
  medallion: { key: 'lobby_forest_medallion', ...exports.medallion },
  relief: { key: 'lobby_forest_relief', ...exports.relief },
  ready: { key: 'lobby_forest_ready', ...exports.ready },
  world: { key: 'lobby_forest_world', ...exports.world },
} as const;

export function preloadForestAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const asset of Object.values(FOREST_ASSETS)) loader.image(asset.key, './assets/ui/lobby-forest/' + asset.file);
}
