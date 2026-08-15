import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { SyncedTrainState } from '../types';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import { TRAIN } from './TrainConfig';

const TEX_TRAIN_RB54 = '__train_rb54_material_baked_v1';
const MATERIAL_TILE_SIZE = 192;

const TRAIN_MATERIAL_ASSETS = {
  light: 'train_material_light_top',
  red: 'train_material_red_top',
  dark: 'train_material_dark_top',
  scratches: 'train_overlay_scratches',
  grime: 'train_overlay_grime',
} as const;

interface TrainMaterials {
  readonly light: CanvasImageSource;
  readonly red: CanvasImageSource;
  readonly dark: CanvasImageSource;
  readonly scratches: CanvasImageSource;
  readonly grime: CanvasImageSource;
}

interface MaterialVariation {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly flipX: boolean;
  readonly flipY: boolean;
  readonly materialAlpha: number;
  readonly tint: string;
  readonly tintAlpha: number;
  readonly scratchAlpha: number;
  readonly grimeAlpha: number;
}

interface MaterialBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type PathTracer = (ctx: CanvasRenderingContext2D) => void;

/** Queues the compact runtime copies used by the procedural train bake. */
export function preloadTrainMaterialAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const textureKey of Object.values(TRAIN_MATERIAL_ASSETS)) {
    loader.image(textureKey, `./assets/sprites/train/${textureKey}.png`);
  }
}

/**
 * Client- and host-side renderer for the procedural RB 54 train.
 *
 * Geometry, material fills and wear are baked once into one CanvasTexture. Runtime updates only
 * move and flip a single Image, keeping the previous render cost and network boundary intact.
 */
export class TrainRenderer {
  private readonly image: Phaser.GameObjects.Image;
  private readonly textureCenterOffsetY: number;

  private targetY = 0;
  private displayY = 0;
  private lastDir: 1 | -1 = 1;
  private lastX = 0;
  private lastAlive = false;
  private lastHp = 0;
  private lastMaxHp = 0;

  private audioSystem: GameAudioSystem | null = null;
  private moveLoopHandle: string | null = null;

  constructor(scene: Phaser.Scene) {
    this.textureCenterOffsetY = this.ensureTrainTexture(scene);
    this.image = scene.add.image(0, 0, TEX_TRAIN_RB54)
      .setDepth(DEPTH.TRAIN)
      .setVisible(false);
  }

  setAudioSystem(system: GameAudioSystem): void {
    this.audioSystem = system;
  }

  setTarget(state: SyncedTrainState | null): void {
    if (!state || !state.alive) {
      this.lastAlive = false;
      if (this.moveLoopHandle) {
        this.audioSystem?.stopLoop(this.moveLoopHandle);
        this.moveLoopHandle = null;
      }
      return;
    }
    if (!this.lastAlive) {
      this.displayY = state.y;
      this.moveLoopHandle = this.audioSystem?.startLoop('sfx_train_move', state.x, state.y) ?? null;
    }
    this.targetY = state.y;
    this.lastDir = state.dir;
    this.lastX = state.x;
    this.lastHp = state.hp;
    this.lastMaxHp = state.maxHp;
    this.lastAlive = true;
    if (this.moveLoopHandle) {
      this.audioSystem?.updateLoopPosition(this.moveLoopHandle, state.x, state.y);
    }
  }

  getShadowState(): SyncedTrainState | null {
    if (!this.lastAlive) return null;
    return {
      alive: true,
      x: this.lastX,
      y: this.displayY,
      dir: this.lastDir,
      hp: this.lastHp,
      maxHp: this.lastMaxHp,
    };
  }

  render(lerpFactor: number): void {
    if (!this.lastAlive) {
      this.image.setVisible(false);
      return;
    }

    this.displayY = Phaser.Math.Linear(this.displayY, this.targetY, lerpFactor);
    this.syncImage();
  }

