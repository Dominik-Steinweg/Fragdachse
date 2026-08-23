import * as Phaser from 'phaser';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE, COLORS, DEPTH } from '../config';
import type { ResolvedCoopDefenseMapMissionProgressConfig } from '../config/coopDefenseMaps';
import type { CoopDefenseMissionProgressPresentationState } from '../types';
import { registerGraphicsObject } from './EffectUtils';

/** Rein prozedurale Weltpresentation fuer Checkpoints und Missionstore. */
export class CoopDefenseMissionProgressRenderer {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private signature = '';

  constructor(private readonly scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(DEPTH.BASES + 7).setVisible(false);
    registerGraphicsObject(scene, 'objectiveMarkers', this.graphics);
  }

  sync(
    config: ResolvedCoopDefenseMapMissionProgressConfig | undefined,
    state: CoopDefenseMissionProgressPresentationState | null,
    active: boolean,
  ): void {
    if (!active || !config || !state) {
      this.clear();
      return;
    }
    const signature = `${state.roundRevision}:${state.missionRevision}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.graphics.clear().setVisible(true);

    const activated = new Set(state.activatedCheckpoints.map(({ checkpointId }) => checkpointId));
    for (const checkpoint of config.checkpoints) {
      const x = ARENA_OFFSET_X + (checkpoint.gridX + 0.5) * CELL_SIZE;
      const y = ARENA_OFFSET_Y + (checkpoint.gridY + 0.5) * CELL_SIZE;
      const radius = checkpoint.radiusCells * CELL_SIZE;
      const isNext = state.nextCheckpointId === checkpoint.id;
      const isActive = activated.has(checkpoint.id);
      const color = isNext ? COLORS.GOLD_1 : isActive ? COLORS.BLUE_3 : COLORS.BLUE_4;
      const alpha = isNext ? 0.95 : isActive ? 0.34 : 0.16;
      this.graphics.fillStyle(color, alpha * 0.16).fillCircle(x, y, radius);
      this.graphics.lineStyle(isNext ? 3 : 2, color, alpha).strokeCircle(x, y, radius);
      if (isNext) {
        this.graphics.lineStyle(1, COLORS.GREY_1, 0.72).strokeCircle(x, y, Math.max(6, radius - 5));
        this.graphics.fillStyle(COLORS.GOLD_1, 0.9).fillTriangle(x, y - 13, x - 7, y - 2, x + 7, y - 2);
      }
    }

    const barrierOpen = new Map(state.barriers.map((barrier) => [barrier.barrierId, barrier.open]));
    for (const barrier of config.barriers) {
      const open = barrierOpen.get(barrier.id) === true;
      if (open) continue;
      for (const cell of barrier.cells) this.drawClosedGateCell(cell.gridX, cell.gridY);
    }
  }

  clear(): void {
    this.signature = '';
    this.graphics.clear().setVisible(false);
  }

  destroy(): void {
    this.graphics.destroy();
  }

  private drawClosedGateCell(gridX: number, gridY: number): void {
    const left = ARENA_OFFSET_X + gridX * CELL_SIZE;
    const top = ARENA_OFFSET_Y + gridY * CELL_SIZE;
    const inset = 2;
    this.graphics.fillStyle(COLORS.BLUE_5, 0.92)
      .fillRoundedRect(left + inset, top + inset, CELL_SIZE - inset * 2, CELL_SIZE - inset * 2, 4);
    this.graphics.lineStyle(2, COLORS.BLUE_2, 0.95)
      .strokeRoundedRect(left + inset, top + inset, CELL_SIZE - inset * 2, CELL_SIZE - inset * 2, 4);
    this.graphics.lineStyle(3, COLORS.GOLD_1, 0.82);
    for (let offset = -CELL_SIZE; offset < CELL_SIZE * 2; offset += 12) {
      const x1 = Math.max(left + 4, left + offset);
      const y1 = top + 4 + Math.max(0, -offset);
      const x2 = Math.min(left + CELL_SIZE - 4, left + offset + CELL_SIZE);
      const y2 = top + 4 + Math.min(CELL_SIZE - 8, CELL_SIZE - offset);
      if (y1 <= top + CELL_SIZE - 4 && y2 >= top + 4) this.graphics.lineBetween(x1, y1, x2, y2);
    }
    this.graphics.fillStyle(COLORS.BLUE_1, 0.9).fillCircle(left + CELL_SIZE / 2, top + CELL_SIZE / 2, 4);
  }
}
