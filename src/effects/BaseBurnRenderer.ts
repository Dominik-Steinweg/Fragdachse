import type * as Phaser from 'phaser';
import { CELL_SIZE } from '../config';
import type { BaseEntity } from '../entities/BaseEntity';
import type { EntityBurnGpuController } from './EntityBurnGpuController';
import { EntityBurnRenderer } from './EntityBurnRenderer';
import type { WorldMetrics } from '../world/WorldMetrics';
import type { LightingSystem } from './LightingSystem';

/** Reuses the shared entity-flame GPU backend along the actual, possibly concave footprint. */
export class BaseBurnRenderer {
  private readonly flames = new Map<string, EntityBurnRenderer>();
  constructor(private readonly scene: Phaser.Scene, private readonly gpu: EntityBurnGpuController) {}

  sync(bases: readonly BaseEntity[], metrics: WorldMetrics, lighting: LightingSystem | null): void {
    const seen = new Set<string>();
    for (const base of bases) {
      if (!base.isVoidBurning()) continue;
      for (const cell of base.spec.cells) {
        const key = `${base.id}:${cell.gridX}:${cell.gridY}`;
        seen.add(key);
        let flame = this.flames.get(key);
        if (!flame) {
          flame = new EntityBurnRenderer(this.scene, this.gpu);
          flame.setLightingSystem(lighting, `base-burn:${key}`);
          this.flames.set(key, flame);
        }
        flame.sync(metrics.offsetX + (cell.gridX + 0.5) * CELL_SIZE,
          metrics.offsetY + (cell.gridY + 0.5) * CELL_SIZE, CELL_SIZE, 2, true, 'void');
      }
    }
    for (const [key, flame] of this.flames) {
      if (!seen.has(key)) { flame.destroy(); this.flames.delete(key); }
    }
  }

  clear(): void { for (const flame of this.flames.values()) flame.destroy(); this.flames.clear(); }
}