  /** Legacy direct update path used by the host. */
  update(state: SyncedTrainState | null): void {
    if (!state || !state.alive) {
      this.lastAlive = false;
      this.image.setVisible(false);
      if (this.moveLoopHandle) {
        this.audioSystem?.stopLoop(this.moveLoopHandle);
        this.moveLoopHandle = null;
      }
      return;
    }
    if (!this.lastAlive) {
      this.moveLoopHandle = this.audioSystem?.startLoop('sfx_train_move', state.x, state.y) ?? null;
    } else if (this.moveLoopHandle) {
      this.audioSystem?.updateLoopPosition(this.moveLoopHandle, state.x, state.y);
    }
    this.targetY = state.y;
    this.displayY = state.y;
    this.lastDir = state.dir;
    this.lastX = state.x;
    this.lastHp = state.hp;
    this.lastMaxHp = state.maxHp;
    this.lastAlive = true;
    this.syncImage();
  }

  destroy(): void {
    if (this.moveLoopHandle) {
      this.audioSystem?.stopLoop(this.moveLoopHandle);
      this.moveLoopHandle = null;
    }
    if (this.image.active) this.image.destroy();
  }

  private draw(
    ctx: CanvasRenderingContext2D,
    materials: TrainMaterials,
    x: number,
    locoY: number,
    dir: 1 | -1,
  ): void {
    const segYs = this.computeSegYs(locoY, dir);

    for (let i = 1; i <= TRAIN.WAGON_COUNT; i++) {
      this.drawWagon(ctx, materials, x, segYs[i], TRAIN.VISUAL_WIDTH, TRAIN.WAGON_HEIGHT, i);
    }
    this.drawLoco(ctx, materials, x, segYs[0], TRAIN.VISUAL_WIDTH, TRAIN.LOCO_HEIGHT, dir);
  }

  private drawLoco(
    ctx: CanvasRenderingContext2D,
    materials: TrainMaterials,
    cx: number,
    cy: number,
    width: number,
    height: number,
    dir: 1 | -1,
  ): void {
    const x0 = cx - width * 0.5;
    const y0 = cy - height * 0.5;
    const sideBandWidth = 8;
    const roofWidth = width - sideBandWidth * 2;
    const roofHeight = height - 12;
    const roofX = cx - roofWidth * 0.5;
    const roofY = cy - roofHeight * 0.5;
    const noseHeight = 18;
    const noseY = dir > 0 ? y0 + height - noseHeight : y0;
    const cabGlassHeight = 12;
    const cabGlassY = dir > 0 ? noseY + 2 : noseY + noseHeight - cabGlassHeight - 2;
    const variation = this.createMaterialVariation(0);
    const bodyBounds = { x: x0, y: y0, width, height };

    this.drawCapsuleShadow(ctx, cx, cy, width, height);
    this.fillCapsuleMaterial(ctx, materials.red, cx, cy, width, height, '#941b20', variation);
    this.fillRectMaterial(ctx, materials.red, x0 + 2, y0 + 10, sideBandWidth, height - 20, '#741318', variation);
    this.fillRectMaterial(ctx, materials.red, x0 + width - sideBandWidth - 2, y0 + 10, sideBandWidth, height - 20, '#741318', variation);
    this.fillCapsuleMaterial(ctx, materials.light, cx, cy, roofWidth, roofHeight, '#b9b7ae', variation);
    this.fillRectMaterial(ctx, materials.dark, roofX, noseY, roofWidth, noseHeight, '#30383d', variation);
    this.fillRectMaterial(ctx, materials.dark, cx - 6, roofY + 10, 12, roofHeight - noseHeight - 20, '#293238', variation);
    this.fillRectMaterial(ctx, materials.dark, cx - 14, cy - 6, 28, 6, '#252d31', variation);
    this.fillRectMaterial(ctx, materials.dark, roofX + 8, cabGlassY, roofWidth - 16, cabGlassHeight, '#1f3038', variation);

    ctx.save();
    ctx.fillStyle = 'rgba(73, 116, 130, 0.34)';
    ctx.fillRect(roofX + 8, cabGlassY, roofWidth - 16, cabGlassHeight);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.fillRect(roofX + 3, roofY + 3, roofWidth - 6, 2);
    ctx.restore();

    this.drawWearOverlays(ctx, materials, bodyBounds, variation, (target) => {
      this.traceCapsule(target, cx, cy, width, height);
    });
    this.strokeCapsule(ctx, cx, cy, width, height, 2, 'rgba(20, 24, 25, 0.9)');
    this.strokeCapsule(ctx, cx, cy, roofWidth, roofHeight, 1, 'rgba(48, 54, 55, 0.72)');
    ctx.save();
    ctx.strokeStyle = 'rgba(16, 25, 29, 0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(roofX + 8, cabGlassY, roofWidth - 16, cabGlassHeight);
    ctx.restore();
  }

