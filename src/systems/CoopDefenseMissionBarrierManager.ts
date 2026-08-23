import * as Phaser from 'phaser';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE } from '../config';
import type { ResolvedCoopDefenseMapMissionProgressConfig } from '../config/coopDefenseMaps';
import type { CoopDefenseMissionProgressPresentationState } from '../types';

export interface MissionBarrierCellChange {
  readonly gridX: number;
  readonly gridY: number;
  readonly occupied: boolean;
}

export interface CoopDefenseMissionBarrierManagerOptions {
  readonly onOccupancyChanged?: (changes: readonly MissionBarrierCellChange[]) => void;
  /** Bestehende statische Blockergruppe; Barrieren teilen deren Kollisions-Lifecycle. */
  readonly physicsGroup?: Phaser.Physics.Arcade.StaticGroup;
}

interface BarrierRuntime {
  readonly id: string;
  readonly cells: readonly { readonly gridX: number; readonly gridY: number }[];
  readonly bodies: Phaser.GameObjects.Rectangle[];
  open: boolean;
}

/** Gameplay-Geometrie fuer einmalig oeffnende Missionstore; Darstellung besitzt der Renderer. */
export class CoopDefenseMissionBarrierManager {
  private readonly barriers = new Map<string, BarrierRuntime>();
  private readonly reservedCells = new Set<string>();
  private readonly obstacleRectangles: Phaser.GameObjects.Rectangle[] = [];
  private readonly physicsGroup: Phaser.Physics.Arcade.StaticGroup;
  private readonly ownsPhysicsGroup: boolean;

  constructor(
    private readonly scene: Phaser.Scene,
    config: ResolvedCoopDefenseMapMissionProgressConfig,
    private readonly options: CoopDefenseMissionBarrierManagerOptions = {},
  ) {
    this.physicsGroup = options.physicsGroup ?? scene.physics.add.staticGroup();
    this.ownsPhysicsGroup = options.physicsGroup === undefined;
    for (const barrier of config.barriers) {
      const bodies = barrier.cells.map((cell) => {
        this.reservedCells.add(cellKey(cell.gridX, cell.gridY));
        const body = scene.add.rectangle(
          ARENA_OFFSET_X + (cell.gridX + 0.5) * CELL_SIZE,
          ARENA_OFFSET_Y + (cell.gridY + 0.5) * CELL_SIZE,
          CELL_SIZE,
          CELL_SIZE,
          0x000000,
          0,
        );
        body.setVisible(false);
        this.physicsGroup.add(body);
        return body;
      });
      this.obstacleRectangles.push(...bodies);
      this.barriers.set(barrier.id, { id: barrier.id, cells: barrier.cells, bodies, open: false });
    }
  }

  getObstacleRectangles(): readonly Phaser.GameObjects.Rectangle[] {
    return this.obstacleRectangles;
  }

  getPhysicsGroup(): Phaser.Physics.Arcade.StaticGroup {
    return this.physicsGroup;
  }

  getReservedCellKeys(): ReadonlySet<string> {
    return this.reservedCells;
  }

  isCellClosed(gridX: number, gridY: number): boolean {
    for (const barrier of this.barriers.values()) {
      if (barrier.open) continue;
      if (barrier.cells.some((cell) => cell.gridX === gridX && cell.gridY === gridY)) return true;
    }
    return false;
  }

  syncPresentationState(state: CoopDefenseMissionProgressPresentationState | null): void {
    if (!state) return;
    const byId = new Map(state.barriers.map((barrier) => [barrier.barrierId, barrier.open]));
    for (const barrier of this.barriers.values()) {
      this.setOpen(barrier, byId.get(barrier.id) === true);
    }
  }

  destroy(): void {
    for (const barrier of this.barriers.values()) {
      for (const body of barrier.bodies) body.destroy();
    }
    this.barriers.clear();
    this.reservedCells.clear();
    this.obstacleRectangles.length = 0;
    if (this.ownsPhysicsGroup) this.physicsGroup.destroy(false);
  }

  private setOpen(barrier: BarrierRuntime, open: boolean): void {
    if (barrier.open === open) return;
    // Block B kennt nur Oeffnen; ein spaetes altes Snapshot darf ein Tor nicht wieder schliessen.
    if (!open && barrier.open) return;
    barrier.open = open;
    for (const object of barrier.bodies) {
      object.setActive(!open);
      const body = object.body as Phaser.Physics.Arcade.StaticBody | null;
      if (body) body.enable = !open;
    }
    this.options.onOccupancyChanged?.(barrier.cells.map((cell) => ({
      gridX: cell.gridX,
      gridY: cell.gridY,
      occupied: !open,
    })));
  }
}

function cellKey(gridX: number, gridY: number): string {
  return `${gridX}_${gridY}`;
}
