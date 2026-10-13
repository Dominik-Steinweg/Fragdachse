import type * as Phaser from 'phaser';
import { runtimeAssetUrl } from './RuntimeAssetUrls';

/** Small counters use 32 px sources; category art stays legible at 48–64 px. */
export const DAWN_UI_TEXTURES = {
  scrap: 'dawn-ui-scrap',
  threat: 'dawn-ui-threat',
  dealerExpansion: 'dawn-ui-dealer-expansion',
  dealerInfrastructure: 'dawn-ui-dealer-infrastructure',
  dealerUpgrades: 'dawn-ui-dealer-upgrades',
  dealerEquipment: 'dawn-ui-dealer-equipment',
  recalibrationCore: 'dawn-ui-recalibration-core',
  dealerPortrait: 'dawn-ui-dealer-portrait',
} as const;

export const DAWN_UI_ASSETS = [
  { key: DAWN_UI_TEXTURES.scrap, file: 'scrap-32.webp' },
  { key: DAWN_UI_TEXTURES.threat, file: 'threat-32.webp' },
  { key: DAWN_UI_TEXTURES.dealerExpansion, file: 'dealer-expansion-64.webp' },
  { key: DAWN_UI_TEXTURES.dealerInfrastructure, file: 'dealer-infrastructure-64.webp' },
  { key: DAWN_UI_TEXTURES.dealerUpgrades, file: 'dealer-upgrades-64.webp' },
  { key: DAWN_UI_TEXTURES.dealerEquipment, file: 'dealer-equipment-64.webp' },
  { key: DAWN_UI_TEXTURES.recalibrationCore, file: 'recalibration-core-64.webp' },
  { key: DAWN_UI_TEXTURES.dealerPortrait, file: 'dealer-portrait-256.webp' },
] as const;

/** Both UI preload paths can call this: Phaser deduplicates cached and queued keys. */
export function preloadDawnUiAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const asset of DAWN_UI_ASSETS) {
    loader.image(asset.key, runtimeAssetUrl(`./assets/ui/dawn/runtime/${asset.file}`));
  }
}
