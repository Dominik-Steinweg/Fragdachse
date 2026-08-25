import * as Phaser from 'phaser';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE, DEPTH, GRID_COLS, GRID_ROWS } from '../../config';
import { AutoTiler, DIRT_AUTOTILE } from '../../arena/AutoTiler';
import type { BaseSpec } from '../../arena/BaseRegistry';
import type { CoopDefenseMapPersistentBaseConfig } from '../../config/coopDefenseMaps';
import { isCellInsidePersistentBaseZone } from '../../persistentBase/PersistentBaseZone';
import type { PersistentBaseAnchor } from '../../persistentBase/PersistentBaseTypes';
import { registerGraphicsObject } from '../../effects/EffectUtils';

/** Gravel layer and the opt-in construction-zone guide for the active persistent base. */
export class PersistentBaseVisuals {
  private readonly overlay: Phaser.GameObjects.Graphics;
  private gravelImages: Phaser.GameObjects.Image[] = [];
  private lastZoneKey = '';
  private lastOverlayKey = '';

  constructor(private readonly scene: Phaser.Scene) {
    this.overlay = scene.add.graphics().setDepth(DEPTH.OVERLAY - 4).setVisible(false);
    registerGraphicsObject(scene, 'placementPreview', this.overlay);
  }

  sync(
    config: CoopDefenseMapPersistentBaseConfig | undefined,
    bases: readonly BaseSpec[],
    radiusCells: number,
    showOverlay: boolean,
  ): void {
    const base = config ? bases.find((candidate) => candidate.id === config.baseId) : undefined;
    if (!base || !Number.isFinite(radiusCells) || radiusCells < 0) {
      this.clear();
      return;
    }
    const anchor: PersistentBaseAnchor = {
      gridX: base.anchorGridX ?? Math.floor((base.region.minGridX + base.region.maxGridX) / 2),
      gridY: base.anchorGridY ?? Math.floor((base.region.minGridY + base.region.maxGridY) / 2),
    };
    const zoneKey = `${anchor.gridX}:${anchor.gridY}:${radiusCells}`;
    if (zoneKey !== this.lastZoneKey) {
      this.rebuildGravel(anchor, radiusCells);
      this.lastZoneKey = zoneKey;
    }

    const overlayKey = `${zoneKey}:${showOverlay ? 'on' : 'off'}`;
    if (overlayKey !== this.lastOverlayKey) {
      this.overlay.clear();
      if (showOverlay) this.drawOverlay(anchor, radiusCells);
      this.overlay.setVisible(showOverlay);
      this.lastOverlayKey = overlayKey;
    }
  }

  clear(): void {
    for (const image of this.gravelImages) image.destroy();
    this.gravelImages = [];
    this.overlay.clear().setVisible(false);
    this.lastZoneKey = '';
    this.lastOverlayKey = '';
  }

  destroy(): void {
    this.clear();
    this.overlay.destroy();
  }

  private rebuildGravel(anchor: PersistentBaseAnchor, radiusCells: number): void {
    for (const image of this.gravelImages) image.destroy();
    this.gravelImages = [];
    const radius = Math.ceil(radiusCells);
    const cells: Array<{ gridX: number; gridY: number }> = [];
    const occupied = new Set<string>();
    for (let gridY = Math.max(0, anchor.gridY - radius); gridY <= Math.min(GRID_ROWS - 1, anchor.gridY + radius); gridY += 1) {
      for (let gridX = Math.max(0, anchor.gridX - radius); gridX <= Math.min(GRID_COLS - 1, anchor.gridX + radius); gridX += 1) {
        if (!isCellInsidePersistentBaseZone(gridX - anchor.gridX, gridY - anchor.gridY, radiusCells)) continue;
        cells.push({ gridX, gridY });
        occupied.add(`${gridX}:${gridY}`);
      }
    }
    for (const cell of cells) {
      const frame = AutoTiler.getFrame(
        AutoTiler.computeMask(cell.gridX, cell.gridY, (gridX, gridY) => occupied.has(`${gridX}:${gridY}`)),
        DIRT_AUTOTILE,
      );
      const image = this.scene.add.image(
        ARENA_OFFSET_X + cell.gridX * CELL_SIZE + CELL_SIZE / 2,
        ARENA_OFFSET_Y + cell.gridY * CELL_SIZE + CELL_SIZE / 2,
        'kies',
        frame,
      );
      image.setDisplaySize(CELL_SIZE, CELL_SIZE).setDepth(DEPTH.DIRT + 0.04);
      this.gravelImages.push(image);
    }
  }

  private drawOverlay(anchor: PersistentBaseAnchor, radiusCells: number): void {
    const radius = Math.ceil(radiusCells);
    this.overlay.fillStyle(0x8fda83, 0.08);
    this.overlay.lineStyle(1, 0xb4ee9d, 0.42);
    for (let gridY = Math.max(0, anchor.gridY - radius); gridY <= Math.min(GRID_ROWS - 1, anchor.gridY + radius); gridY += 1) {
      for (let gridX = Math.max(0, anchor.gridX - radius); gridX <= Math.min(GRID_COLS - 1, anchor.gridX + radius); gridX += 1) {
        if (!isCellInsidePersistentBaseZone(gridX - anchor.gridX, gridY - anchor.gridY, radiusCells)) continue;
        const x = ARENA_OFFSET_X + gridX * CELL_SIZE;
        const y = ARENA_OFFSET_Y + gridY * CELL_SIZE;
        this.overlay.fillRect(x, y, CELL_SIZE, CELL_SIZE);
        this.overlay.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
      }
    }
  }
}

