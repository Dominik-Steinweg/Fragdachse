import { getPipelineAsset } from '../config/pipelineAssets';
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
export const DAWN_SITE_DISPLAY_SIZE = 96;
export const DAWN_SCRAP_DISPLAY_SIZE = 24;

/** Uses the existing construction pipeline's sheet loading and clip registration. */
export const DAWN_PIPELINE_ASSETS = [
  ...DAWN_WRECK_VARIANTS.flatMap(variant => [1, 2, 3].map(tier => DAWN_M3_ASSET_KEYS.wreckVariant(variant, tier))),
  DAWN_EXTRACTOR_KEY, ...Object.values(DAWN_SCRAP_KEYS),
].map(getPipelineAsset);

export function isDawnScrapTexture(key: string | undefined): boolean {
  return key !== undefined && Object.values(DAWN_SCRAP_KEYS).includes(key);
}
