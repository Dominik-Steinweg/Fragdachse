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
  shot_p90: './assets/sounds/p90.wav',
  shot_flame: './assets/sounds/flame.wav',
  shot_rocketlauncher: './assets/sounds/rocketlauncher.wav',  
  shot_minirocketlauncher: './assets/sounds/minirocketlauncher.wav',  
  shot_spore: './assets/sounds/spore.wav',    
  shot_negev: './assets/sounds/negev.wav',      
  shot_throw: './assets/sounds/throw.wav',     
  shot_bfg: './assets/sounds/bfg.wav',       
  shot_hallelujah: './assets/sounds/hallelujah.wav',       
} as const;

export type ShotAudioAssetKey = keyof typeof SHOT_AUDIO_ASSETS;

export function preloadShotAudio(loader: Phaser.Loader.LoaderPlugin): void {
  for (const [key, assetPath] of Object.entries(SHOT_AUDIO_ASSETS)) {
    loader.audio(key, assetPath);
  }
}
