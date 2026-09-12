import type * as Phaser from 'phaser';
import { COLORS } from '../config';
import { FOREST, buttonSkinSpec } from './UiSkin';
import type { ButtonIntent } from './uiTheme';
import { ensureRoundedTexture, lerpColor, roundRectPath } from './uiTextures';
import { FOREST_ASSETS } from './LobbyForestAssets';

/** Authored for the card aspect ratio. A single uniform scale preserves every leaf and grain. */
export function drawForestFrame(context: CanvasRenderingContext2D, image: HTMLImageElement,
  width: number, height: number): void {
  const scale = Math.min(width / image.width, height / image.height);
  const w = image.width * scale, h = image.height * scale;
  context.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}

export function ensureForestFrame(scene: Phaser.Scene, w: number, h: number): string {
  const key = `_forest_frame_${w}x${h}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, w * 2, h * 2)!;
  texture.context.imageSmoothingEnabled = true;
  texture.context.imageSmoothingQuality = 'high';
  texture.context.scale(2, 2);
  if (scene.textures.exists(FOREST_ASSETS.frame.key)) {
    drawForestFrame(texture.context, scene.textures.get(FOREST_ASSETS.frame.key).getSourceImage() as HTMLImageElement, w, h);
  }
  texture.refresh();
  return key;
}

/** Texture grain repeats at a stable scale instead of stretching with long labels. */
function paintWood(scene: Phaser.Scene, texture: Phaser.Textures.CanvasTexture, w: number, h: number,
  radius: number, alpha: number, borderOnly = false): void {
  if (!scene.textures.exists(FOREST_ASSETS.wood.key)) return;
  const image = scene.textures.get(FOREST_ASSETS.wood.key).getSourceImage() as HTMLImageElement;
  const context = texture.context;
  context.save();
  roundRectPath(context, 3, 3, w - 6, h - 6, radius);
  if (borderOnly) context.rect(8, 8, w - 16, h - 16);
  context.clip(borderOnly ? 'evenodd' : 'nonzero');
  context.globalAlpha = alpha;
  const pattern = context.createPattern(image, 'repeat');
  if (pattern) {
    context.scale(0.35, 0.35);
    context.fillStyle = pattern;
    context.fillRect(0, 0, w / 0.35, h / 0.35);
  }
  context.restore();
  texture.refresh();
}

export function ensureForestButton(scene: Phaser.Scene, w: number, h: number, intent: ButtonIntent,
  state: 'rest' | 'hover' | 'press', radius = 12, glass = false): string {
  const key = `_btn_forest_${glass ? 'glass' : 'wood'}_${intent}_${state}_${Math.round(w)}x${Math.round(h)}_r${radius}`;
  if (scene.textures.exists(key)) return key;
  const spec = buttonSkinSpec('forest', intent);
  const base = glass ? FOREST.raised : spec.fill;
  const fill = state === 'hover' ? lerpColor(base, COLORS.BROWN_1, 0.12)
    : state === 'press' ? lerpColor(base, COLORS.GREY_10, 0.25) : base;
  ensureRoundedTexture(scene, { key, w, h, radius,
    topColor: lerpColor(fill, COLORS.BROWN_1, 0.14), bottomColor: lerpColor(fill, FOREST.sunken, 0.42),
    fillAlpha: spec.fillAlpha, strokeColor: glass ? FOREST.border : spec.stroke,
    strokeAlpha: spec.strokeAlpha, strokeWidth: 2, highlightAlpha: state === 'press' ? 0.01 : 0.08 });
  paintWood(scene, scene.textures.get(key) as Phaser.Textures.CanvasTexture,
    w, h, radius, intent === 'primary' ? 0.12 : state === 'press' ? 0.3 : 0.5);
  return key;
}

export function ensureForestPanel(scene: Phaser.Scene, w: number, h: number, glass = false): string {
  const key = `_forest_${glass ? 'glass' : 'popup'}_${Math.ceil(w)}x${Math.ceil(h)}`;
  if (scene.textures.exists(key)) return key;
  ensureRoundedTexture(scene, { key, w, h, radius: glass ? 22 : 12,
    topColor: FOREST.glass, bottomColor: FOREST.sunken, fillAlpha: glass ? 0.77 : 0.97,
    strokeColor: glass ? FOREST.border : FOREST.woodEdge, strokeAlpha: glass ? 0.3 : 0.85,
    strokeWidth: glass ? 1 : 2, highlightAlpha: 0.025 });
  if (!glass) {
    const texture = scene.textures.get(key) as Phaser.Textures.CanvasTexture;
    paintWood(scene, texture, w, h, 12, 0.6, true);
    if (scene.textures.exists(FOREST_ASSETS.leaves.key)) {
      texture.context.imageSmoothingEnabled = true;
      texture.context.imageSmoothingQuality = 'high';
      texture.context.drawImage(scene.textures.get(FOREST_ASSETS.leaves.key).getSourceImage() as HTMLImageElement,
        w - 40, h - 40, 40, 40);
      texture.refresh();
    }
  }
  return key;
}

/** All ornaments belong to their parent's lifetime and never receive input. */
export function forestOrnament(scene: Phaser.Scene, asset: 'leaves' | 'medallion' | 'relief',
  x: number, y: number, w: number, h: number): Phaser.GameObjects.Image {
  const key = `_forest_${asset}_${Math.round(w)}x${Math.round(h)}`;
  if (!scene.textures.exists(key)) {
    const texture = scene.textures.createCanvas(key, Math.round(w * 2), Math.round(h * 2))!;
    texture.context.imageSmoothingEnabled = true;
    texture.context.imageSmoothingQuality = 'high';
    texture.context.drawImage(scene.textures.get(FOREST_ASSETS[asset].key).getSourceImage() as HTMLImageElement,
      0, 0, w * 2, h * 2);
    texture.refresh();
  }
  return scene.add.image(x, y, key).setDisplaySize(w, h).setScrollFactor(0);
}
