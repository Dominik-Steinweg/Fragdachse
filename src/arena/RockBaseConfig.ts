import type * as Phaser from 'phaser';

/**
 * Authored rock base: one continuous stone material cut to the 47-Blob silhouettes.
 *
 * Every autotile frame exists in ROCK_BASE_PHASE_CELLS x ROCK_BASE_PHASE_CELLS material phases.
 * A cell draws the phase of its grid position, so neighbouring cells show adjacent parts of one
 * seamless material instead of the same 32 px stamp. Silhouette, edge rounding and edge light
 * are baked per frame; collision stays on the unchanged cell grid.
 *
 * Exported by scripts/generate-rock-base.mjs, which imports these constants directly. Keep this
 * module free of value imports so plain Node can load it.
 */
export const ROCK_BASE_TEXTURE_KEY = 'rock_base';
/** Equals CELL_SIZE; guarded by tests. */
export const ROCK_BASE_FRAME_SIZE = 32;
/** Material period in cells on both axes (8 cells = 256 world px = 8 m). */
export const ROCK_BASE_PHASE_CELLS = 8;
export const ROCK_BASE_PHASES = ROCK_BASE_PHASE_CELLS * ROCK_BASE_PHASE_CELLS;
/** Frame slots of the 47-Blob sheet, including its unused slots. */
export const ROCK_BASE_AUTOTILE_SLOTS = 55;
/** Extruded border around each frame, so linear filtering never samples a neighbour frame. */
export const ROCK_BASE_FRAME_MARGIN = 1;
export const ROCK_BASE_FRAME_SPACING = ROCK_BASE_FRAME_MARGIN * 2;

/** Atlas row = autotile frame, column = material phase. */
export function getRockBaseFrame(autotileFrame: number, gridX: number, gridY: number): number {
  const n = ROCK_BASE_PHASE_CELLS;
  const phaseX = ((gridX % n) + n) % n, phaseY = ((gridY % n) + n) % n;
  return autotileFrame * ROCK_BASE_PHASES + phaseY * n + phaseX;
}

export function preloadRockBase(load: Phaser.Loader.LoaderPlugin): void {
  // New material atlas revision: bypass partial downloads cached under the old URL.
  load.spritesheet(ROCK_BASE_TEXTURE_KEY, './assets/sprites/rock_base.png?v=material-phases-1', {
    frameWidth: ROCK_BASE_FRAME_SIZE,
    frameHeight: ROCK_BASE_FRAME_SIZE,
    margin: ROCK_BASE_FRAME_MARGIN,
    spacing: ROCK_BASE_FRAME_SPACING,
  });
}
