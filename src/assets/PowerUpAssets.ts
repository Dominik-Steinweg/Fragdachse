import type * as Phaser from 'phaser';
import manifest from './manifests/powerups-powerups-r07.json';
import { runtimeAssetUrl } from './RuntimeAssetUrls';

export const POWERUP_BASE_KEY = 'powerup_layer_base';
/** World token under a lying pickup; the square base above stays the static UI composite layer. */
export const POWERUP_TOKEN_KEY = 'powerup_layer_token';
const symbols = new Map(manifest.symbols.map(asset => [asset.spriteKey, `${asset.spriteKey}_symbol`]));

/** World symbol art: an authored loop sheet (64-px frames) or, without a loop, the static layer. */
export interface PowerUpSymbolArt {
  readonly key: string;
  readonly frames: number;
  readonly fps: number;
}

interface LoopAsset extends PowerUpSymbolArt {
  readonly file: string;
  readonly layout: { readonly frameWidth: number; readonly frameHeight: number; readonly margin: number;
    readonly spacing: number; readonly frameCount: number };
}

const loops = new Map<string, LoopAsset>(manifest.symbols.flatMap(asset => {
  const loop = (asset as { loop?: { frames: number; fps: number; layout: LoopAsset['layout']; sheet: { file: string } } }).loop;
  return loop
    ? [[asset.spriteKey, { key: `${asset.spriteKey}_loop`, frames: loop.frames, fps: loop.fps, file: loop.sheet.file, layout: loop.layout }]]
    : [];
}));

export function powerUpSymbolKey(compositeKey: string): string | undefined {
  return symbols.get(compositeKey);
}

export function powerUpSymbolArt(compositeKey: string): PowerUpSymbolArt | undefined {
  const loop = loops.get(compositeKey);
  if (loop) return loop;
  const key = symbols.get(compositeKey);
  return key ? { key, frames: 1, fps: 0 } : undefined;
}

/**
 * Colour layers use the normal PMA image path, not the data-atlas loader. A symbol with an
 * authored loop is only needed as its sheet in the world; its static layer lives on in the UI
 * composite, so it is not loaded separately.
 */
export const POWERUP_ASSETS = [
  { key: POWERUP_BASE_KEY, file: manifest.base.file },
  { key: POWERUP_TOKEN_KEY, file: manifest.token.file },
  ...manifest.symbols.flatMap(asset => [
    { key: asset.spriteKey, file: asset.composite.file },
    ...(loops.has(asset.spriteKey) ? [] : [{ key: symbols.get(asset.spriteKey)!, file: asset.image.file }]),
  ]),
];
export const POWERUP_LOOP_ASSETS: readonly LoopAsset[] = [...loops.values()];

export function preloadPowerUpAssets(scene: Phaser.Scene): void {
  for (const asset of POWERUP_ASSETS) {
    if (!scene.textures.exists(asset.key)) scene.load.image(asset.key, runtimeAssetUrl(asset.file));
  }
  for (const loop of POWERUP_LOOP_ASSETS) {
    if (scene.textures.exists(loop.key)) continue;
    const { frameWidth, frameHeight, margin, spacing, frameCount } = loop.layout;
    scene.load.spritesheet(loop.key, runtimeAssetUrl(loop.file), { frameWidth, frameHeight, margin, spacing, endFrame: frameCount - 1 });
  }
}

export function assertPowerUpAssetsReady(scene: Phaser.Scene): void {
  for (const asset of [...POWERUP_ASSETS, ...POWERUP_LOOP_ASSETS.map(loop => ({ key: loop.key, file: loop.file }))]) {
    if (!scene.textures.exists(asset.key)) throw new Error(`Power-Up konnte nicht geladen werden: ${asset.file}`);
  }
}
