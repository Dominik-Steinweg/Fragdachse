import type * as Phaser from 'phaser';
import { runtimeAssetUrl } from './RuntimeAssetUrls';
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
  { key: DAWN_UI_TEXTURES.scrapMagnet, file: 'scrap-magnet-64.webp' },
  { key: DAWN_UI_TEXTURES.dealerPortrait, file: 'dealer-portrait-256.webp' },
  // Contracted keys (DAWN_M3_ASSET_KEYS): elite head glyphs (22 px) and the phase-card modifier icon (18 px).
  ...DAWN_ELITE_AFFIX_IDS.map(affix => ({ key: DAWN_M3_ASSET_KEYS.eliteAffixIcon(affix), file: `elite-${affix}-32.webp` })),
  ...DAWN_NIGHT_MODIFIER_IDS.map(id => ({ key: DAWN_M3_ASSET_KEYS.nightModifierIcon(id), file: `night-${id}-32.webp` })),
] as const;

/** Both UI preload paths can call this: Phaser deduplicates cached and queued keys. */
export function preloadDawnUiAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const asset of DAWN_UI_ASSETS) {
    loader.image(asset.key, runtimeAssetUrl(`./assets/ui/dawn/runtime/${asset.file}`));
  }
}
