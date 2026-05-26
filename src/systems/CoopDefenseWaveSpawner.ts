import * as Phaser from 'phaser';
import { GRID_COLS, GRID_ROWS } from '../config';
import type { EnemyManager } from '../entities/EnemyManager';
import type { CoopDefenseEnemyKind } from '../entities/EnemyCatalog';
import { EnemyFlowFieldService } from './EnemyFlowFieldService';

const SPAWN_INTERVAL_MS = 5000;
const SPAWNS_PER_TICK = 2;
const SPAWN_KIND: CoopDefenseEnemyKind = 'dummy';
const LEFT_SPAWN_GRID_X_MAX = Math.max(2, Math.floor(GRID_COLS * 0.15));
const RECENT_CELL_MEMORY = 12;
const MIN_INTRA_WAVE_DISTANCE_CELLS = 2;

export class CoopDefenseWaveSpawner {
  private accumulatorMs = 0;
  private readonly recentCells: string[] = [];
  private exhaustionWarned = false;

  constructor(
    private readonly enemyManager: EnemyManager,
    private readonly flowFieldService: EnemyFlowFieldService,
  ) {}

  hostUpdate(deltaMs: number, countdownActive: boolean): void {
    if (countdownActive) return;

    this.accumulatorMs += deltaMs;
    while (this.accumulatorMs >= SPAWN_INTERVAL_MS) {
      this.accumulatorMs -= SPAWN_INTERVAL_MS;
      this.runWave();
    }
  }

  reset(): void {
    this.accumulatorMs = 0;
    this.recentCells.length = 0;
    this.exhaustionWarned = false;
  }

  private runWave(): void {
    const candidatesAll = this.collectCandidates();
    if (candidatesAll.length === 0) {
      this.warnExhausted();
      return;
    }

    const recentSet = new Set(this.recentCells);
    let candidates = candidatesAll.filter((cell) => !recentSet.has(this.key(cell.gridX, cell.gridY)));
    if (candidates.length === 0) {
      candidates = candidatesAll;
    }

    for (let i = 0; i < SPAWNS_PER_TICK; i++) {
      if (candidates.length === 0) {
        this.warnExhausted();
        return;
      }

      const pick = Phaser.Math.RND.pick(candidates) as { gridX: number; gridY: number };
      this.enemyManager.hostSpawnDummyAt(pick.gridX, pick.gridY, SPAWN_KIND);
      this.pushRecent(this.key(pick.gridX, pick.gridY));

      candidates = candidates.filter((cell) =>
        Math.abs(cell.gridX - pick.gridX) > MIN_INTRA_WAVE_DISTANCE_CELLS
          || Math.abs(cell.gridY - pick.gridY) > MIN_INTRA_WAVE_DISTANCE_CELLS,
      );
    }
  }

  private collectCandidates(): { gridX: number; gridY: number }[] {
    const occupied = new Set<string>();
    for (const enemy of this.enemyManager.getAllEnemies()) {
      const cell = this.flowFieldService.worldToGrid(enemy.sprite.x, enemy.sprite.y);
      if (cell) occupied.add(this.key(cell.gridX, cell.gridY));
    }

    const cells: { gridX: number; gridY: number }[] = [];
    const maxGridX = Math.min(LEFT_SPAWN_GRID_X_MAX, GRID_COLS - 1);
    for (let gridX = 0; gridX <= maxGridX; gridX++) {
      for (let gridY = 0; gridY < GRID_ROWS; gridY++) {
        if (!this.flowFieldService.isTraversableAt(gridX, gridY)) continue;
        const integration = this.flowFieldService.getIntegrationValueAt(gridX, gridY);
        if (integration >= EnemyFlowFieldService.INTEGRATION_INFINITY) continue;
        if (occupied.has(this.key(gridX, gridY))) continue;
        cells.push({ gridX, gridY });
      }
    }
    return cells;
  }

  private pushRecent(key: string): void {
    this.recentCells.push(key);
    if (this.recentCells.length > RECENT_CELL_MEMORY) {
      this.recentCells.shift();
    }
  }

  private warnExhausted(): void {
    if (this.exhaustionWarned) return;
    this.exhaustionWarned = true;
    console.warn('[CoopDefenseWaveSpawner] Keine freien Spawn-Zellen mehr im linken Arena-Bereich.');
  }

  private key(gridX: number, gridY: number): string {
    return `${gridX}:${gridY}`;
  }
}
