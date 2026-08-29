import * as Phaser from 'phaser';
import { CELL_SIZE } from '../../config';
import { resolvePersistentBaseCoreCells } from '../../persistentBase/PersistentBaseCore';
import type { PersistentBaseVisualSite } from '../../persistentBase/PersistentBasePresentation';
import type { WorldMetrics } from '../../world/WorldMetrics';
import type { LightingSystem } from '../../effects/LightingSystem';
import { BASE_LIGHT_COLOR, getBaseLightSpots, createBaseSurfaceImages } from '../../entities/BaseVisuals';

const PREVIEW_LIGHT_PREFIX = 'persistent-base-preview';

/** Rein visuelle, nicht kollidierende Darstellung des kanonischen Persistent-Base-Kerns. */
export class PersistentBasePreviewRenderer {
  private readonly cellImages: Phaser.GameObjects.Image[] = [];
  private readonly lightKeys = new Set<string>();
  private lightSpots: readonly { readonly x: number; readonly y: number; readonly radius: number }[] = [];
  private currentKey = '';
  private active = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly lighting: LightingSystem,
  ) {}

  sync(
    preview: PersistentBaseVisualSite | null,
    metrics: WorldMetrics | null,
  ): void {
    const nextKey = preview && metrics
      ? [
        preview.anchor.gridX,
        preview.anchor.gridY,
        preview.orientation,
        metrics.offsetX,
        metrics.offsetY,
        metrics.gridCols,
        metrics.gridRows,
      ].join(':')
      : 'none';
    if (nextKey === this.currentKey) return;

    this.clear();
    this.currentKey = nextKey;
    if (!preview || !metrics) return;

    const coreCells = resolvePersistentBaseCoreCells(preview.anchor, preview.orientation);
    const surfaceCells = coreCells.filter((cell) => cell.domain === 'base-surface');
    this.cellImages.push(...createBaseSurfaceImages(this.scene, surfaceCells, metrics, 'base'));
    const originX = metrics.offsetX + (preview.anchor.gridX - 2) * CELL_SIZE;
    const originY = metrics.offsetY + (preview.anchor.gridY - 2) * CELL_SIZE;
    this.lightSpots = getBaseLightSpots({
      x: originX,
      y: originY,
      width: CELL_SIZE * 5,
      height: CELL_SIZE * 5,
    });
    this.active = true;
  }

  /** Hält Preview-Lichter wie die bestehenden Basislichter pro Frame am Leben. */
  syncLights(inArena: boolean): void {
    if (!inArena || !this.active) {
      this.releaseLights();
      return;
    }
    const seen = new Set<string>();
    for (let index = 0; index < this.lightSpots.length; index += 1) {
      const spot = this.lightSpots[index];
      const key = `${PREVIEW_LIGHT_PREFIX}:${index}`;
      this.lighting.setLight(key, 'baseGlow', spot.x, spot.y, {
        radiusPx: spot.radius,
        color: BASE_LIGHT_COLOR,
      });
      seen.add(key);
    }
    for (const key of this.lightKeys) {
      if (!seen.has(key)) this.lighting.releaseLight(key);
    }
    this.lightKeys.clear();
    for (const key of seen) this.lightKeys.add(key);
  }

  clear(): void {
    for (const image of this.cellImages) image.destroy();
    this.cellImages.length = 0;
    this.releaseLights();
    this.lightSpots = [];
    this.active = false;
    this.currentKey = '';
  }

  destroy(): void {
    this.clear();
  }

  private releaseLights(): void {
    for (const key of this.lightKeys) this.lighting.releaseLight(key);
    this.lightKeys.clear();
  }
}
