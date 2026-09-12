import type * as Phaser from 'phaser';

export const FOREST_ASSETS = {
  frame: { key: 'lobby_forest_frame', file: 'frame.png' },
  wood: { key: 'lobby_forest_wood', file: 'wood.png' },
  leaves: { key: 'lobby_forest_leaves', file: 'leaves.png' },
  medallion: { key: 'lobby_forest_medallion', file: 'medallion.png' },
  relief: { key: 'lobby_forest_relief', file: 'relief.png', crop: { x: 18, y: 189, width: 1504, height: 656 } },
  ready: { key: 'lobby_forest_ready', file: 'ready.png', crop: { x: 21, y: 217, width: 2129, height: 288 } },
  world: { key: 'lobby_forest_world', file: 'world.png', crop: { x: 24, y: 72, width: 2015, height: 569 } },
} as const;

export function preloadForestAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const asset of Object.values(FOREST_ASSETS)) loader.image(asset.key, './assets/ui/lobby-forest/' + asset.file);
}
