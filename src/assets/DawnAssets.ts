import type * as Phaser from 'phaser';
import { getPipelineAsset } from '../config/pipelineAssets';
import { runtimeAssetUrl } from './RuntimeAssetUrls';
import { DAWN_M3_ASSET_KEYS, DAWN_WRECK_VARIANTS } from '../dawn/contracts/DawnContentIds';

export const DAWN_WRECK_KEYS: Readonly<Record<number, string>> = {
  1: DAWN_M3_ASSET_KEYS.wreckVariant('drone', 1),
  2: DAWN_M3_ASSET_KEYS.wreckVariant('drone', 2),
  3: DAWN_M3_ASSET_KEYS.wreckVariant('drone', 3),
};
export const DAWN_EXTRACTOR_KEY = 'construction_dawn_extractor';
export const DAWN_EXTRACTOR_SHEET_KEY = 'construction_dawn_extractor_sheet';
export const DAWN_EXTRACTOR_ACTIVE_ANIMATION = 'construction_dawn_extractor_sheet_active';
export const DAWN_EXTRACTOR_IDLE_ANIMATION = 'construction_dawn_extractor_sheet_idle';
export const DAWN_SCRAP_KEYS: Readonly<Record<number, string>> = {
  1: 'dawn_scrap_t1',
  2: 'dawn_scrap_t2',
  3: 'dawn_scrap_t3',
};
export const DAWN_BROOD_NEST_KEY = DAWN_M3_ASSET_KEYS.broodNest;
export const DAWN_BROOD_NEST_ANIMATION = 'construction_dawn_broodnest_sheet_idle';
export const DAWN_SITE_DISPLAY_SIZE = 96;
/** Scrap heaps and scavenger camps stand on 2x2 cells. */
export const DAWN_HEAP_DISPLAY_SIZE = 68;
export const DAWN_SUPPLY_CRATE_DISPLAY_SIZE = 28;
export const DAWN_SCRAP_DISPLAY_SIZE = 24;

/** Uses the existing construction pipeline's sheet loading and clip registration. */
export const DAWN_PIPELINE_ASSETS = [
  ...DAWN_WRECK_VARIANTS.flatMap(variant => [1, 2, 3].map(tier => DAWN_M3_ASSET_KEYS.wreckVariant(variant, tier))),
  DAWN_EXTRACTOR_KEY, ...Object.values(DAWN_SCRAP_KEYS),
  DAWN_M3_ASSET_KEYS.broodNest, DAWN_M3_ASSET_KEYS.supplyCapsule, DAWN_M3_ASSET_KEYS.supplyCrate,
  DAWN_M3_ASSET_KEYS.supplyCrateCarried,
  ...[1, 2, 3].map(DAWN_M3_ASSET_KEYS.scrapHeap), ...[1, 2, 3].map(DAWN_M3_ASSET_KEYS.scavengerCamp),
  // Shared with the bridge kit catalog; its runtime texture key is DAWN_M3_ASSET_KEYS.demolitionCache.
  'demolition-cache',
].map(getPipelineAsset);

/** Ground decals under the site props (Art Direction V1, lossless 512 px runtime exports). */
export const DAWN_DECAL_NAMES = [
  'scorch-01', 'scorch-03', 'oil-stain-02', 'debris-scatter-02', 'debris-scatter-03', 'skid-gouge-02',
  'drill-disturbance-03', 'organic-stain-01', 'rust-flakes-01', 'drag-marks-01',
] as const;
export type DawnDecalName = typeof DAWN_DECAL_NAMES[number];
export const dawnDecalTextureKey = (name: DawnDecalName): string => `dawn-decal-${name}`;
export function preloadDawnDecalAssets(loader: Pick<Phaser.Loader.LoaderPlugin, 'image'>): void {
  for (const name of DAWN_DECAL_NAMES) {
    loader.image(dawnDecalTextureKey(name), runtimeAssetUrl(`./assets/sprites/dawn-decals/runtime/${name}-512.webp`));
  }
}

/** Stealth bomber silhouette of the bomber night (D-47); the other `dawn-night` art stays unloaded. */
export const DAWN_BOMBER_SHADOW_TEXTURE = 'dawn-night-bomber-shadow-256x128';
/** Night modifier art (keys equal file stems, `public/assets/sprites/dawn-night/manifest.json`). */
export const DAWN_NIGHT_ASSET_FILES = [DAWN_BOMBER_SHADOW_TEXTURE] as const;
export function preloadDawnNightAssets(loader: Pick<Phaser.Loader.LoaderPlugin, 'image'>): void {
  for (const key of DAWN_NIGHT_ASSET_FILES) loader.image(key, runtimeAssetUrl(`./assets/sprites/dawn-night/runtime/${key}.webp`));
}

export function isDawnScrapTexture(key: string | undefined): boolean {
  return key !== undefined && Object.values(DAWN_SCRAP_KEYS).includes(key);
}
