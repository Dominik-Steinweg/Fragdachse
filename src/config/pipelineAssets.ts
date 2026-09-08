import manifest from './pipelineAssets.json';

/** Runtime-only projection of the selected Blender exports, committed with their PNGs. */
export const PIPELINE_ASSETS = manifest.assets;
export type PipelineAsset = (typeof PIPELINE_ASSETS)[number];
export type PipelineClip = PipelineAsset['clips'][number];

export function getPipelineAsset(id: string): PipelineAsset {
  const asset = PIPELINE_ASSETS.find((candidate) => candidate.id === id);
  if (!asset) throw new Error(`Missing pipeline asset: ${id}`);
  return asset;
}

export function getPipelineAssetForTexture(textureKey: string): PipelineAsset | undefined {
  return PIPELINE_ASSETS.find((asset) => asset.textureKey === textureKey);
}

export function pipelineAnimationKey(asset: PipelineAsset, clip: PipelineClip): string {
  if (clip.name === 'move') return `${asset.textureKey}_walk`;
  return `${asset.sheetTextureKey}_${clip.name}`;
}
