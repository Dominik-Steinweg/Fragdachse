import * as Phaser from 'phaser';

/** Additional breathing room for the newly authored ASMD loadout silhouettes. */
export const ASMD_LOADOUT_ICON_SCALE = 0.86;
export const ASMD_LOADOUT_ICON_PADDING = 2;

export interface LoadoutIconDisplaySize {
  readonly width: number;
  readonly height: number;
}

function isAsmdLoadoutIcon(textureKey: string): boolean {
  return textureKey === 'ASMD_PRIM' || textureKey === 'ASMD_SEC';
}

/**
 * Returns a UI-only padded texture for ASMD while leaving the authored PNG and
 * the gameplay-held texture untouched. The padding is part of the texture frame,
 * so all consumers can use the same proportional fit without clipping the
 * source silhouette at its edge.
 */
export function getLoadoutIconTextureKey(scene: Phaser.Scene, textureKey: string): string {
  if (!isAsmdLoadoutIcon(textureKey)) return textureKey;

  const paddedKey = `__ui_loadout_icon_${textureKey}_padded`;
  if (scene.textures.exists(paddedKey)) return paddedKey;
  if (!scene.textures.exists(textureKey)) return textureKey;

  const sourceTexture = scene.textures.get(textureKey);
  const frame = sourceTexture.get();
  const sourceWidth = Math.max(1, Math.ceil(frame.realWidth || frame.width));
  const sourceHeight = Math.max(1, Math.ceil(frame.realHeight || frame.height));
  const padding = ASMD_LOADOUT_ICON_PADDING;
  const canvas = scene.textures.createCanvas(
    paddedKey,
    sourceWidth + padding * 2,
    sourceHeight + padding * 2,
  );
  if (!canvas) return textureKey;

  const ctx = canvas.context;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    sourceTexture.getSourceImage() as CanvasImageSource,
    frame.cutX,
    frame.cutY,
    frame.cutWidth,
    frame.cutHeight,
    padding,
    padding,
    frame.cutWidth,
    frame.cutHeight,
  );
  canvas.refresh();
  return paddedKey;
}

/**
 * Computes a proportional UI size for a loadout icon.
 *
 * The transparent pixels in the authored frame remain part of the fit box. This
 * keeps the icon centered and prevents a later asset with a non-square frame from
 * being stretched. ASMD gets a small, asset-specific inset because its new
 * silhouette intentionally uses almost the complete horizontal frame.
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
  const assetScale = isAsmdLoadoutIcon(textureKey)
    ? ASMD_LOADOUT_ICON_SCALE
    : 1;
  const scale = fitScale * assetScale;

  return {
    width: sourceWidth * scale,
    height: sourceHeight * scale,
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
