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
  const base = glass ? FOREST.field : spec.fill;
  const fill = state === 'hover' ? lerpColor(base, COLORS.BROWN_1, 0.12)
    : state === 'press' ? lerpColor(base, COLORS.GREY_10, 0.25) : base;
  ensureRoundedTexture(scene, { key, w, h, radius: glass ? radius : 6,
    topColor: glass ? fill : lerpColor(fill, COLORS.BROWN_1, 0.08), bottomColor: glass ? FOREST.sunken : lerpColor(fill, FOREST.sunken, 0.42),
    fillAlpha: spec.fillAlpha, strokeColor: glass ? FOREST.border : spec.stroke,
    strokeAlpha: spec.strokeAlpha, strokeWidth: 1, highlightAlpha: state === 'press' ? 0.01 : 0.04 });
  if (!glass) {
    const texture = scene.textures.get(key) as Phaser.Textures.CanvasTexture;
    paintWood(scene, texture, w, h, 4, intent === 'primary' ? 0.08 : state === 'press' ? 0.35 : 0.6);
    if (scene.textures.exists(FOREST_ASSETS.buttonFrame.key)) {
      const ctx = texture.context;
      ctx.save();
      ctx.globalAlpha = intent === 'disabled' ? .45 : state === 'press' ? .72 : 1;
      drawForestButtonFrame(ctx,
        scene.textures.get(FOREST_ASSETS.buttonFrame.key).getSourceImage() as HTMLImageElement, w, h);
      ctx.restore();
      if (intent === 'attention' || intent === 'danger') {
        roundRectPath(ctx, 5, 5, w - 10, h - 10, 4);
        ctx.strokeStyle = '#' + spec.stroke.toString(16).padStart(6, '0');
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      texture.refresh();
    }
  }
  return key;
}

/** Fixed corners and cropped repeats keep timber grain and pegs undistorted at every button size. */
export function drawForestButtonFrame(ctx: CanvasRenderingContext2D, image: HTMLImageElement,
  width: number, height: number): void {
  const { crop, corner } = FOREST_ASSETS.buttonFrame;
  const cap = Math.min(8, width / 2, height / 2);
  const scale = cap / corner;
  const sx = [crop.x, crop.x + corner, crop.x + crop.width - corner];
  const sy = [crop.y, crop.y + corner, crop.y + crop.height - corner];
  const sw = [corner, crop.width - corner * 2, corner];
  const sh = [corner, crop.height - corner * 2, corner];
  const dx = [0, cap, width - cap], dy = [0, cap, height - cap];
  const dw = [cap, width - cap * 2, cap], dh = [cap, height - cap * 2, cap];
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    if (row === 1 && col === 1) continue;
    for (let y = 0; y < dh[row]; y += sh[row] * scale) for (let x = 0; x < dw[col]; x += sw[col] * scale) {
      const tileW = Math.min(sw[col] * scale, dw[col] - x);
      const tileH = Math.min(sh[row] * scale, dh[row] - y);
      ctx.drawImage(image, sx[col], sy[row], tileW / scale, tileH / scale,
        dx[col] + x, dy[row] + y, tileW, tileH);
    }
  }
}

/** Source-space trim excludes transparent generation margins; artwork always scales uniformly. */
const ACTION_FRAME_SOURCE = {
  ready: { ...FOREST_ASSETS.ready.crop, insetX: 0.065, insetTop: 0.19, insetBottom: 0.19 },
  // The branch opening is lower than the foliage silhouette's centre. Fill underneath both rails.
  world: { ...FOREST_ASSETS.world.crop, insetX: 0.12, insetTop: 0.27, insetBottom: 0.20 },
} as const;

export function ensureForestActionButton(scene: Phaser.Scene, w: number, h: number,
  frame: 'ready' | 'world', intent: ButtonIntent, state: 'rest' | 'hover' | 'press'): string {
  const key = `_btn_forest_${frame}_${intent}_${state}_${Math.round(w)}x${Math.round(h)}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, Math.round(w), Math.round(h))!;
  const ctx = texture.context;
  const source = ACTION_FRAME_SOURCE[frame];
  const scale = Math.min(w / source.width, h / source.height);
  const dw = source.width * scale, dh = source.height * scale;
  const dx = (w - dw) / 2, dy = (h - dh) / 2;
  const spec = buttonSkinSpec('forest', intent);
  const fill = state === 'hover' ? lerpColor(spec.fill, COLORS.BROWN_1, .12)
    : state === 'press' ? lerpColor(spec.fill, FOREST.sunken, .22) : spec.fill;
  ctx.save();
  roundRectPath(ctx, dx + dw * source.insetX, dy + dh * source.insetTop,
    dw * (1 - source.insetX * 2), dh * (1 - source.insetTop - source.insetBottom), dh * .2);
  ctx.clip();
  const gradient = ctx.createLinearGradient(0, dy, 0, dy + dh);
  gradient.addColorStop(0, '#' + lerpColor(fill, COLORS.BROWN_1, .15).toString(16).padStart(6, '0'));
  gradient.addColorStop(1, '#' + lerpColor(fill, FOREST.sunken, .32).toString(16).padStart(6, '0'));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  if (frame === 'world' && scene.textures.exists(FOREST_ASSETS.wood.key)) {
    const pattern = ctx.createPattern(scene.textures.get(FOREST_ASSETS.wood.key).getSourceImage() as HTMLImageElement, 'repeat');
    if (pattern) { ctx.globalAlpha = .45; ctx.fillStyle = pattern; ctx.scale(.35, .35); ctx.fillRect(0, 0, w / .35, h / .35); }
  }
  ctx.restore();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (scene.textures.exists(FOREST_ASSETS[frame].key)) ctx.drawImage(
    scene.textures.get(FOREST_ASSETS[frame].key).getSourceImage() as HTMLImageElement,
    source.x, source.y, source.width, source.height, dx, dy, dw, dh);
  texture.refresh();
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
    const image = scene.textures.get(FOREST_ASSETS[asset].key).getSourceImage() as HTMLImageElement;
    if (asset === 'relief') {
      const crop = FOREST_ASSETS.relief.crop;
      texture.context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, w * 2, h * 2);
    } else texture.context.drawImage(image, 0, 0, w * 2, h * 2);
    texture.refresh();
  }
  return scene.add.image(x, y, key).setDisplaySize(w, h).setScrollFactor(0);
}