  private drawWagon(
    ctx: CanvasRenderingContext2D,
    materials: TrainMaterials,
    cx: number,
    cy: number,
    width: number,
    height: number,
    index: number,
  ): void {
    const x0 = cx - width * 0.5;
    const y0 = cy - height * 0.5;
    const sideBandWidth = 7;
    const roofInset = 10;
    const roofWidth = width - sideBandWidth * 2;
    const roofHeight = height - roofInset;
    const roofX = cx - roofWidth * 0.5;
    const roofY = cy - roofHeight * 0.5;
    const equipmentOffset = index % 3;
    const variation = this.createMaterialVariation(index);
    const bodyBounds = { x: x0, y: y0, width, height };

    this.drawCapsuleShadow(ctx, cx, cy, width, height);
    this.fillCapsuleMaterial(ctx, materials.red, cx, cy, width, height, '#941b20', variation);
    this.fillRectMaterial(ctx, materials.red, x0 + 2, y0 + 8, sideBandWidth, height - 16, '#741318', variation);
    this.fillRectMaterial(ctx, materials.red, x0 + width - sideBandWidth - 2, y0 + 8, sideBandWidth, height - 16, '#741318', variation);
    this.fillCapsuleMaterial(ctx, materials.light, cx, cy, roofWidth, roofHeight, '#b9b7ae', variation);
    this.fillRectMaterial(ctx, materials.light, roofX + 4, roofY + 4, roofWidth - 8, 5, '#d0cdc2', variation);
    this.fillRectMaterial(ctx, materials.dark, cx - 4, roofY + 12 + equipmentOffset * 4, 8, 12, '#2a3236', variation);
    this.fillRectMaterial(ctx, materials.dark, cx - 10, cy - 3, 20, 5, '#252d31', variation);
    this.fillRectMaterial(ctx, materials.dark, roofX + 6, y0 + height - 14, roofWidth - 12, 4, '#384047', variation);

    this.drawWearOverlays(ctx, materials, bodyBounds, variation, (target) => {
      this.traceCapsule(target, cx, cy, width, height);
    });

    this.strokeCapsule(ctx, cx, cy, width, height, 2, 'rgba(20, 24, 25, 0.9)');
    this.strokeCapsule(ctx, cx, cy, roofWidth, roofHeight, 1, 'rgba(52, 57, 56, 0.68)');
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(roofX + 3, roofY + 5);
    ctx.lineTo(roofX + 3, roofY + roofHeight - 5);
    ctx.stroke();
    ctx.restore();
  }

  private fillCapsuleMaterial(
    ctx: CanvasRenderingContext2D,
    image: CanvasImageSource,
    cx: number,
    cy: number,
    width: number,
    height: number,
    fallbackColor: string,
    variation: MaterialVariation,
  ): void {
    this.fillMaterial(ctx, image, {
      x: cx - width * 0.5,
      y: cy - height * 0.5,
      width,
      height,
    }, fallbackColor, variation, (target) => {
      this.traceCapsule(target, cx, cy, width, height);
    });
  }

  private fillRectMaterial(
    ctx: CanvasRenderingContext2D,
    image: CanvasImageSource,
    x: number,
    y: number,
    width: number,
    height: number,
    fallbackColor: string,
    variation: MaterialVariation,
  ): void {
    this.fillMaterial(ctx, image, { x, y, width, height }, fallbackColor, variation, (target) => {
      target.beginPath();
      target.rect(x, y, width, height);
    });
  }

