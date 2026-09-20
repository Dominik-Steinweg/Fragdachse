import type * as Phaser from 'phaser';
import { drawModalFrame, MODAL_FRAME_ASSET } from './ForestModal';
import { MATCH_RESULTS_BANNER, MATCH_RESULTS_TITLE } from './MatchResultsAssets';
import { ensureForestButton } from './forestTextures';

/** Fixed end caps preserve the carved corners and integrated ivy across all label widths. */
export function ensureResultsTitle(scene: Phaser.Scene, w: number, h: number): string {
  const ready = scene.textures.exists(MATCH_RESULTS_TITLE.key);
  const key = `_results_title_v2_${ready}_${w}x${h}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, w * 2, h * 2)!;
  const ctx = texture.context;
  ctx.scale(2, 2);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (ready) {
    const image = scene.textures.get(MATCH_RESULTS_TITLE.key).getSourceImage() as HTMLImageElement;
    const sourceCap = Math.round(image.height * 0.75);
    const cap = sourceCap * h / image.height;
    ctx.drawImage(image, 0, 0, sourceCap, image.height, 0, 0, cap, h);
    ctx.drawImage(image, sourceCap, 0, image.width - 2 * sourceCap, image.height,
      cap, 0, w - 2 * cap, h);
    ctx.drawImage(image, image.width - sourceCap, 0, sourceCap, image.height, w - cap, 0, cap, h);
  } else {
    ctx.fillStyle = '#30271a'; ctx.fillRect(0, 0, w, h);
  }
  texture.refresh();
  return key;
}

/** Reuse the lobby's frame kit, with fixed-size corners and repeated rails. */
export function ensureResultsPanel(scene: Phaser.Scene, w: number, h: number): string {
  const key = `_results_forest_panel_${w}x${h}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, w * 2, h * 2)!;
  const ctx = texture.context;
  ctx.scale(2, 2);
  const fill = ctx.createLinearGradient(0, 0, 0, h);
  fill.addColorStop(0, 'rgba(34,44,30,.96)');
  fill.addColorStop(1, 'rgba(14,24,19,.96)');
  ctx.fillStyle = fill;
  ctx.fillRect(24, 24, w - 48, h - 48);
  if (scene.textures.exists(MODAL_FRAME_ASSET.key)) {
    ctx.save();
    ctx.scale(0.65, 0.65);
    drawModalFrame(ctx, scene.textures.get(MODAL_FRAME_ASSET.key).getSourceImage() as HTMLImageElement,
      w / 0.65, h / 0.65);
    ctx.restore();
  }
  texture.refresh();
  return key;
}

/** No cache entry is created before the optional deferred art has arrived. */
export function ensureResultsBanner(scene: Phaser.Scene, w: number, h: number): string {
  if (!scene.textures.exists(MATCH_RESULTS_BANNER.key)) return ensureForestButton(scene, w, h, 'neutral', 'rest');
  const key = `_results_banner_${w}x${h}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, w, h)!;
  const image = scene.textures.get(MATCH_RESULTS_BANNER.key).getSourceImage() as HTMLImageElement;
  const scale = Math.min(w / image.width, h / image.height);
  texture.context.drawImage(image, (w - image.width * scale) / 2, (h - image.height * scale) / 2,
    image.width * scale, image.height * scale);
  texture.refresh();
  return key;
}
