import manifest from './manifests/character-badger-player-shadow-21c-production.json';
import { runtimeAssetUrl } from './RuntimeAssetUrls';
import type { WoodlandAsset } from './WoodlandAssetManifest';

export const CHARACTER_SHADOW_MANIFEST = manifest;
/** Material passes deliberately remain unloaded until the body-material integration. */
export const CHARACTER_SHADOW_FILES: readonly WoodlandAsset[] = manifest.pages
  .filter(page => page.pass === 'shadow')
  .map((page, index) => ({ ...page, key: `character-shadow-${index}`, kind: 'data' as const,
    url: runtimeAssetUrl(page.url), linear: true }));
