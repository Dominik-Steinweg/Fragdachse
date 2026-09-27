import type * as Phaser from 'phaser';
import { buildBaseAccentMask, BASE_ACCENT_PADDING } from './BaseAccentMask';

export type BaseAccentTextureKey = 'base' | 'base_hostile';

interface SharedAccentTexture {
  readonly key: string;
  readonly frames: ReadonlySet<string>;
  users: number;
}

const sharedTextures = new WeakMap<Phaser.Textures.TextureManager, Map<BaseAccentTextureKey, SharedAccentTexture>>();

/** The atlas belongs to its live base/preview users, never to a gameplay or round state. */
export function acquireBaseAccentGlowTexture(textures: Phaser.Textures.TextureManager, sourceKey: BaseAccentTextureKey = 'base') {
  let cache = sharedTextures.get(textures);
  let shared = cache?.get(sourceKey);
  if (!shared) {
    const key = `__base_accent_glow_${sourceKey}`;
    const source = textures.get(sourceKey);
    const frameNames = source.getFrameNames();
    const sourceImage = source.getSourceImage() as HTMLImageElement;
    const scratch = document.createElement('canvas');
    scratch.width = sourceImage.width;
    scratch.height = sourceImage.height;
    const context = scratch.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(sourceImage, 0, 0);
    const pixels = context.getImageData(0, 0, scratch.width, scratch.height).data;
    const pitchX = Math.max(...frameNames.map(name => source.get(name).cutWidth)) + BASE_ACCENT_PADDING * 2;
    const pitchY = Math.max(...frameNames.map(name => source.get(name).cutHeight)) + BASE_ACCENT_PADDING * 2;
    const cols = Math.ceil(Math.sqrt(frameNames.length * 2));
    const atlas = textures.createCanvas(key, cols * pitchX, Math.ceil(frameNames.length * 2 / cols) * pitchY)!;
    const frames = new Set<string>();
    try {
      for (let index = 0; index < frameNames.length; index++) {
        const name = frameNames[index], frame = source.get(name);
        const mask = buildBaseAccentMask(pixels, scratch.width, {
          x: frame.cutX, y: frame.cutY, width: frame.cutWidth, height: frame.cutHeight,
        }, sourceKey === 'base_hostile' ? 'violet' : 'blue');
        if (!mask.hasAccent) continue;
        frames.add(name);
        for (const [layer, data] of [mask.core, mask.halo].entries()) {
          const slot = index * 2 + layer, x = slot % cols * pitchX, y = Math.floor(slot / cols) * pitchY;
          const image = atlas.context.createImageData(mask.width, mask.height);
          image.data.set(data);
          atlas.context.putImageData(image, x, y);
          atlas.add(`${name}:${layer === 0 ? 'core' : 'halo'}`, 0, x, y, mask.width, mask.height);
        }
      }
      atlas.refresh();
    } catch (error) {
      textures.remove(key);
      throw error;
    }
    shared = { key, frames, users: 0 };
    if (!cache) sharedTextures.set(textures, cache = new Map());
    cache.set(sourceKey, shared);
  }
  shared.users++;
  const acquired = shared;
  let released = false;
  return {
    key: acquired.key,
    frames: acquired.frames,
    release(): void {
      if (released) return;
      released = true;
      if (--acquired.users === 0) {
        textures.remove(acquired.key);
        cache!.delete(sourceKey);
        if (cache!.size === 0) sharedTextures.delete(textures);
      }
    },
  };
}
