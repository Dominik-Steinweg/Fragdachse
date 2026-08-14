import type * as Phaser from 'phaser';
import { ARENA_HEIGHT, ARENA_OFFSET_X, ARENA_OFFSET_Y, ARENA_WIDTH } from '../config';
import type { GameMode } from '../types';
import type { ArenaBuilderResult } from './ArenaBuilder';
import { resolveArenaBackgroundSpec } from './ArenaBackground';

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

  const background = resolveArenaBackgroundSpec(mode, ARENA_WIDTH);
  const backgroundFrame = scene.textures.getFrame(background.textureKey);
  if (backgroundFrame) {
    drawRepeatedImageFrameRegion(
      scene,
      ctx,
      background.textureKey,
      undefined,
      0,
      0,
      backgroundFrame.cutWidth,
      backgroundFrame.cutHeight,
      0,
      0,
      ARENA_WIDTH,
      ARENA_HEIGHT,
    );
  }

  // Die Feinschicht liegt in der Szene als Multiply-TileSprite über dem Gras. Canvas' 'multiply'
  // entspricht Phasers Multiply-Blend, der Sampler bildet die Grasfarbe damit exakt nach – sonst
  // läge er um den mittleren Multiply-Verlust der Kachel zu hell.
  const detailFrame = scene.textures.getFrame(background.detailTextureKey);
  if (backgroundFrame && detailFrame) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = background.detailAlpha;
    drawRepeatedImageFrameRegion(
      scene,
      ctx,
      background.detailTextureKey,
      undefined,
      0,
      0,
      detailFrame.cutWidth,
      detailFrame.cutHeight,
      0,
      0,
      ARENA_WIDTH,
      ARENA_HEIGHT,
    );
    ctx.restore();
  }

  // Der Dirt-Layer ist als RenderTexture gebacken; der Sampler zeichnet stattdessen aus der
  // erhaltenen Kachel-Geometrie in seine eigene CPU-Canvas.
  for (const stamp of arenaResult.dirtStamps) {
    drawDisplayObjectFrame(scene, ctx, stamp.textureKey, stamp.frameName, stamp);
  }

  // Die Moosschicht liegt zwischen Dirt und Gleisen (DEPTH.GROUND_COVER) und wird hier in genau
  // dieser Reihenfolge nachgezogen. Ohne sie meldete der Sampler unter jedem Fleck weiterhin die
  // reine Dirt- bzw. Grasfarbe.
  for (const stamp of arenaResult.groundCoverStamps) {
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
  displayObject: {
    x: number;
    y: number;
    displayWidth: number;
    displayHeight: number;
    rotation: number;
    alpha: number;
    mirrorX?: boolean;
    mirrorY?: boolean;
  },
): void {
  ctx.save();
  ctx.globalAlpha = displayObject.alpha;
  ctx.translate(displayObject.x - ARENA_OFFSET_X, displayObject.y - ARENA_OFFSET_Y);
  ctx.rotate(displayObject.rotation);
  // Skalieren nach dem Drehen: das ist die Reihenfolge der Phaser-Transformation (T·R·S). Ohne
  // die Spiegelung laese der Sampler die Farbe des ungespiegelten Flecks.
  if (displayObject.mirrorX || displayObject.mirrorY) {
    ctx.scale(displayObject.mirrorX ? -1 : 1, displayObject.mirrorY ? -1 : 1);
  }
  drawImageFrame(
    scene,
    ctx,
    textureKey,
    frameName,
    -displayObject.displayWidth / 2,
    -displayObject.displayHeight / 2,
    displayObject.displayWidth,
    displayObject.displayHeight,
  );
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

function drawImageFrameRegion(
  scene: Phaser.Scene,
  ctx: CanvasRenderingContext2D,
  textureKey: string,
  frameName: string | number | undefined,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
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
    frame.cutX + sourceX,
    frame.cutY + sourceY,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height,
  );
}

function drawRepeatedImageFrameRegion(
  scene: Phaser.Scene,
  ctx: CanvasRenderingContext2D,
  textureKey: string,
  frameName: string | number | undefined,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (sourceWidth <= 0 || sourceHeight <= 0 || width <= 0 || height <= 0) return;

  for (let offsetY = 0; offsetY < height; offsetY += sourceHeight) {
    const sliceHeight = Math.min(sourceHeight, height - offsetY);
    for (let offsetX = 0; offsetX < width; offsetX += sourceWidth) {
      const sliceWidth = Math.min(sourceWidth, width - offsetX);
      drawImageFrameRegion(
        scene,
        ctx,
        textureKey,
        frameName,
        sourceX,
        sourceY,
        sliceWidth,
        sliceHeight,
        x + offsetX,
        y + offsetY,
        sliceWidth,
        sliceHeight,
      );
    }
  }
}

function getFrameSource(frame: Phaser.Textures.Frame): CanvasImageSource | null {
  const source = frame.texture.source[frame.sourceIndex];
  return (source?.image ?? null) as CanvasImageSource | null;
}

function colorToCss(color: number): string {
  const hex = color.toString(16).padStart(6, '0');
  return `#${hex}`;
}
