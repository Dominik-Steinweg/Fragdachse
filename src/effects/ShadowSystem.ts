import Phaser from 'phaser';
import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CELL_SIZE,
} from '../config';
import type { ArenaBuilderResult } from '../arena/ArenaBuilder';
import type { PlayerEntity } from '../entities/PlayerEntity';
import { TRAIN } from '../train/TrainConfig';
import type { ArenaLayout, SyncedPlaceableRock, SyncedTrainState } from '../types';
import {
  getProjectileShadowConfig,
  SHADOW_CASTERS,
  type ShadowCasterConfig,
  type ShadowProjectileSample,
  WORLD_SHADOW_CONFIG,
} from './ShadowConfig';

interface ShadowLayerBucket {
  readonly staticGraphics: Phaser.GameObjects.Graphics;
  readonly dynamicGraphics: Phaser.GameObjects.Graphics;
}

export class ShadowSystem {
  private readonly layers = new Map<string, ShadowLayerBucket>();

  constructor(
    private readonly scene: Phaser.Scene,
    private arenaMask: Phaser.Display.Masks.GeometryMask | null = null,
  ) {}

  setArenaMask(mask: Phaser.Display.Masks.GeometryMask | null): void {
    this.arenaMask = mask;
    for (const bucket of this.layers.values()) {
      this.applyMask(bucket.staticGraphics);
      this.applyMask(bucket.dynamicGraphics);
    }
  }

  rebuildArenaStaticShadows(
    layout: ArenaLayout | null,
    arenaResult: ArenaBuilderResult | null,
    runtimeRocks: readonly SyncedPlaceableRock[] = [],
  ): void {
    this.clearStatic();
    if (!layout || !arenaResult) return;

    const runtimeById = new Map<number, SyncedPlaceableRock>();
    for (const rock of runtimeRocks) {
      runtimeById.set(rock.id, rock);
    }

    for (let id = 0; id < layout.rocks.length; id += 1) {
      const rockObject = arenaResult.rockObjects[id];
      if (!rockObject?.active) continue;

      const cell = layout.rocks[id];
      const runtime = runtimeById.get(id);
      const preset = runtime?.kind === 'turret' ? SHADOW_CASTERS.turret : SHADOW_CASTERS.rock;
      const worldX = ARENA_OFFSET_X + cell.gridX * CELL_SIZE + CELL_SIZE / 2;
      const worldY = ARENA_OFFSET_Y + cell.gridY * CELL_SIZE + CELL_SIZE / 2;
      this.drawFootprint(this.getLayer(preset.layerDepth).staticGraphics, worldX, worldY, preset);
    }

    for (const tree of layout.trees) {
      const worldX = ARENA_OFFSET_X + tree.gridX * CELL_SIZE + CELL_SIZE / 2;
      const worldY = ARENA_OFFSET_Y + tree.gridY * CELL_SIZE + CELL_SIZE / 2;
      this.drawFootprint(this.getLayer(SHADOW_CASTERS.trunk.layerDepth).staticGraphics, worldX, worldY, SHADOW_CASTERS.trunk);
      this.drawFootprint(this.getLayer(SHADOW_CASTERS.canopy.layerDepth).staticGraphics, worldX, worldY, SHADOW_CASTERS.canopy);
    }
  }

  syncDynamicShadows(
    players: readonly PlayerEntity[],
    projectiles: readonly ShadowProjectileSample[],
    train: SyncedTrainState | null,
  ): void {
    this.clearDynamic();

    for (const player of players) {
      const sprite = player.sprite;
      if (!sprite.active || !sprite.visible) continue;
      const burrowPhase = player.getBurrowPhase();
      if (burrowPhase === 'underground' || burrowPhase === 'trapped') continue;

      this.drawFootprint(
        this.getLayer(SHADOW_CASTERS.player.layerDepth).dynamicGraphics,
        sprite.x,
        sprite.y,
        SHADOW_CASTERS.player,
        SHADOW_CASTERS.player.footprintWidthPx * Math.abs(sprite.scaleX || 1),
        SHADOW_CASTERS.player.footprintHeightPx * Math.abs(sprite.scaleY || 1),
      );
    }

    for (const projectile of projectiles) {
      const preset = getProjectileShadowConfig(projectile.style);
      if (!preset?.enabled) continue;

      const sizeScale = Phaser.Math.Clamp(projectile.size / 18, 0.75, 1.45);
      this.drawFootprint(
        this.getLayer(preset.layerDepth).dynamicGraphics,
        projectile.x,
        projectile.y,
        preset,
        preset.footprintWidthPx * sizeScale,
        preset.footprintHeightPx * sizeScale,
      );
    }

    if (train?.alive) {
      this.drawTrainShadow(train);
    }
  }

  clear(): void {
    for (const bucket of this.layers.values()) {
      bucket.staticGraphics.clear();
      bucket.dynamicGraphics.clear();
    }
  }

  destroy(): void {
    for (const bucket of this.layers.values()) {
      bucket.staticGraphics.destroy();
      bucket.dynamicGraphics.destroy();
    }
    this.layers.clear();
  }

  private clearStatic(): void {
    for (const bucket of this.layers.values()) {
      bucket.staticGraphics.clear();
    }
  }

