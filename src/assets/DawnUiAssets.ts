import type * as Phaser from 'phaser';
import { runtimeAssetUrl } from './RuntimeAssetUrls';
import { preloadDawnMerchantUiAssets } from './DawnMerchantUiAssets';
import { DAWN_ELITE_AFFIX_IDS, DAWN_M3_ASSET_KEYS, DAWN_NIGHT_MODIFIER_IDS } from '../dawn/contracts/DawnContentIds';

/** Small counters use 32 px sources; category art stays legible at 48–64 px. */
export const DAWN_UI_TEXTURES = {
  scrap: 'dawn-ui-scrap',
  threat: 'dawn-ui-threat',
  dealerExpansion: 'dawn-ui-dealer-expansion',
  dealerInfrastructure: 'dawn-ui-dealer-infrastructure',
  dealerUpgrades: 'dawn-ui-dealer-upgrades',
  dealerEquipment: 'dawn-ui-dealer-equipment',
  recalibrationCore: 'dawn-ui-recalibration-core',
  scrapMagnet: 'dawn-ui-scrap-magnet',
  scrapScanner: 'dawn-ui-scrap-scanner',
  dealerPortrait: 'dawn-ui-dealer-portrait',
} as const;

/** Paths relative to `assets/ui/dawn/`: icons under `runtime/`, woodcut art (dealer portrait) under `art/runtime/`. */
export const DAWN_UI_ASSETS = [
  { key: DAWN_UI_TEXTURES.scrap, path: 'runtime/scrap-32.webp' },
  { key: DAWN_UI_TEXTURES.threat, path: 'runtime/threat-32.webp' },
  { key: DAWN_UI_TEXTURES.dealerExpansion, path: 'runtime/dealer-expansion-64.webp' },
  { key: DAWN_UI_TEXTURES.dealerInfrastructure, path: 'runtime/dealer-infrastructure-64.webp' },
  { key: DAWN_UI_TEXTURES.dealerUpgrades, path: 'runtime/dealer-upgrades-64.webp' },
  { key: DAWN_UI_TEXTURES.dealerEquipment, path: 'runtime/dealer-equipment-64.webp' },
  { key: DAWN_UI_TEXTURES.recalibrationCore, path: 'runtime/recalibration-core-64.webp' },
  { key: DAWN_UI_TEXTURES.scrapMagnet, path: 'runtime/scrap-magnet-64.webp' },
  { key: DAWN_UI_TEXTURES.scrapScanner, path: 'runtime/scrap-scanner-64.webp' },
  { key: DAWN_UI_TEXTURES.dealerPortrait, path: 'art/runtime/dealer-portrait-256.webp' },
  // Contracted keys (DAWN_M3_ASSET_KEYS): elite head glyphs (22 px) and the phase-card modifier icon (18 px).
  ...DAWN_ELITE_AFFIX_IDS.map(affix => ({ key: DAWN_M3_ASSET_KEYS.eliteAffixIcon(affix), path: `runtime/elite-${affix}-32.webp` })),
  ...DAWN_NIGHT_MODIFIER_IDS.map(id => ({ key: DAWN_M3_ASSET_KEYS.nightModifierIcon(id), path: `runtime/night-${id}-32.webp` })),
] as const;

/** Both UI preload paths can call this: Phaser deduplicates cached and queued keys. */
export function preloadDawnUiAssets(loader: Phaser.Loader.LoaderPlugin): void {
  preloadDawnMerchantUiAssets(loader);
  for (const asset of DAWN_UI_ASSETS) {
    loader.image(asset.key, runtimeAssetUrl(`./assets/ui/dawn/${asset.path}`));
  }
}
