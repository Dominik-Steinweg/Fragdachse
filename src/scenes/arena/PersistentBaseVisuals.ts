import * as Phaser from 'phaser';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE, DEPTH, GRID_COLS, GRID_ROWS } from '../../config';
import type { BaseSpec } from '../../arena/BaseRegistry';
import type { CoopDefenseMapPersistentBaseConfig } from '../../config/coopDefenseMaps';
import { getPersistentBaseAnchor, isCellInsidePersistentBaseZone } from '../../persistentBase/PersistentBaseZone';
import { registerGraphicsObject } from '../../effects/EffectUtils';

/** Opt-in construction-zone guide for the active persistent base; persistent terrain is streamed elsewhere. */
export class PersistentBaseVisuals {
  private readonly overlay: Phaser.GameObjects.Graphics;
  private lastOverlayKey = '';

  constructor(scene: Phaser.Scene) {
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
    const anchor = getPersistentBaseAnchor(base);
    const zoneKey = `${anchor.gridX}:${anchor.gridY}:${radiusCells}`;

    const overlayKey = `${zoneKey}:${showOverlay ? 'on' : 'off'}`;
    if (overlayKey !== this.lastOverlayKey) {
      this.overlay.clear();
      if (showOverlay) this.drawOverlay(anchor, radiusCells);
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

  private drawOverlay(anchor: { gridX: number; gridY: number }, radiusCells: number): void {
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
