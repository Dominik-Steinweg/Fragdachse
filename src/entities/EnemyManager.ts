import * as Phaser from 'phaser';
import { getCoopDefenseBases } from '../arena/BaseRegistry';
import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CELL_SIZE,
  COOP_DEFENSE_ENEMY_TEST_SPAWN_GRID_X,
  GRID_COLS,
  GRID_ROWS,
  isGridCellInArenaRegion,
} from '../config';
import type { ArenaLayout, SyncedEnemyState } from '../types';
import { EnemyEntity } from './EnemyEntity';

const DUMMY_ENEMY_ID = 'coop-defense-dummy-1';

export class EnemyManager {
  private readonly scene: Phaser.Scene;
  private readonly enemies = new Map<string, EnemyEntity>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  hostSpawnInitialDummy(layout: ArenaLayout): void {
    if (this.enemies.size > 0) return;

    const spawn = this.resolveInitialSpawn(layout);
    const enemy = new EnemyEntity(this.scene, DUMMY_ENEMY_ID, spawn.x, spawn.y, true);
    this.enemies.set(enemy.id, enemy);
  }

  getNetSnapshot(): SyncedEnemyState[] {
    return [...this.enemies.values()]
      .map((enemy) => enemy.getNetSnapshot())
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  applySnapshot(snapshot: readonly SyncedEnemyState[]): void {
    const activeIds = new Set(snapshot.map((enemy) => enemy.id));

    for (const [id, enemy] of this.enemies) {
      if (activeIds.has(id)) continue;
      enemy.destroy();
      this.enemies.delete(id);
    }

    for (const remote of snapshot) {
      let enemy = this.enemies.get(remote.id);
      if (!enemy) {
        enemy = new EnemyEntity(this.scene, remote.id, remote.x, remote.y, false);
        this.enemies.set(remote.id, enemy);
      }
      enemy.setHp(remote.hp);
      enemy.setTargetPosition(remote.x, remote.y);
    }
  }

  updateClientInterpolation(factor: number): void {
    for (const enemy of this.enemies.values()) {
      enemy.lerpStep(factor);
    }
  }

  destroy(): void {
    for (const enemy of this.enemies.values()) {
      enemy.destroy();
    }
    this.enemies.clear();
  }

  private resolveInitialSpawn(layout: ArenaLayout): { x: number; y: number } {
    const blocked = this.buildBlockedCells(layout);
    const preferredGridX = Math.max(1, Math.min(COOP_DEFENSE_ENEMY_TEST_SPAWN_GRID_X, GRID_COLS - 2));
    const maxGridX = Math.max(preferredGridX, Math.min(GRID_COLS - 1, preferredGridX + Math.max(4, Math.floor(GRID_COLS * 0.1))));

    for (let gridX = preferredGridX; gridX <= maxGridX; gridX++) {
      for (const gridY of this.buildRowSearchOrder()) {
        if (blocked.has(this.key(gridX, gridY))) continue;
        return this.gridToWorld(gridX, gridY);
      }
    }

    return this.gridToWorld(preferredGridX, Math.floor(GRID_ROWS * 0.5));
  }

  private buildBlockedCells(layout: ArenaLayout): Set<string> {
    const blocked = new Set<string>();

    for (const rock of layout.rocks) {
      blocked.add(this.key(rock.gridX, rock.gridY));
    }
    for (const tree of layout.trees) {
      blocked.add(this.key(tree.gridX, tree.gridY));
    }
    for (const track of layout.tracks) {
      blocked.add(this.key(track.gridX, track.gridY));
      blocked.add(this.key(track.gridX + 1, track.gridY));
    }
    for (const pedestal of layout.powerUpPedestals) {
      blocked.add(this.key(pedestal.gridX, pedestal.gridY));
    }
    for (const base of getCoopDefenseBases()) {
      for (let gridX = base.region.minGridX; gridX <= base.region.maxGridX; gridX++) {
        for (let gridY = base.region.minGridY; gridY <= base.region.maxGridY; gridY++) {
          if (!isGridCellInArenaRegion(base.region, gridX, gridY)) continue;
          blocked.add(this.key(gridX, gridY));
        }
      }
    }

    return blocked;
  }

  private buildRowSearchOrder(): number[] {
    const rows: number[] = [];
    const center = Math.floor(GRID_ROWS * 0.5);
    rows.push(center);
    for (let offset = 1; offset < GRID_ROWS; offset++) {
      const up = center - offset;
      const down = center + offset;
      if (up >= 0) rows.push(up);
      if (down < GRID_ROWS) rows.push(down);
    }
    return rows;
  }

  private gridToWorld(gridX: number, gridY: number): { x: number; y: number } {
    return {
      x: ARENA_OFFSET_X + gridX * CELL_SIZE + CELL_SIZE * 0.5,
      y: ARENA_OFFSET_Y + gridY * CELL_SIZE + CELL_SIZE * 0.5,
    };
  }

  private key(gridX: number, gridY: number): string {
    return `${gridX}:${gridY}`;
  }
}