import type * as Phaser from 'phaser';

export const TRACK_GRAVEL_TEXTURE_KEYS = [
  'track_gravel_01', 'track_gravel_02', 'track_gravel_03', 'track_gravel_04',
] as const;

export const TRACK_GRAVEL_CONFIG = {
  // Visible sleeper footprint in the unchanged 64x32 BahnstreckeSchienen.png.
  sleeperLeftPx: 6,
  sleeperRightPx: 58,
  minOverhangPx: 1,
  maxOverhangPx: 8,
  fringeWidthPx: 2.5,
  minBrightness: 0.54,
  maxBrightness: 0.88,
  minStampSizePx: 64,
  maxStampSizePx: 96,
  stampStepPx: 24,
} as const;

export function preloadTrackGravelAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const key of TRACK_GRAVEL_TEXTURE_KEYS) {
    loader.image(key, `./assets/sprites/tracks/${key}.png`);
  }
}
