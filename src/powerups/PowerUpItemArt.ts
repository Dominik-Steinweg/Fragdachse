import type * as Phaser from 'phaser';
import { POWERUP_ITEM_ART } from './PowerUpConfig';

/** Shared procedural frames of the item decoration GPU layers. */
export const TEX_POWERUP_ITEM_FX = '__powerup_item_fx';
export const POWERUP_ITEM_FX_FRAME = {
  ring: 'ring',
  halo: 'halo',
  channel: 'channel',
  shadow: 'shadow',
  glint: 'glint',
} as const;

/** Source size of each frame; display scales divide the world size by these values. */
export const POWERUP_ITEM_FX_FRAME_SIZE = {
  ring: 128,
  halo: 64,
  channel: 64,
  shadow: 64,
  glint: 32,
} as const;

const DISPLAY_SUFFIX = '@display';

/**
 * Display copy of a 256-pixel pipeline layer, prefiltered by repeated halving.
 *
 * The pickups are shown at roughly 20–55 screen pixels and the renderer creates no mipmaps.
 * Sampling the 256-pixel master directly therefore skips texels and makes the symbol edge
 * shimmer while it hovers; the halved copy keeps the authored silhouette stable.
 */
export function ensurePowerUpDisplayTexture(scene: Phaser.Scene, sourceKey: string): string {
  const key = sourceKey + DISPLAY_SUFFIX;
  const textures = scene.textures;
  if (textures.exists(key)) return key;
  const source = textures.exists(sourceKey)
    ? textures.get(sourceKey).getSourceImage() as CanvasImageSource & { width: number; height: number }
    : null;
  if (!source || !source.width) return sourceKey;
  const target = POWERUP_ITEM_ART.displayTextureSize;
  let canvas = document.createElement('canvas');
  canvas.width = source.width; canvas.height = source.height;
  let context = canvas.getContext('2d')!;
  context.drawImage(source, 0, 0);
  while (canvas.width / 2 >= target) {
    const next = document.createElement('canvas');
    next.width = Math.max(target, Math.round(canvas.width / 2));
    next.height = Math.max(target, Math.round(canvas.height / 2));
    context = next.getContext('2d')!;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(canvas, 0, 0, next.width, next.height);
    canvas = next;
  }
  textures.addCanvas(key, canvas);
  return key;
}

export function ensurePowerUpItemFxTexture(scene: Phaser.Scene): Phaser.Textures.Texture {
  const textures = scene.textures;
  if (textures.exists(TEX_POWERUP_ITEM_FX)) return textures.get(TEX_POWERUP_ITEM_FX);
  const texture = textures.createCanvas(TEX_POWERUP_ITEM_FX, 256, 256)!;
  const ctx = texture.context;
  ctx.clearRect(0, 0, 256, 256);

  drawRing(ctx, 0, 0, POWERUP_ITEM_FX_FRAME_SIZE.ring);
  texture.add(POWERUP_ITEM_FX_FRAME.ring, 0, 0, 0, 128, 128);

  drawRadial(ctx, 128, 0, 64, [[0, 0.9], [0.18, 0.62], [0.42, 0.22], [0.7, 0.06], [1, 0]]);
  texture.add(POWERUP_ITEM_FX_FRAME.halo, 0, 128, 0, 64, 64);

  drawChannel(ctx, 192, 0, 64);
  texture.add(POWERUP_ITEM_FX_FRAME.channel, 0, 192, 0, 64, 64);

  drawShadow(ctx, 128, 64, 64);
  texture.add(POWERUP_ITEM_FX_FRAME.shadow, 0, 128, 64, 64, 64);

  drawGlint(ctx, 192, 64, 32);
  texture.add(POWERUP_ITEM_FX_FRAME.glint, 0, 192, 64, 32, 32);

  texture.refresh();
  return texture;
}

/**
 * The common ground signature: three arcs with small bright heads and tick marks in the gaps.
 * White on transparent; the GPU member tints it with the pickup colour.
 */
function drawRing(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const radius = size / 2 - 9;
  const gap = Math.PI * 2 / 3;
  ctx.save();
  ctx.lineCap = 'round';
  // Soft outer light, then a crisp core; both stay inside the frame.
  for (const [width, alpha, blur] of [[9, 0.24, 7], [4.6, 0.6, 2], [2.4, 1, 0]] as const) {
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = width;
    ctx.shadowColor = 'rgba(255,255,255,0.8)';
    ctx.shadowBlur = blur;
    for (let arc = 0; arc < 3; arc += 1) {
      const start = arc * gap + 0.2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, start, start + gap - 0.4);
      ctx.stroke();
    }
  }
  ctx.shadowBlur = 0;
  for (let arc = 0; arc < 3; arc += 1) {
    // Tick in the gap and a bright head at the leading end of each arc.
    const tick = arc * gap;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(cx + Math.cos(tick) * radius, cy + Math.sin(tick) * radius, 1.6, 0, Math.PI * 2);
    ctx.fill();
    const head = arc * gap + gap - 0.2;
    const glow = ctx.createRadialGradient(
      cx + Math.cos(head) * radius, cy + Math.sin(head) * radius, 0,
      cx + Math.cos(head) * radius, cy + Math.sin(head) * radius, 6,
    );
    glow.addColorStop(0, 'rgba(255,255,255,1)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx + Math.cos(head) * radius - 6, cy + Math.sin(head) * radius - 6, 12, 12);
  }
  // Faint inner guide ring keeps the circle legible at small sizes.
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawChannel(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const radius = size / 2 * POWERUP_ITEM_ART.channelRadiusRatio;
  const gradient = ctx.createRadialGradient(cx, cy, radius - 7, cx, cy, radius + 7);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.36, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.64, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, size, size);
}

function drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
  gradient.addColorStop(0, 'rgba(0,0,0,0.92)');
  gradient.addColorStop(0.55, 'rgba(0,0,0,0.78)');
  gradient.addColorStop(0.8, 'rgba(0,0,0,0.3)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, size, size);
}

function drawGlint(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const half = size / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,1)';
  for (const [length, width] of [[half, 1.6], [half * 0.55, 1.1]] as const) {
    const diagonal = length !== half;
    for (let arm = 0; arm < 4; arm += 1) {
      const angle = arm * Math.PI / 2 + (diagonal ? Math.PI / 4 : 0);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * length, cy + Math.sin(angle) * length);
      ctx.lineTo(cx + Math.cos(angle + Math.PI / 2) * width, cy + Math.sin(angle + Math.PI / 2) * width);
      ctx.lineTo(cx - Math.cos(angle + Math.PI / 2) * width, cy - Math.sin(angle + Math.PI / 2) * width);
      ctx.closePath();
      ctx.globalAlpha = diagonal ? 0.55 : 1;
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, half * 0.45);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.fillRect(x, y, size, size);
  ctx.restore();
}

function drawRadial(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  stops: readonly (readonly [number, number])[],
): void {
  const half = size / 2;
  const gradient = ctx.createRadialGradient(x + half, y + half, 0, x + half, y + half, half);
  for (const [offset, alpha] of stops) gradient.addColorStop(offset, `rgba(255,255,255,${alpha})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, size, size);
}
