import * as Phaser from 'phaser';
import { AutoTiler, MISSION_BARRIER_AUTOTILE } from '../arena/AutoTiler';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE, DEPTH } from '../config';
import type { ResolvedCoopDefenseMapMissionProgressConfig } from '../config/coopDefenseMaps';
import type { CoopDefenseMissionProgressPresentationState } from '../types';
import { registerGraphicsObject } from './EffectUtils';

/** Authored barrier tiles. Checkpoints belong to the scene's shared MarkerSystem. */
export class CoopDefenseMissionProgressRenderer {
  private readonly barrierImages = new Map<string, Phaser.GameObjects.Image>();
  private config: ResolvedCoopDefenseMapMissionProgressConfig | undefined;
  private roundRevision = -1;
  private missionRevision = -1;
  private destroyed = false;
  constructor(private readonly scene: Phaser.Scene) {}
  sync(config: ResolvedCoopDefenseMapMissionProgressConfig | undefined,
    state: CoopDefenseMissionProgressPresentationState | null, _elapsedMs: number, active: boolean): void {
    if (this.destroyed) return;
    if (!active || !config || !state) { this.clear(); return; }
    if (this.config !== config || this.roundRevision !== state.roundRevision) {
      this.clear(); this.config = config; this.roundRevision = state.roundRevision;
    }
    if (this.missionRevision === state.missionRevision) return;
    this.missionRevision = state.missionRevision;
    this.syncBarriers(config, state);
  }
  clear(): void {
    for (const image of this.barrierImages.values()) image.destroy();
    this.barrierImages.clear(); this.config = undefined;
    this.roundRevision = -1; this.missionRevision = -1;
  }
  destroy(): void { if (!this.destroyed) { this.clear(); this.destroyed = true; } }

  private syncBarriers(
    config: ResolvedCoopDefenseMapMissionProgressConfig,
    state: CoopDefenseMissionProgressPresentationState,
  ): void {
    const open = new Set(state.barriers.filter(barrier => barrier.open).map(barrier => barrier.barrierId));
    const cells = config.barriers.filter(barrier => !open.has(barrier.id)).flatMap(barrier => barrier.cells);
    const keyOf = (x: number, y: number) => `${x}_${y}`;
    const occupied = new Set(cells.map(cell => keyOf(cell.gridX, cell.gridY)));
    const isOccupied = (x: number, y: number) => occupied.has(keyOf(x, y));

    for (const [key, image] of this.barrierImages) {
      if (occupied.has(key)) continue;
      image.destroy();
      this.barrierImages.delete(key);
    }
    // Adjacent gates share contours while closed; opening one exposes the other's end cap.
    for (const cell of cells) {
      const key = keyOf(cell.gridX, cell.gridY);
      const mask = AutoTiler.computeMask(cell.gridX, cell.gridY, isOccupied);
      const frame = AutoTiler.getFrame(mask, MISSION_BARRIER_AUTOTILE);
      const existing = this.barrierImages.get(key);
      if (existing) {
        existing.setFrame(frame);
        continue;
      }
      const image = this.scene.add.image(
        ARENA_OFFSET_X + (cell.gridX + 0.5) * CELL_SIZE,
        ARENA_OFFSET_Y + (cell.gridY + 0.5) * CELL_SIZE,
        'mission_barrier', frame,
      ).setDisplaySize(CELL_SIZE, CELL_SIZE).setDepth(DEPTH.ROCKS);
      registerGraphicsObject(this.scene, 'objectiveMarkers', image);
      this.barrierImages.set(key, image);
    }
  }
}
