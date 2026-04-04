import Phaser from 'phaser';
import { AutoTiler, ROCK_AUTOTILE } from '../arena/AutoTiler';
import { RockGridIndex } from '../arena/RockGridIndex';
import type { PlayerManager } from '../entities/PlayerManager';
import type { PlaceableUtilityConfig, TunnelUltimateConfig } from '../loadout/LoadoutConfig';
import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CELL_SIZE,
  GRID_COLS,
  GRID_ROWS,
  clipPointToArenaRay,
  isPointInsideArena,
} from '../config';
import type { ArenaLayout, PlaceableKind, SyncedPlaceableRock, UtilityPlacementPreviewState } from '../types';

interface RuntimeRockRecord extends SyncedPlaceableRock {}

export interface PlacementSyncResult {
  added: SyncedPlaceableRock[];
  updated: SyncedPlaceableRock[];
  removed: SyncedPlaceableRock[];
}

export class PlacementSystem {
  private readonly layout: ArenaLayout;
  private readonly rockGrid: RockGridIndex;
  private readonly playerManager: PlayerManager;
  private readonly runtimeRocks = new Map<number, RuntimeRockRecord>();
  private readonly treeCells = new Set<string>();
  private readonly trackCells = new Set<string>();
  private readonly pedestalCells = new Set<string>();
  private nextRockId: number;

  constructor(layout: ArenaLayout, rockGrid: RockGridIndex, playerManager: PlayerManager) {
    this.layout = layout;
    this.rockGrid = rockGrid;
    this.playerManager = playerManager;
    this.nextRockId = layout.rocks.length;

    for (const tree of layout.trees) {
      this.treeCells.add(this.key(tree.gridX, tree.gridY));
    }
    for (const track of layout.tracks) {
      this.trackCells.add(this.key(track.gridX, track.gridY));
      this.trackCells.add(this.key(track.gridX + 1, track.gridY));
    }
    for (const pedestal of layout.powerUpPedestals) {
      this.pedestalCells.add(this.key(pedestal.gridX, pedestal.gridY));
    }
  }

  getRuntimeRock(id: number): SyncedPlaceableRock | undefined {
    return this.runtimeRocks.get(id);
  }

  getAllRuntimeRocks(): readonly SyncedPlaceableRock[] {
    return [...this.runtimeRocks.values()];
  }

  hasRuntimeRock(id: number): boolean {
    return this.runtimeRocks.has(id);
  }

  getNetSnapshot(): SyncedPlaceableRock[] {
    return [...this.runtimeRocks.values()]
      .sort((left, right) => left.id - right.id)
      .map((rock) => ({ ...rock }));
  }

  update(now: number): SyncedPlaceableRock[] {
    const expired: SyncedPlaceableRock[] = [];
    for (const rock of this.runtimeRocks.values()) {
      if (now < rock.expiresAt) continue;
      this.runtimeRocks.delete(rock.id);
      this.rockGrid.remove(rock.gridX, rock.gridY);
      expired.push({ ...rock });
    }
    return expired;
  }

  removeRock(id: number): SyncedPlaceableRock | undefined {
    const rock = this.runtimeRocks.get(id);
    if (!rock) return undefined;
    this.runtimeRocks.delete(id);
    this.rockGrid.remove(rock.gridX, rock.gridY);
    return { ...rock };
  }

  applyDamage(id: number, damage: number): SyncedPlaceableRock | undefined {
    const rock = this.runtimeRocks.get(id);
    if (!rock) return undefined;
    rock.hp = Math.max(0, rock.hp - damage);
    return { ...rock };
  }

  updateAngle(id: number, angle: number): void {
    const rock = this.runtimeRocks.get(id);
    if (!rock) return;
    rock.angle = angle;
  }

  tryPlaceRock(
    cfg: PlaceableUtilityConfig,
    playerId: string,
    ownerColor: number,
    originX: number,
    originY: number,
    targetX: number,
    targetY: number,
    now: number,
  ): SyncedPlaceableRock | null {
    const preview = this.getPlacementPreview(cfg, originX, originY, targetX, targetY);
    if (!preview || !preview.isValid) return null;

    const rock: RuntimeRockRecord = {
      id: this.nextRockId++,
      kind: cfg.placeable.kind,
      gridX: preview.gridX,
      gridY: preview.gridY,
      hp: cfg.placeable.maxHp,
      maxHp: cfg.placeable.maxHp,
      ownerId: playerId,
      ownerColor,
      expiresAt: now + cfg.placeable.lifetimeMs,
      warningStartsAt: now + Math.max(0, cfg.placeable.lifetimeMs - cfg.placeable.warningPulseMs),
      angle: preview.angle,
    };

    this.runtimeRocks.set(rock.id, rock);
    this.rockGrid.set(rock.gridX, rock.gridY, rock.id);
    return { ...rock };
  }

