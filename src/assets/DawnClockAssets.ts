import type * as Phaser from 'phaser';
import { GAME_WIDTH } from '../config';
import { runtimeAssetUrl } from './RuntimeAssetUrls';

export const DAWN_CLOCK_PARTS = ['face', 'frame', 'arc-grain', 'hand', 'tip-sun', 'tip-moon',
  'icon-sun', 'icon-moon', 'icon-sunrise', 'notch-wave', 'notch-final', 'medallion'] as const;
export type DawnClockPart = typeof DAWN_CLOCK_PARTS[number];
export const dawnClockTexture = (part: DawnClockPart) => `dawn-clock-${part}`;

export function preloadDawnClockAssets(loader: Phaser.Loader.LoaderPlugin): void {
  // RenderResolution derives renderScale from this same backing-store width / GAME_WIDTH.
  // Keep the asset catalog free of Phaser value imports (also consumed by pure UI models).
  const scale = loader.scene.scale.width > GAME_WIDTH ? 2 : 1;
  for (const part of DAWN_CLOCK_PARTS) {
    loader.image(dawnClockTexture(part), runtimeAssetUrl(`./assets/ui/dawn-clock/runtime/${part}-${scale}x.webp`));
  }
}