  private fillMaterial(
    ctx: CanvasRenderingContext2D,
    image: CanvasImageSource,
    bounds: MaterialBounds,
    fallbackColor: string,
    variation: MaterialVariation,
    tracePath: PathTracer,
  ): void {
    ctx.save();
    tracePath(ctx);
    ctx.clip();
    ctx.fillStyle = fallbackColor;
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.globalAlpha = variation.materialAlpha;
    this.drawRepeatedMaterial(ctx, image, bounds, variation.offsetX, variation.offsetY, variation.flipX, variation.flipY);
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = variation.tintAlpha;
    ctx.fillStyle = variation.tint;
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.restore();
  }

  private drawWearOverlays(
    ctx: CanvasRenderingContext2D,
    materials: TrainMaterials,
    bounds: MaterialBounds,
    variation: MaterialVariation,
    tracePath: PathTracer,
  ): void {
    ctx.save();
    tracePath(ctx);
    ctx.clip();
    ctx.globalAlpha = variation.grimeAlpha;
    this.drawRepeatedMaterial(
      ctx,
      materials.grime,
      bounds,
      variation.offsetX + 83,
      variation.offsetY + 47,
      !variation.flipX,
      variation.flipY,
      MATERIAL_TILE_SIZE * 1.35,
    );
    ctx.globalAlpha = variation.scratchAlpha;
    this.drawRepeatedMaterial(
      ctx,
      materials.scratches,
      bounds,
      variation.offsetX + 29,
      variation.offsetY + 131,
      variation.flipX,
      !variation.flipY,
      MATERIAL_TILE_SIZE * 1.55,
    );
    ctx.restore();
  }

  private drawRepeatedMaterial(
    ctx: CanvasRenderingContext2D,
    image: CanvasImageSource,
    bounds: MaterialBounds,
    offsetX: number,
    offsetY: number,
    flipX: boolean,
    flipY: boolean,
    tileSize = MATERIAL_TILE_SIZE,
  ): void {
    const startX = bounds.x - this.positiveModulo(offsetX, tileSize) - tileSize;
    const startY = bounds.y - this.positiveModulo(offsetY, tileSize) - tileSize;
    const endX = bounds.x + bounds.width + tileSize;
    const endY = bounds.y + bounds.height + tileSize;

    for (let y = startY; y < endY; y += tileSize) {
      for (let x = startX; x < endX; x += tileSize) {
        ctx.save();
        ctx.translate(x + tileSize * 0.5, y + tileSize * 0.5);
        ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
        ctx.drawImage(image, -tileSize * 0.5, -tileSize * 0.5, tileSize, tileSize);
        ctx.restore();
      }
    }
  }

  private createMaterialVariation(segmentIndex: number): MaterialVariation {
    const seed = (Math.imul(segmentIndex + 17, 0x45d9f3b) ^ 0x9e3779b9) >>> 0;
    return {
      offsetX: (seed >>> 2) & 0xff,
      offsetY: (seed >>> 10) & 0xff,
      flipX: (seed & 0x40000) !== 0,
      flipY: (seed & 0x80000) !== 0,
      materialAlpha: 0.9 + ((seed >>> 20) & 3) * 0.018,
      tint: ['#899286', '#929087', '#828b82', '#958b81'][seed & 3],
      tintAlpha: 0.045 + ((seed >>> 22) & 3) * 0.012,
      scratchAlpha: 0.045 + ((seed >>> 24) & 3) * 0.012,
      grimeAlpha: 0.055 + ((seed >>> 26) & 3) * 0.014,
    };
  }

  private drawCapsuleShadow(ctx: CanvasRenderingContext2D, cx: number, cy: number, width: number, height: number): void {
    ctx.save();
    ctx.shadowColor = 'rgba(10, 14, 13, 0.5)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = 'rgba(20, 24, 23, 0.72)';
    this.traceCapsule(ctx, cx, cy, width, height);
    ctx.fill();
    ctx.restore();
  }