  private clearDynamic(): void {
    for (const bucket of this.layers.values()) {
      bucket.dynamicGraphics.clear();
    }
  }

  private drawTrainShadow(train: SyncedTrainState): void {
    const locoPreset = SHADOW_CASTERS.trainLoco;
    const wagonPreset = SHADOW_CASTERS.trainWagon;
    const yPositions = this.computeTrainSegmentYs(train.y, train.dir);

    this.drawFootprint(
      this.getLayer(locoPreset.layerDepth).dynamicGraphics,
      train.x,
      yPositions[0],
      locoPreset,
      locoPreset.footprintWidthPx,
      locoPreset.footprintHeightPx,
    );

    for (let index = 1; index < yPositions.length; index += 1) {
      this.drawFootprint(
        this.getLayer(wagonPreset.layerDepth).dynamicGraphics,
        train.x,
        yPositions[index],
        wagonPreset,
        wagonPreset.footprintWidthPx,
        wagonPreset.footprintHeightPx,
      );
    }
  }

  private computeTrainSegmentYs(locoY: number, direction: 1 | -1): number[] {
    const heights = [TRAIN.LOCO_HEIGHT, ...new Array(TRAIN.WAGON_COUNT).fill(TRAIN.WAGON_HEIGHT)];
    const ys: number[] = [locoY];
    let previousY = locoY;
    let previousHeight = heights[0];

    for (let index = 1; index < heights.length; index += 1) {
      const height = heights[index];
      const gap = previousHeight / 2 + TRAIN.SEGMENT_GAP + height / 2;
      previousY -= direction * gap;
      ys.push(previousY);
      previousHeight = height;
    }

    return ys;
  }

  private drawFootprint(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    preset: ShadowCasterConfig,
    width = preset.footprintWidthPx,
    height = preset.footprintHeightPx,
  ): void {
    const maxExtent = Math.max(width, height) * 0.5
      + (preset.airborneHeightPx ?? 0)
      + preset.castHeightPx * preset.stretch
      + preset.softnessPx
      + 16;
    if (!this.isVisibleInArena(x, y, maxExtent)) return;

    const steps = Math.max(1, preset.blurLayers);
    const denominator = Math.max(1, steps - 1);
    const dir = WORLD_SHADOW_CONFIG.lightDirection;
    const airborneHeight = preset.airborneHeightPx ?? 0;
    const useAirborneGap = airborneHeight > 0;

    for (let step = steps - 1; step >= 0; step -= 1) {
      const t = step / denominator;
      const offsetScale = useAirborneGap
        ? airborneHeight + preset.castHeightPx * (0.14 + t * preset.stretch)
        : preset.castHeightPx * (0.28 + t * preset.stretch);
      const inflate = preset.inflatePx + preset.softnessPx * t;
      const alpha = preset.opacity * (0.28 + (1 - t) * 0.72) / steps;
      const drawX = x + dir.x * offsetScale;
      const drawY = y + dir.y * offsetScale;
      const drawWidth = Math.max(1, width + inflate * 2);
      const drawHeight = Math.max(1, height + inflate * 2);
      this.fillShape(graphics, preset.shape, drawX, drawY, drawWidth, drawHeight, alpha);
    }
  }

  private fillShape(
    graphics: Phaser.GameObjects.Graphics,
    shape: ShadowCasterConfig['shape'],
    x: number,
    y: number,
    width: number,
    height: number,
    alpha: number,
  ): void {
    graphics.fillStyle(WORLD_SHADOW_CONFIG.color, alpha);

    switch (shape) {
      case 'cell':
        graphics.fillRect(x - width / 2, y - height / 2, width, height);
        return;
      case 'circle':
        graphics.fillCircle(x, y, Math.max(width, height) * 0.5);
        return;
      case 'capsule': {
        const radius = Math.min(width, height) * 0.46;
        graphics.fillRoundedRect(x - width / 2, y - height / 2, width, height, radius);
        return;
      }
      case 'ellipse':
      default:
        graphics.fillEllipse(x, y, width, height);
    }
  }

  private getLayer(depth: number): ShadowLayerBucket {
    const key = depth.toFixed(3);
    const existing = this.layers.get(key);
    if (existing) return existing;

    const staticGraphics = this.scene.add.graphics();
    staticGraphics.setDepth(depth);
    staticGraphics.setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.applyMask(staticGraphics);

    const dynamicGraphics = this.scene.add.graphics();
    dynamicGraphics.setDepth(depth + 0.001);
    dynamicGraphics.setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.applyMask(dynamicGraphics);

    const bucket: ShadowLayerBucket = { staticGraphics, dynamicGraphics };
    this.layers.set(key, bucket);
    return bucket;
  }

  private applyMask(graphics: Phaser.GameObjects.Graphics): void {
    if (this.arenaMask) {
      graphics.setMask(this.arenaMask);
    } else {
      graphics.clearMask(false);
    }
  }

  private isVisibleInArena(x: number, y: number, margin: number): boolean {
    const bounds = WORLD_SHADOW_CONFIG.arenaBounds;
    return x + margin >= bounds.minX
      && x - margin <= bounds.maxX
      && y + margin >= bounds.minY
      && y - margin <= bounds.maxY;
  }
}