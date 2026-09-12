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
    const contains = (gridX: number, gridY: number): boolean => gridX >= 0 && gridY >= 0
      && gridX < metrics.gridCols && gridY < metrics.gridRows
      && isCellInsidePersistentBaseZone(gridX - anchor.gridX, gridY - anchor.gridY, buildArea);
    const border: [number, number, number, number][] = [];
    for (let gridY = Math.max(0, anchor.gridY - extent); gridY <= Math.min(metrics.gridRows - 1, anchor.gridY + extent); gridY += 1) {
      for (let gridX = Math.max(0, anchor.gridX - extent); gridX <= Math.min(metrics.gridCols - 1, anchor.gridX + extent); gridX += 1) {
        if (!contains(gridX, gridY)) continue;
        const x = metrics.offsetX + gridX * CELL_SIZE;
        const y = metrics.offsetY + gridY * CELL_SIZE;
        this.overlay.fillStyle(0x85cbbd, 0.035);
        this.overlay.fillRect(x, y, CELL_SIZE, CELL_SIZE);
        // A quiet centre dot retains the placement rhythm without a grid across the buildings.
        this.overlay.fillStyle(0xc3e6da, 0.28);
        this.overlay.fillRect(x + CELL_SIZE / 2 - 0.75, y + CELL_SIZE / 2 - 0.75, 1.5, 1.5);
        if (!contains(gridX, gridY - 1)) border.push([x, y, x + CELL_SIZE, y]);
        if (!contains(gridX + 1, gridY)) border.push([x + CELL_SIZE, y, x + CELL_SIZE, y + CELL_SIZE]);
        if (!contains(gridX, gridY + 1)) border.push([x + CELL_SIZE, y + CELL_SIZE, x, y + CELL_SIZE]);
        if (!contains(gridX - 1, gridY)) border.push([x, y + CELL_SIZE, x, y]);
      }
    }
    // Only exposed cell edges: the outline matches the authoritative build area, including world clipping.
    const strokeBorder = (width: number, color: number, alpha: number): void => {
      this.overlay.lineStyle(width, color, alpha).beginPath();
      for (const [x1, y1, x2, y2] of border) this.overlay.moveTo(x1, y1).lineTo(x2, y2);
      this.overlay.strokePath();
    };
    strokeBorder(5, 0x60b9a8, 0.08);
    strokeBorder(1.25, 0xafdccc, 0.55);
  }
}
