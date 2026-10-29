import type * as Phaser from 'phaser';

/** Compact runtime copies used by the procedural train bake. */
export const TRAIN_MATERIAL_ASSETS = {
  light: 'train_material_light_top',
  red: 'train_material_red_top',
  dark: 'train_material_dark_top',
  scratches: 'train_overlay_scratches',
  grime: 'train_overlay_grime',
} as const;

/** Queues the compact runtime copies used by the procedural train bake. */
export function preloadTrainMaterialAssets(loader: Pick<Phaser.Loader.LoaderPlugin, 'image'>): void {
  for (const textureKey of Object.values(TRAIN_MATERIAL_ASSETS)) {
    loader.image(textureKey, `./assets/sprites/train/${textureKey}.png`);
  }
}
