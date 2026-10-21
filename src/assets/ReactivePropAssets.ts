import { getPipelineAssetForTexture, type PipelineAsset } from '../config/pipelineAssets';
import { REACTIVE_PROP_KINDS } from '../config/reactiveProps/reactivePropKinds';

/**
 * Pipeline-Sprites aller Varianten reaktiver Map-Objekte. Die Texture-Keys nennt allein die
 * Kind-Registry; eine noch nicht importierte Variante zeigt den Platzhalter des Renderers.
 */
export const REACTIVE_PROP_PIPELINE_ASSETS: readonly PipelineAsset[] = [...REACTIVE_PROP_KINDS.values()]
  .flatMap(kind => Object.values(kind.visual.variants))
  .flatMap(variant => {
    const asset = getPipelineAssetForTexture(variant.textureKey);
    return asset ? [asset] : [];
  });
