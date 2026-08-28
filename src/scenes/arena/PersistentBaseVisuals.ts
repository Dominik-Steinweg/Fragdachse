import * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH } from '../../config';
import { isCellInsidePersistentBaseZone } from '../../persistentBase/PersistentBaseZone';
import { getPersistentBaseBuildAreaExtentCells } from '../../persistentBase/PersistentBaseCore';
import { registerGraphicsObject } from '../../effects/EffectUtils';
import type { WorldPersistentBaseSite } from '../../world/WorldRuntimeContext';
import type { WorldMetrics } from '../../world/WorldMetrics';

/** Opt-in construction-zone guide for the active persistent base; persistent terrain is streamed elsewhere. */
export class PersistentBaseVisuals {
  private readonly overlay: Phaser.GameObjects.Graphics;
  private lastOverlayKey = '';

  constructor(scene: Phaser.Scene) {
    this.overlay = scene.add.graphics().setDepth(DEPTH.OVERLAY - 4).setVisible(false);
    registerGraphicsObject(scene, 'placementPreview', this.overlay);
  }

  sync(
    site: WorldPersistentBaseSite | null,
    metrics: WorldMetrics | null,
    showOverlay: boolean,
  ): void {
    if (!site || !metrics) {
      this.clear();
      return;
    }
    const { anchor, buildArea } = site;
    const zoneKey = buildArea.kind === 'square'
      ? `${anchor.gridX}:${anchor.gridY}:square:${buildArea.sizeCells}`
      : `${anchor.gridX}:${anchor.gridY}:radius:${buildArea.radiusCells}`;

    const overlayKey = [
      zoneKey,
      metrics.offsetX,
      metrics.offsetY,
      metrics.gridCols,
      metrics.gridRows,
      showOverlay ? 'on' : 'off',
    ].join(':');
    if (overlayKey !== this.lastOverlayKey) {
      this.overlay.clear();
      if (showOverlay) this.drawOverlay(anchor, buildArea, metrics);
      this.overlay.setVisible(showOverlay);
      this.lastOverlayKey = overlayKey;
    }
  }

  clear(): void {
    this.overlay.clear().setVisible(false);
    this.lastOverlayKey = '';
  }

  destroy(): void {
    this.clear();
    this.overlay.destroy();
  }

  private drawOverlay(
    anchor: { gridX: number; gridY: number },
    buildArea: WorldPersistentBaseSite['buildArea'],
    metrics: WorldMetrics,
  ): void {
    const extent = getPersistentBaseBuildAreaExtentCells(buildArea);
    this.overlay.fillStyle(0x8fda83, 0.08);
    this.overlay.lineStyle(1, 0xb4ee9d, 0.42);
    for (let gridY = Math.max(0, anchor.gridY - extent); gridY <= Math.min(metrics.gridRows - 1, anchor.gridY + extent); gridY += 1) {
      for (let gridX = Math.max(0, anchor.gridX - extent); gridX <= Math.min(metrics.gridCols - 1, anchor.gridX + extent); gridX += 1) {
        if (!isCellInsidePersistentBaseZone(gridX - anchor.gridX, gridY - anchor.gridY, buildArea)) continue;
        const x = metrics.offsetX + gridX * CELL_SIZE;
        const y = metrics.offsetY + gridY * CELL_SIZE;
        this.overlay.fillRect(x, y, CELL_SIZE, CELL_SIZE);
        this.overlay.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
      }
    }
  }
}
