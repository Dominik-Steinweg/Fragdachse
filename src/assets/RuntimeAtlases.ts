import type * as Phaser from 'phaser';
import manifest from './manifests/runtime-atlas-frames.json';
import { runtimeAssetUrl } from './RuntimeAssetUrls';

export type RuntimeAtlasGroup = keyof typeof manifest.groups;
const frames = new Map<string, string>();
for (const group of Object.values(manifest.groups)) for (const page of group) {
  for (const id of page.frames) {
    if (frames.has(id)) throw new Error(`Duplicate runtime atlas frame: ${id}`);
    frames.set(id, page.key);
  }
}

/** Logical IDs remain authored IDs; only the presentation boundary resolves texture + frame. */
export function runtimeTextureKey(id: string): string { return frames.get(id) ?? id; }
export function runtimeFrameName(id: string): string | undefined { return frames.has(id) ? id : undefined; }
export function runtimeTextureExists(textures: Phaser.Textures.TextureManager, id: string): boolean {
  const atlas = frames.get(id);
  return atlas ? textures.exists(atlas) && textures.get(atlas).has(id) : textures.exists(id);
}
export function runtimeTextureFrame(textures: Phaser.Textures.TextureManager, id: string): Phaser.Textures.Frame {
  return textures.getFrame(runtimeTextureKey(id), runtimeFrameName(id));
}
export function runtimeImage(scene: Phaser.Scene, x: number, y: number, id: string): Phaser.GameObjects.Image {
  return scene.add.image(x, y, runtimeTextureKey(id), runtimeFrameName(id));
}
export function setRuntimeTexture(image: Phaser.GameObjects.Image, id: string): Phaser.GameObjects.Image {
  return image.setTexture(runtimeTextureKey(id), runtimeFrameName(id));
}

export function preloadRuntimeAtlas(loader: Phaser.Loader.LoaderPlugin, group: RuntimeAtlasGroup): void {
  for (const page of manifest.groups[group]) {
    loader.atlas(page.key, runtimeAssetUrl(page.image), runtimeAssetUrl(page.data));
  }
}

/** Checked inside normal boot/retry, after Loader completes, before World/UI construction. */
export function assertRuntimeAtlasesReady(textures: Phaser.Textures.TextureManager): void {
  for (const [id] of frames) {
    if (!runtimeTextureExists(textures, id)) throw new Error(`Atlas frame missing: ${id}`);
  }
}