  syncFromSnapshot(snapshot: readonly SyncedPlaceableRock[]): PlacementSyncResult {
    const next = new Map<number, SyncedPlaceableRock>();
    for (const rock of snapshot) {
      next.set(rock.id, rock);
    }

    const added: SyncedPlaceableRock[] = [];
    const updated: SyncedPlaceableRock[] = [];
    const removed: SyncedPlaceableRock[] = [];

    for (const [id, existing] of this.runtimeRocks) {
      if (next.has(id)) continue;
      this.runtimeRocks.delete(id);
      this.rockGrid.remove(existing.gridX, existing.gridY);
      removed.push({ ...existing });
    }

    for (const incoming of snapshot) {
      const current = this.runtimeRocks.get(incoming.id);
      if (!current) {
        this.runtimeRocks.set(incoming.id, { ...incoming });
        this.rockGrid.set(incoming.gridX, incoming.gridY, incoming.id);
        this.nextRockId = Math.max(this.nextRockId, incoming.id + 1);
        added.push({ ...incoming });
        continue;
      }

      if (
        current.gridX !== incoming.gridX
        || current.gridY !== incoming.gridY
        || current.hp !== incoming.hp
        || current.maxHp !== incoming.maxHp
        || current.ownerColor !== incoming.ownerColor
        || current.expiresAt !== incoming.expiresAt
        || current.warningStartsAt !== incoming.warningStartsAt
        || current.kind !== incoming.kind
        || current.angle !== incoming.angle
      ) {
        this.runtimeRocks.set(incoming.id, { ...incoming });
        if (current.gridX !== incoming.gridX || current.gridY !== incoming.gridY) {
          this.rockGrid.remove(current.gridX, current.gridY);
          this.rockGrid.set(incoming.gridX, incoming.gridY, incoming.id);
        }
        updated.push({ ...incoming });
      }
    }

    return { added, updated, removed };
  }

  getPlacementPreview(
    cfg: PlaceableUtilityConfig,
    originX: number,
    originY: number,
    pointerX: number,
    pointerY: number,
  ): UtilityPlacementPreviewState | undefined {
    const targetCell = this.resolveTargetCell(originX, originY, pointerX, pointerY, cfg.placeable.range);
    if (!targetCell) return undefined;

    const targetWorld = this.gridToWorld(targetCell.gridX, targetCell.gridY);
    const isValid = this.canPlaceAt(targetCell.gridX, targetCell.gridY, cfg);
    const mask = AutoTiler.computeMask(targetCell.gridX, targetCell.gridY, (gx, gy) => {
      if (gx === targetCell.gridX && gy === targetCell.gridY) return true;
      return this.rockGrid.isOccupied(gx, gy);
    });

    return {
      angle: Phaser.Math.Angle.Between(originX, originY, targetWorld.x, targetWorld.y),
      targetX: targetWorld.x,
      targetY: targetWorld.y,
      gridX: targetCell.gridX,
      gridY: targetCell.gridY,
      isValid,
      frame: AutoTiler.getFrame(mask, ROCK_AUTOTILE),
      range: cfg.placeable.range,
      kind: cfg.placeable.kind,
      sourceSlot: 'utility',
    };
  }

  getTunnelPlacementPreview(
    cfg: TunnelUltimateConfig,
    originX: number,
    originY: number,
    pointerX: number,
    pointerY: number,
    anchor?: { x: number; y: number; gridX: number; gridY: number } | null,
  ): UtilityPlacementPreviewState | undefined {
    const targetCell = this.resolveTargetCell(originX, originY, pointerX, pointerY, cfg.placement.range);
    if (!targetCell) return undefined;

    const targetWorld = this.gridToWorld(targetCell.gridX, targetCell.gridY);
    const isTargetValid = this.canPlaceSingleCell(targetCell.gridX, targetCell.gridY);
    const isDistinct = !anchor || anchor.gridX !== targetCell.gridX || anchor.gridY !== targetCell.gridY;

    return {
      angle: Phaser.Math.Angle.Between(originX, originY, targetWorld.x, targetWorld.y),
      targetX: targetWorld.x,
      targetY: targetWorld.y,
      gridX: targetCell.gridX,
      gridY: targetCell.gridY,
      isValid: isTargetValid && isDistinct,
      frame: 0,
      range: cfg.placement.range,
      kind: 'tunnel',
      stage: anchor ? 2 : 1,
      anchorX: anchor?.x,
      anchorY: anchor?.y,
      anchorGridX: anchor?.gridX,
      anchorGridY: anchor?.gridY,
      sourceSlot: 'ultimate',
    };
  }

  canPlaceSingleCell(gx: number, gy: number): boolean {
    return this.canPlaceCells([{ dx: 0, dy: 0 }], gx, gy);
  }

  getClampedTargetCell(
    originX: number,
    originY: number,
    pointerX: number,
    pointerY: number,
    range: number,
  ): { gridX: number; gridY: number; x: number; y: number } | null {
    const targetCell = this.resolveTargetCell(originX, originY, pointerX, pointerY, range);
    if (!targetCell) return null;
    const world = this.gridToWorld(targetCell.gridX, targetCell.gridY);
    return { ...targetCell, x: world.x, y: world.y };
  }

  getWorldPointForCell(gridX: number, gridY: number): { x: number; y: number } {
    return this.gridToWorld(gridX, gridY);
  }

