import type * as Phaser from 'phaser';
import { drawModalFrame, MODAL_FRAME_ASSET } from './ForestModal';
import { roundRectPath, lerpColor } from './uiTextures';
import { UPGRADE_CATEGORY_FRAME, UPGRADE_XP_FRAME, UPGRADE_APPLY } from './UpgradeForestAssets';
import { ensureForestActionButton } from './forestTextures';

/** Source and destination insets describe the authored opening, not transparent outer margins. */
function drawSlicedFrame(ctx: CanvasRenderingContext2D, image: HTMLImageElement, w: number, h: number,
  sourceX: number, sourceY: number, capX: number, capY: number): void {
  const sx = [0, sourceX, image.width - sourceX], sy = [0, sourceY, image.height - sourceY];
  const sw = [sourceX, image.width - sourceX * 2, sourceX], sh = [sourceY, image.height - sourceY * 2, sourceY];
  const dx = [0, capX, w - capX], dy = [0, capY, h - capY];
  const dw = [capX, w - capX * 2, capX], dh = [capY, h - capY * 2, capY];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    if (x === 1 && y === 1) continue;
    ctx.drawImage(image, sx[x], sy[y], sw[x], sh[y], dx[x], dy[y], dw[x], dh[y]);
  }
}

export function ensureUpgradeXpFrame(scene: Phaser.Scene, barW: number, barH: number): string {
  const ready = scene.textures.exists(UPGRADE_XP_FRAME.key);
  const w = barW + 10, h = barH + 10;
  const key = `_upgrade_xp_v2_${ready}_${w}_${h}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, w, h)!;
  if (ready) drawSlicedFrame(texture.context, scene.textures.get(UPGRADE_XP_FRAME.key).getSourceImage() as HTMLImageElement,
    w, h, 20, 22, 5, 5);
  else drawUpgradeFrame(scene, texture.context, w, h, .2);
  texture.refresh();
  return key;
}

export function ensureUpgradeApply(scene: Phaser.Scene, w: number, h: number): string {
  if (!scene.textures.exists(UPGRADE_APPLY.key)) return ensureForestActionButton(scene, w, h, 'ready', 'primary', 'rest');
  const key = `_upgrade_apply_v2_${w}_${h}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, w, h)!;
  texture.context.drawImage(scene.textures.get(UPGRADE_APPLY.key).getSourceImage() as HTMLImageElement, 0, 0, w, h);
  texture.refresh();
  return key;
}

/** Insets keep glass inside the timber, including the rounded corner cutouts. */
export function ensureUpgradeSurface(scene: Phaser.Scene, w: number, h: number,
  accent: number, active: boolean, card = false): string {
  const ready = scene.textures.exists(UPGRADE_CATEGORY_FRAME.key);
  const key = `_upgrade_surface_v2_${ready}_${w}_${h}_${accent}_${active}_${card}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, w, h)!;
  const ctx = texture.context;
  const color = (value: number) => '#' + value.toString(16).padStart(6, '0');
  const gradient = ctx.createLinearGradient(0, 6, 0, h - 6);
  gradient.addColorStop(0, color(active && !card ? lerpColor(accent, 0xd4e8a1, .52) : active ? 0x344331 : 0x202a24));
  gradient.addColorStop(1, color(active && !card ? lerpColor(accent, 0x536333, .55) : 0x101913));
  roundRectPath(ctx, 5, 5, w - 10, h - 10, 9);
  ctx.fillStyle = gradient;
  ctx.fill();
  if (active) {
    ctx.strokeStyle = '#d6e9a2'; ctx.lineWidth = 2;
    ctx.stroke();
  }
  if (ready) drawSlicedFrame(ctx, scene.textures.get(UPGRADE_CATEGORY_FRAME.key).getSourceImage() as HTMLImageElement,
    w, h, 140, 60, 24, 12);
  else drawUpgradeFrame(scene, ctx, w, h, .25);
  texture.refresh();
  return key;
}

/** Cache desaturated UI copies; original weapon and upgrade artwork stays untouched. */
export function ensureUpgradeIcon(scene: Phaser.Scene, source: string, active: boolean, locked: boolean): string {
  if (active) return source;
  const key = `_upgrade_muted_v2_${source}_${locked}`;
  if (scene.textures.exists(key)) return key;
  const frame = scene.textures.getFrame(source);
  const texture = scene.textures.createCanvas(key, frame.cutWidth, frame.cutHeight)!;
  const ctx = texture.context;
  ctx.drawImage(frame.source.image as HTMLImageElement, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight,
    0, 0, frame.cutWidth, frame.cutHeight);
  const pixels = ctx.getImageData(0, 0, frame.cutWidth, frame.cutHeight);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const grey = pixels.data[i] * .2126 + pixels.data[i + 1] * .7152 + pixels.data[i + 2] * .0722;
    for (let channel = 0; channel < 3; channel++) {
      pixels.data[i + channel] = locked ? grey * .62 : pixels.data[i + channel] * .72 + grey * .28;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  texture.refresh();
  return key;
}

/** Shared wood rails at a consistent small scale, without stretching the corner ornaments. */
export function drawUpgradeFrame(scene: Phaser.Scene, ctx: CanvasRenderingContext2D,
  w: number, h: number, scale = .28): void {
  if (!scene.textures.exists(MODAL_FRAME_ASSET.key)) return;
  ctx.save();
  ctx.scale(scale, scale);
  drawModalFrame(ctx, scene.textures.get(MODAL_FRAME_ASSET.key).getSourceImage() as HTMLImageElement,
    w / scale, h / scale);
  ctx.restore();
}

export function ensureUpgradeFrame(scene: Phaser.Scene, w: number, h: number): string {
  const key = `_upgrade_frame_${w}x${h}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, w, h)!;
  drawUpgradeFrame(scene, texture.context, w, h, .45);
  texture.refresh();
  return key;
}
