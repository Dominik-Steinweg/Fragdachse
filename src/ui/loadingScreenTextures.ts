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

export const LOADING_BAR_WIDTH = 900;
export const LOADING_BAR_HEIGHT = 14;
const BAR_RESOLUTION = 2;

export interface LoadingBarTextureKeys {
  readonly track: string;
  readonly fill: string;
  readonly fillReady: string;
  readonly sheen: string;
  readonly glow: string;
}

function ensureCanvas(scene: Phaser.Scene, key: string, w: number, h: number,
  draw: (ctx: CanvasRenderingContext2D) => void): string {
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, w * BAR_RESOLUTION, h * BAR_RESOLUTION)!;
  texture.context.scale(BAR_RESOLUTION, BAR_RESOLUTION);
  draw(texture.context);
  texture.refresh();
  return key;
}

function barPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
}

/** Recessed wooden-glass track and warm moss fill; the fill is cropped to the shown progress. */
export function ensureLoadingBarTextures(scene: Phaser.Scene): LoadingBarTextureKeys {
  const w = LOADING_BAR_WIDTH, h = LOADING_BAR_HEIGHT;
  const track = ensureCanvas(scene, '_loading_bar_track', w, h, ctx => {
    barPath(ctx, 0.5, 0.5, w - 1, h - 1);
    const fill = ctx.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, 'rgba(3,8,5,.92)');
    fill.addColorStop(1, 'rgba(18,30,21,.88)');
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.save();
    ctx.clip();
    const shade = ctx.createLinearGradient(0, 0, 0, h * 0.55);
    shade.addColorStop(0, 'rgba(0,0,0,.55)');
    shade.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, w, h);
    for (let step = 1; step < 10; step += 1) {
      ctx.fillStyle = step === 5 ? 'rgba(222,213,173,.13)' : 'rgba(222,213,173,.06)';
      ctx.fillRect(Math.round(w * step / 10), 3, 1, h - 6);
    }
    ctx.restore();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(222,213,173,.16)';
    ctx.stroke();
  });
  const drawFill = (stops: readonly string[], gloss: number) => (ctx: CanvasRenderingContext2D): void => {
    barPath(ctx, 2, 2, w - 4, h - 4);
    const body = ctx.createLinearGradient(0, 0, w, 0);
    stops.forEach((color, index) => body.addColorStop(index / (stops.length - 1), color));
    ctx.fillStyle = body;
    ctx.fill();
    ctx.save();
    ctx.clip();
    const relief = ctx.createLinearGradient(0, 2, 0, h - 2);
    relief.addColorStop(0, `rgba(255,250,214,${gloss})`);
    relief.addColorStop(0.42, 'rgba(255,250,214,0)');
    relief.addColorStop(0.7, 'rgba(0,0,0,0)');
    relief.addColorStop(1, 'rgba(0,0,0,.32)');
    ctx.fillStyle = relief;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  };
  const fill = ensureCanvas(scene, '_loading_bar_fill', w, h,
    drawFill(['#2f4724', '#55703a', '#8a9f52', '#c9c27a'], 0.32));
  const fillReady = ensureCanvas(scene, '_loading_bar_fill_ready', w, h,
    drawFill(['#5f7d3a', '#8fa955', '#c2cf7c', '#e3d995'], 0.38));
  const sheen = ensureCanvas(scene, '_loading_bar_sheen', 140, h, ctx => {
    const band = ctx.createLinearGradient(0, 0, 140, 0);
    band.addColorStop(0, 'rgba(255,248,214,0)');
    band.addColorStop(0.5, 'rgba(255,248,214,.38)');
    band.addColorStop(1, 'rgba(255,248,214,0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, 3, 140, h - 6);
  });
  const glow = ensureCanvas(scene, '_loading_bar_glow', 72, 28, ctx => {
    ctx.translate(36, 14);
    ctx.scale(1, 14 / 36);
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, 36);
    halo.addColorStop(0, 'rgba(255,246,206,.9)');
    halo.addColorStop(0.12, 'rgba(240,224,156,.5)');
    halo.addColorStop(0.45, 'rgba(214,202,126,.12)');
    halo.addColorStop(1, 'rgba(200,190,110,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(-36, -36, 72, 72);
  });
  return { track, fill, fillReady, sheen, glow };
}