  private resolveTargetCell(originX: number, originY: number, pointerX: number, pointerY: number, range: number): { gridX: number; gridY: number } | null {
    const dx = pointerX - originX;
    const dy = pointerY - originY;
    const distance = Math.hypot(dx, dy);
    const dirX = distance > 0.0001 ? dx / distance : 1;
    const dirY = distance > 0.0001 ? dy / distance : 0;
    const pointerInside = isPointInsideArena(pointerX, pointerY) && distance <= range;

    if (pointerInside) {
      const snapped = this.snapWorldToGrid(pointerX, pointerY);
      const snappedWorld = this.gridToWorld(snapped.gridX, snapped.gridY);
      const withinRange = Phaser.Math.Distance.Between(originX, originY, snappedWorld.x, snappedWorld.y) <= range;
      if (withinRange && isPointInsideArena(snappedWorld.x, snappedWorld.y)) {
        return snapped;
      }
    }

    const clipped = clipPointToArenaRay(originX, originY, originX + dirX * range, originY + dirY * range);
    const maxProjection = Phaser.Math.Distance.Between(originX, originY, clipped.x, clipped.y);
    let best: { gridX: number; gridY: number; projection: number } | null = null;
    const radiusCells = Math.ceil(range / CELL_SIZE) + 1;
    const originCell = this.snapWorldToGrid(originX, originY);

    for (let gy = Math.max(0, originCell.gridY - radiusCells); gy <= Math.min(GRID_ROWS - 1, originCell.gridY + radiusCells); gy += 1) {
      for (let gx = Math.max(0, originCell.gridX - radiusCells); gx <= Math.min(GRID_COLS - 1, originCell.gridX + radiusCells); gx += 1) {
        const world = this.gridToWorld(gx, gy);
        const offsetX = world.x - originX;
        const offsetY = world.y - originY;
        const projection = offsetX * dirX + offsetY * dirY;
        if (projection < -0.01 || projection > maxProjection + 0.01) continue;
        if (Phaser.Math.Distance.Between(originX, originY, world.x, world.y) > range) continue;
        if (!isPointInsideArena(world.x, world.y)) continue;
        if (!best || projection > best.projection) {
          best = { gridX: gx, gridY: gy, projection };
        }
      }
    }

    return best ? { gridX: best.gridX, gridY: best.gridY } : null;
  }

  private canPlaceAt(gx: number, gy: number, cfg: PlaceableUtilityConfig): boolean {
    return this.canPlaceCells(cfg.placeable.footprint, gx, gy);
  }

  private canPlaceCells(footprint: readonly { dx: number; dy: number }[], gx: number, gy: number): boolean {
    for (const cell of footprint) {
      const tx = gx + cell.dx;
      const ty = gy + cell.dy;
      if (tx < 0 || tx >= GRID_COLS || ty < 0 || ty >= GRID_ROWS) return false;
      if (this.rockGrid.isOccupied(tx, ty)) return false;
      if (this.treeCells.has(this.key(tx, ty))) return false;
      if (this.trackCells.has(this.key(tx, ty))) return false;
      if (this.pedestalCells.has(this.key(tx, ty))) return false;
      if (this.isPlayerOccupyingCell(tx, ty)) return false;
    }

    return true;
  }

  private isPlayerOccupyingCell(gx: number, gy: number): boolean {
    for (const player of this.playerManager.getAllPlayers()) {
      if (!player.sprite.active) continue;
      const cell = this.worldToGrid(player.sprite.x, player.sprite.y);
      if (cell.gridX === gx && cell.gridY === gy) return true;
    }
    return false;
  }

  private snapWorldToGrid(x: number, y: number): { gridX: number; gridY: number } {
    const gridX = Phaser.Math.Clamp(
      Math.round((x - ARENA_OFFSET_X - CELL_SIZE * 0.5) / CELL_SIZE),
      0,
      GRID_COLS - 1,
    );
    const gridY = Phaser.Math.Clamp(
      Math.round((y - ARENA_OFFSET_Y - CELL_SIZE * 0.5) / CELL_SIZE),
      0,
      GRID_ROWS - 1,
    );
    return { gridX, gridY };
  }

  private worldToGrid(x: number, y: number): { gridX: number; gridY: number } {
    const gridX = Phaser.Math.Clamp(Math.floor((x - ARENA_OFFSET_X) / CELL_SIZE), 0, GRID_COLS - 1);
    const gridY = Phaser.Math.Clamp(Math.floor((y - ARENA_OFFSET_Y) / CELL_SIZE), 0, GRID_ROWS - 1);
    return { gridX, gridY };
  }

  private gridToWorld(gridX: number, gridY: number): { x: number; y: number } {
    return {
      x: ARENA_OFFSET_X + gridX * CELL_SIZE + CELL_SIZE * 0.5,
      y: ARENA_OFFSET_Y + gridY * CELL_SIZE + CELL_SIZE * 0.5,
    };
  }

  private key(gx: number, gy: number): string {
    return `${gx}_${gy}`;
  }
}
