import * as Phaser from 'phaser';

const ASMD_LOADOUT_ICON_KEYS = new Set(['ASMD_PRIM', 'ASMD_SEC']);

export interface LoadoutIconDisplaySize {
  readonly width: number;
  readonly height: number;
}

function isAsmdLoadoutIcon(textureKey: string): boolean {
  return ASMD_LOADOUT_ICON_KEYS.has(textureKey);
}

/**
 * Returns the authored UI texture key and uses nearest-neighbor sampling for
 * the ASMD icons so weak outer pixels remain visible at small display sizes.
 */
export function getLoadoutIconTextureKey(scene: Phaser.Scene, textureKey: string): string {
  if (isAsmdLoadoutIcon(textureKey) && scene.textures.exists(textureKey)) {
    scene.textures.get(textureKey).setFilter(Phaser.Textures.FilterMode.NEAREST);
  }
  return textureKey;
}

/**
 * Computes a proportional UI size for a loadout icon.
 *
 * The transparent pixels in the authored frame remain part of the fit box. This
 * keeps the icon centered and prevents a later asset with a non-square frame from
 * being stretched.
 */
export function getLoadoutIconDisplaySize(
  textureKey: string,
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number,
): LoadoutIconDisplaySize {
  if (sourceWidth <= 0 || sourceHeight <= 0 || maxWidth <= 0 || maxHeight <= 0) {
    return { width: 0, height: 0 };
  }

  const fitScale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);

  return {
    width: sourceWidth * fitScale,
    height: sourceHeight * fitScale,
  };
}

/** Applies the shared proportional fit to a Phaser image while preserving its center. */
export function fitLoadoutIcon(
  image: Phaser.GameObjects.Image,
  maxWidth: number,
  maxHeight: number,
): Phaser.GameObjects.Image {
  const size = getLoadoutIconDisplaySize(
    image.texture.key,
    image.frame.width,
    image.frame.height,
    maxWidth,
    maxHeight,
  );
  return image.setDisplaySize(size.width, size.height);
}
