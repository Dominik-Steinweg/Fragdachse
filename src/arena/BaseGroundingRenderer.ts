import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { BaseVisualCell } from '../entities/BaseVisuals';
import type { WorldMetrics } from '../world/WorldMetrics';
import { baseGroundingTextureKey } from './BaseGroundingConfig';
import { buildBaseGroundingLayout } from './BaseGroundingLayout';

/** Owned by the base presentation; excluded from building shadows and destruction cell indices. */
export class BaseGroundingRenderer {
  private readonly imagesByCell = new Map<number, Phaser.GameObjects.Image[]>();

  constructor(scene: Phaser.Scene, cells: readonly BaseVisualCell[], metrics: WorldMetrics) {
    for (const placement of buildBaseGroundingLayout(cells, metrics)) {
      const image = scene.add.image(placement.x, placement.y, baseGroundingTextureKey(placement.asset))
        .setDisplaySize(placement.width, placement.height)
        .setRotation(placement.rotation)
        .setAlpha(placement.alpha)
        .setDepth(DEPTH.BASE_GROUNDING - (placement.kind === 'soil' ? 0.12 : placement.kind === 'gravel' ? 0.06 : 0));
      if (placement.tint !== undefined) image.setTint(placement.tint);
      let images = this.imagesByCell.get(placement.cellIndex);
      if (!images) this.imagesByCell.set(placement.cellIndex, images = []);
      images.push(image);
    }
  }

  destroyCell(cellIndex: number): void {
    const images = this.imagesByCell.get(cellIndex);
    if (!images) return;
    for (const image of images) image.destroy();
    this.imagesByCell.delete(cellIndex);
  }

  destroy(): void {
    for (const cellIndex of this.imagesByCell.keys()) this.destroyCell(cellIndex);
  }
}
