import { normalizePipelineAssets, type PipelineNormalAsset, type PipelineBossAsset } from './pipelineAssetContracts';
export { normalizePipelineAsset, normalizePipelineAssets, pipelineMarkerSocket, pipelineEggReleaseSocket } from './pipelineAssetContracts';
export type { PipelineBossAsset, PipelineNormalAsset, PipelineRuntimeAsset, PipelineAtlasPage, PipelineClip, PipelineSocketPoint } from './pipelineAssetContracts';
import type { PipelineClip } from './pipelineAssetContracts';

/** Normalized full-frame coordinates; rotation follows the image's clockwise Y-down plane. */
export interface EyeAnchor {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
}
/** `extra` holds further eyes as complete left/right pairs (the four-eyed kraken brood). */
export interface EyeAnchorFrame { readonly left: EyeAnchor; readonly right: EyeAnchor; readonly extra?: readonly EyeAnchor[] }

// One registry entry per file (scripts/asset-pipeline/pipeline-registry.mjs), ordered by asset id.
const registryEntries = Object.values(import.meta.glob<{ id: string }>('./pipelineAssets/assets/*.json', { eager: true, import: 'default' }))
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
/** Runtime-only projection of the selected Blender exports, committed with their PNGs. */
export const PIPELINE_RUNTIME_ASSETS = normalizePipelineAssets(registryEntries);
/** Existing sheet consumers remain explicit: boss atlases have no idle/sheet fallback path. */
export const PIPELINE_ASSETS = PIPELINE_RUNTIME_ASSETS.filter((a): a is PipelineNormalAsset => a.runtimeContract === 'sheet');
export type PipelineAsset = PipelineNormalAsset;

/** Boss bodies and parts are owned by phase residency, including their static/rest poses. */
export function isPipelineBossTexture(textureKey: string): boolean {
  return PIPELINE_RUNTIME_ASSETS.some(a => a.runtimeContract === 'boss' && a.textureKey === textureKey);
}

export function getPipelineBossAsset(id: string): PipelineBossAsset {
  const asset = PIPELINE_RUNTIME_ASSETS.find(a => a.id === id);
  if (!asset || asset.runtimeContract !== 'boss') throw new Error(`Missing boss pipeline asset: ${id}`);
  return asset;
}

export function getPipelineAsset(id: string): PipelineAsset {
  const asset = PIPELINE_ASSETS.find((candidate) => candidate.id === id);
  if (!asset) throw new Error(`Missing pipeline asset: ${id}`);
  return asset;
}

export function getPipelineAssetForTexture(textureKey: string): PipelineAsset | undefined {
  return PIPELINE_ASSETS.find((asset) => asset.textureKey === textureKey);
}

const spriteScales = new Map(PIPELINE_ASSETS.flatMap(asset => {
  const scale = 'displayScale' in asset && typeof asset.displayScale === 'number' ? asset.displayScale : 1;
  return [[asset.textureKey, scale], [asset.sheetTextureKey, scale]] as const;
}));

/** Authored transparent movement margin; multiply the canvas, never the collision size. */
export function getPipelineSpriteScale(textureKey: string): number { return spriteScales.get(textureKey) ?? 1; }

export function pipelineAnimationKey(asset: PipelineAsset, clip: PipelineClip): string {
  if (clip.name === 'move') return `${asset.textureKey}_walk`;
  return `${asset.sheetTextureKey}_${clip.name}`;
}
