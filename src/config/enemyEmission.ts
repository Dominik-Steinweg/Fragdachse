import emissionManifest from '../assets/manifests/enemy-emission.json';
import type { PipelineAsset } from './pipelineAssets';

/**
 * Emission sheets derived from selected enemy builds: only the authored heat channels of every beauty
 * frame, as a neutral intensity mask that the runtime tints (EnemyHeatBurstPresentation), in the beauty
 * sheet's layout. An entry counts only while it is bound to the live revision and the published sheet.
 */
interface EnemyEmissionEntry {
  readonly revision: string;
  readonly sheet: string;
  readonly beautySheetSha256: string;
}

const EMISSION = emissionManifest.assets as Readonly<Record<string, EnemyEmissionEntry>>;

/** Path of an enemy's emission sheet, or null while its live build has none. */
export function enemyEmissionSheetPath(asset: PipelineAsset): string | null {
  const entry = EMISSION[asset.id];
  return entry && entry.revision === asset.revision && entry.beautySheetSha256 === asset.hashes.sheet ? entry.sheet : null;
}

/** Texture key of the emission sheet that belongs to a walking sheet texture. */
export function enemyEmissionTextureKey(sheetTextureKey: string): string {
  return `${sheetTextureKey}_emission`;
}
