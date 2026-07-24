import type * as Phaser from 'phaser';
import { ARENA_HEIGHT, ARENA_OFFSET_X, ARENA_OFFSET_Y, ARENA_WIDTH } from '../config';
import { CAPTURE_THE_BEER_MODE } from '../gameModes';
import type { GameMode } from '../types';
import type { ArenaBuilderResult } from './ArenaBuilder';

const TEX_TERRAIN_SAMPLER = '__leaf_blower_terrain_sampler';

export type TerrainColorSampler = (worldX: number, worldY: number) => number;

export function createArenaTerrainColorSampler(
  scene: Phaser.Scene,
  mode: GameMode,
  arenaResult: ArenaBuilderResult,
): TerrainColorSampler {
  if (scene.textures.exists(TEX_TERRAIN_SAMPLER)) {
    scene.textures.remove(TEX_TERRAIN_SAMPLER);
  }

  const canvasTexture = scene.textures.createCanvas(TEX_TERRAIN_SAMPLER, ARENA_WIDTH, ARENA_HEIGHT) as Phaser.Textures.CanvasTexture;
  const ctx = canvasTexture.context;
  ctx.clearRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

  drawImageFrame(
    scene,
    ctx,
    mode === CAPTURE_THE_BEER_MODE ? 'gras_bg_ctb' : 'gras_bg_dm',
    undefined,
    0,
    0,
    ARENA_WIDTH,
    ARENA_HEIGHT,
  );

  // Der Dirt-Layer ist als RenderTexture gebacken; der Sampler zeichnet stattdessen aus der
  // erhaltenen Kachel-Geometrie in seine eigene CPU-Canvas.
  for (const stamp of arenaResult.dirtStamps) {
    drawDisplayObjectFrame(scene, ctx, stamp.textureKey, stamp.frameName, stamp);
  }

  for (const track of arenaResult.trackObjects) {
    drawTileSprite(scene, ctx, track);
  }

  for (const rect of arenaResult.baseZoneObjects) {
    const left = rect.x - rect.width / 2 - ARENA_OFFSET_X;
    const top = rect.y - rect.height / 2 - ARENA_OFFSET_Y;
    ctx.save();
    ctx.globalAlpha = rect.fillAlpha;
    ctx.fillStyle = colorToCss(rect.fillColor);
    ctx.fillRect(left, top, rect.width, rect.height);
    ctx.restore();
  }

  // Der Decal-Layer ist wie der Dirt-Boden gebacken; auch hier zeichnet der Sampler aus der
  // erhaltenen Stamp-Geometrie statt aus Live-Objekten.
  for (const stamp of arenaResult.decalStamps) {
    drawDisplayObjectFrame(scene, ctx, stamp.textureKey, stamp.frameName, stamp);
  }

  canvasTexture.refresh();
  const pixelData = ctx.getImageData(0, 0, ARENA_WIDTH, ARENA_HEIGHT).data;

  return (worldX: number, worldY: number): number => {
    const localX = Math.round(worldX - ARENA_OFFSET_X);
    const localY = Math.round(worldY - ARENA_OFFSET_Y);
    if (localX < 0 || localY < 0 || localX >= ARENA_WIDTH || localY >= ARENA_HEIGHT) {
      return 0xc9d8b0;
    }

    const index = (localY * ARENA_WIDTH + localX) * 4;
    const alpha = pixelData[index + 3];
    if (alpha <= 4) return 0xc9d8b0;
    return (pixelData[index] << 16) | (pixelData[index + 1] << 8) | pixelData[index + 2];
  };
}

function drawDisplayObjectFrame(
  scene: Phaser.Scene,
  ctx: CanvasRenderingContext2D,
  textureKey: string,
  frameName: string | number | undefined,
  displayObject: { x: number; y: number; displayWidth: number; displayHeight: number; alpha: number },
): void {
  const left = displayObject.x - displayObject.displayWidth / 2 - ARENA_OFFSET_X;
  const top = displayObject.y - displayObject.displayHeight / 2 - ARENA_OFFSET_Y;
  ctx.save();
  ctx.globalAlpha = displayObject.alpha;
  drawImageFrame(scene, ctx, textureKey, frameName, left, top, displayObject.displayWidth, displayObject.displayHeight);
  ctx.restore();
}

function drawTileSprite(
  scene: Phaser.Scene,
  ctx: CanvasRenderingContext2D,
  tileSprite: Phaser.GameObjects.TileSprite,
): void {
  const frame = scene.textures.getFrame(tileSprite.texture.key, tileSprite.frame.name as string | number | undefined);
  if (!frame) return;
  const sourceImage = getFrameSource(frame);
  if (!sourceImage) return;

  const patternCanvas = document.createElement('canvas');
  patternCanvas.width = frame.cutWidth;
  patternCanvas.height = frame.cutHeight;
  const patternCtx = patternCanvas.getContext('2d');
  if (!patternCtx) return;
  patternCtx.drawImage(
    sourceImage,
    frame.cutX,
    frame.cutY,
    frame.cutWidth,
    frame.cutHeight,
    0,
    0,
    frame.cutWidth,
    frame.cutHeight,
  );

  const pattern = ctx.createPattern(patternCanvas, 'repeat');
  if (!pattern) return;

  const left = tileSprite.x - tileSprite.width / 2 - ARENA_OFFSET_X;
  const top = tileSprite.y - tileSprite.height / 2 - ARENA_OFFSET_Y;
  ctx.save();
  ctx.globalAlpha = tileSprite.alpha;
  ctx.fillStyle = pattern;
  ctx.fillRect(left, top, tileSprite.width, tileSprite.height);
  ctx.restore();
}

function drawImageFrame(
  scene: Phaser.Scene,
  ctx: CanvasRenderingContext2D,
  textureKey: string,
  frameName: string | number | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const frame = scene.textures.getFrame(textureKey, frameName);
  if (!frame) return;
  const sourceImage = getFrameSource(frame);
  if (!sourceImage) return;

  ctx.drawImage(
    sourceImage,
    frame.cutX,
    frame.cutY,
    frame.cutWidth,
    frame.cutHeight,
    x,
    y,
    width,
    height,
  );
}

function getFrameSource(frame: Phaser.Textures.Frame): CanvasImageSource | null {
  const source = frame.texture.source[frame.sourceIndex];
  return (source?.image ?? null) as CanvasImageSource | null;
}

function colorToCss(color: number): string {
  const hex = color.toString(16).padStart(6, '0');
  return `#${hex}`;
}