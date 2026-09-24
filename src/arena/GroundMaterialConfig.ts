import type * as Phaser from 'phaser';

/** Native world-pixel materials, shared by presentation, snapshots and manual labs. */
export const GRASS_MATERIAL_KEY = 'gras_bg_tile';
export const DIRT_MATERIAL_KEY = 'dirt_material';
/** Low-frequency Multiply map over grass, soil and tufts (scripts/generate-ground-macro.mjs). */
export const GROUND_MACRO_KEY = 'ground_macro';
/** Stretch of the macro map. 512 x 5.5 = 2816 px shares no small multiple with the 1024 px
 * materials, so their combination does not visibly repeat inside a World. */
export const GROUND_MACRO_TILE_SCALE = 5.5;

export function preloadGroundMaterials(load: Phaser.Loader.LoaderPlugin): void {
  load.image(GRASS_MATERIAL_KEY, './assets/sprites/gras_bg_tile.png');
  load.image(DIRT_MATERIAL_KEY, './assets/sprites/dirt_material.png');
  load.image(GROUND_MACRO_KEY, './assets/sprites/ground_macro.png');
}

/** Positive texture phase also works in the sampling gutter outside a World. */
export function groundMaterialPhase(position: number, period: number): number {
  return ((position % period) + period) % period;
}
