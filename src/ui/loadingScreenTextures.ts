import type * as Phaser from 'phaser';
import { drawModalFrame, MODAL_FRAME_ASSET } from './ForestModal';

/** Translucent glass within opaque wood; all decoration shares the content fade. */
export function ensureLoadingPanel(scene: Phaser.Scene, w: number, h: number): string {
  const key = `_loading_forest_panel_${w}x${h}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, w * 2, h * 2)!;
  const ctx = texture.context;
  ctx.scale(2, 2);
  const fill = ctx.createLinearGradient(0, 0, 0, h);
  fill.addColorStop(0, 'rgba(28,39,27,.8)');
  fill.addColorStop(1, 'rgba(10,22,15,.82)');
  ctx.fillStyle = fill;
  ctx.fillRect(22, 22, w - 44, h - 44);
  if (scene.textures.exists(MODAL_FRAME_ASSET.key)) {
    ctx.scale(.55, .55);
    drawModalFrame(ctx, scene.textures.get(MODAL_FRAME_ASSET.key).getSourceImage() as HTMLImageElement,
      w / .55, h / .55);
  }
  texture.refresh();
  return key;
}
