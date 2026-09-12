import type * as Phaser from 'phaser';

export const FOREST_ASSETS = {
  frame: { key: 'lobby_forest_frame', file: 'frame.png' },
  wood: { key: 'lobby_forest_wood', file: 'wood.png' },
  leaves: { key: 'lobby_forest_leaves', file: 'leaves.png' },
  medallion: { key: 'lobby_forest_medallion', file: 'medallion.png' },
  relief: { key: 'lobby_forest_relief', file: 'relief.png' },
} as const;

export function preloadForestAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const asset of Object.values(FOREST_ASSETS)) loader.image(asset.key, './assets/ui/lobby-forest/' + asset.file);
}