  private strokeCapsule(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    width: number,
    height: number,
    lineWidth: number,
    color: string,
  ): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    this.traceCapsule(ctx, cx, cy, width, height);
    ctx.stroke();
    ctx.restore();
  }

  private traceCapsule(ctx: CanvasRenderingContext2D, cx: number, cy: number, width: number, height: number): void {
    const radius = Math.min(width * 0.5, 12);
    const left = cx - width * 0.5;
    const right = cx + width * 0.5;
    const top = cy - height * 0.5;
    const bottom = cy + height * 0.5;

    ctx.beginPath();
    ctx.moveTo(left, top + radius);
    ctx.quadraticCurveTo(left, top, left + radius, top);
    ctx.lineTo(right - radius, top);
    ctx.quadraticCurveTo(right, top, right, top + radius);
    ctx.lineTo(right, bottom - radius);
    ctx.quadraticCurveTo(right, bottom, right - radius, bottom);
    ctx.lineTo(left + radius, bottom);
    ctx.quadraticCurveTo(left, bottom, left, bottom - radius);
    ctx.closePath();
  }

  private positiveModulo(value: number, modulo: number): number {
    return ((value % modulo) + modulo) % modulo;
  }

  private syncImage(): void {
    this.image
      .setVisible(true)
      .setPosition(
        this.lastX,
        this.displayY + this.lastDir * this.textureCenterOffsetY,
      )
      .setFlipY(this.lastDir < 0);
  }

  /** Builds the complete train once in local texture coordinates and returns its loco offset. */
  private ensureTrainTexture(scene: Phaser.Scene): number {
    const segmentYs = this.computeSegYs(0, 1);
    let minY = -TRAIN.LOCO_HEIGHT * 0.5;
    let maxY = TRAIN.LOCO_HEIGHT * 0.5;
    for (let index = 1; index < segmentYs.length; index += 1) {
      minY = Math.min(minY, segmentYs[index] - TRAIN.WAGON_HEIGHT * 0.5);
      maxY = Math.max(maxY, segmentYs[index] + TRAIN.WAGON_HEIGHT * 0.5);
    }
    const centerOffsetY = (minY + maxY) * 0.5;
    if (scene.textures.exists(TEX_TRAIN_RB54)) return centerOffsetY;

    const padding = 5;
    const width = Math.ceil(TRAIN.VISUAL_WIDTH + padding * 2);
    const height = Math.ceil(maxY - minY + padding * 2);
    const texture = scene.textures.createCanvas(TEX_TRAIN_RB54, width, height)!;
    texture.context.clearRect(0, 0, width, height);
    this.draw(texture.context, this.getTrainMaterials(scene), width * 0.5, padding - minY, 1);
    texture.refresh();
    return centerOffsetY;
  }

  private getTrainMaterials(scene: Phaser.Scene): TrainMaterials {
    const source = (key: string): CanvasImageSource => (
      scene.textures.get(key).getSourceImage() as CanvasImageSource
    );
    return {
      light: source(TRAIN_MATERIAL_ASSETS.light),
      red: source(TRAIN_MATERIAL_ASSETS.red),
      dark: source(TRAIN_MATERIAL_ASSETS.dark),
      scratches: source(TRAIN_MATERIAL_ASSETS.scratches),
      grime: source(TRAIN_MATERIAL_ASSETS.grime),
    };
  }

  /**
   * Mirrors TrainManager.segCenterYs() without taking a gameplay-system dependency.
   * Index 0 is the locomotive; all following entries are wagons behind its direction.
   */
  computeSegYs(locoY: number, dir: 1 | -1): number[] {
    const ys: number[] = [locoY];
    let previousY = locoY;
    let previousHeight = TRAIN.LOCO_HEIGHT;

    for (let index = 0; index < TRAIN.WAGON_COUNT; index += 1) {
      const height = TRAIN.WAGON_HEIGHT;
      const gap = previousHeight * 0.5 + TRAIN.SEGMENT_GAP + height * 0.5;
      previousY -= dir * gap;
      ys.push(previousY);
      previousHeight = height;
    }
    return ys;
  }
}
