import type Phaser from 'phaser';

export const SHOT_AUDIO_ASSETS = {
  shot_ak47: './assets/sounds/ak-47.wav',
  shot_asmd_primary: './assets/sounds/asmd-prim.wav',
  shot_asmd_secondary: './assets/sounds/asmd-sec.wav',
  shot_crossbow: './assets/sounds/crossbow.flac',
  shot_dry_trigger: './assets/sounds/dry-trigger.wav',
  shot_gauss: './assets/sounds/Gauss.wav',
  shot_glock: './assets/sounds/glock.wav',
  shot_plasma: './assets/sounds/plasma.wav',
  shot_shotgun: './assets/sounds/shotgun.wav',
  shot_bite: './assets/sounds/bite.wav',
  shot_zeus: './assets/sounds/zeus.wav',
  shot_hydra: './assets/sounds/hydra.wav',
  shot_awp: './assets/sounds/awp.wav',
} as const;

export type ShotAudioAssetKey = keyof typeof SHOT_AUDIO_ASSETS;

export function preloadShotAudio(loader: Phaser.Loader.LoaderPlugin): void {
  for (const [key, assetPath] of Object.entries(SHOT_AUDIO_ASSETS)) {
    loader.audio(key, assetPath);
  }
}
