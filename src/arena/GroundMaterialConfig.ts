import type * as Phaser from 'phaser';

/** Native world-pixel materials, shared by presentation, snapshots and manual labs. */
export const GRASS_MATERIAL_KEY = 'gras_bg_tile';
export const DIRT_MATERIAL_KEY = 'dirt_material';
/** Drier, lighter second soil mixed into soil areas by DirtSurfaceField. */
export const DIRT_MATERIAL_ALT_KEY = 'dirt_material_alt';
/** Riverbank soil: rooted humus on the bank, fine wet silt at the waterline (DirtSurfaceField). */
export const BANK_MATERIAL_KEY = 'bank_material';
export const BANK_MATERIAL_WET_KEY = 'bank_material_wet';
/** Persistent-Base gravel: grey crushed gravel, mixed with a sandier gravel (DirtSurfaceField). */
export const GRAVEL_MATERIAL_KEY = 'gravel_material';
export const GRAVEL_MATERIAL_ALT_KEY = 'gravel_material_alt';
/** Low-frequency Multiply map over grass, soil and tufts (scripts/generate-ground-macro.mjs). */
export const GROUND_MACRO_KEY = 'ground_macro';
/** Stretch of the macro map. 512 x 5.5 = 2816 px shares no small multiple with the 1024 px
 * materials, so their combination does not visibly repeat inside a World. */
export const GROUND_MACRO_TILE_SCALE = 5.5;

export function preloadGroundMaterials(load: Phaser.Loader.LoaderPlugin): void {
  load.image(GRASS_MATERIAL_KEY, './assets/sprites/gras_bg_tile.png');
  load.image(DIRT_MATERIAL_KEY, './assets/sprites/dirt_material.png');
  load.image(DIRT_MATERIAL_ALT_KEY, './assets/sprites/dirt_material_alt.png');
  load.image(BANK_MATERIAL_KEY, './assets/sprites/bank_material.png');
  load.image(BANK_MATERIAL_WET_KEY, './assets/sprites/bank_material_wet.png');
  load.image(GRAVEL_MATERIAL_KEY, './assets/sprites/gravel_material.png');
  load.image(GRAVEL_MATERIAL_ALT_KEY, './assets/sprites/gravel_material_alt.png');
  load.image(GROUND_MACRO_KEY, './assets/sprites/ground_macro.png');
}

/** Positive texture phase also works in the sampling gutter outside a World. */
export function groundMaterialPhase(position: number, period: number): number {
  return ((position % period) + period) % period;
}
