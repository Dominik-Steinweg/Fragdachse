import * as Phaser from 'phaser';
import { GRID_COLS, GRID_ROWS } from '../config';
import type { ResolvedCoopDefenseMapWaveConfig } from '../config/coopDefenseMaps';
import type { EnemyManager } from '../entities/EnemyManager';
import type { CoopDefenseEnemyKind } from '../config/coopDefenseEnemies';
import { EnemyFlowFieldService } from './EnemyFlowFieldService';

const LEFT_SPAWN_GRID_X_MAX = Math.max(2, Math.floor(GRID_COLS * 0.15));
const RECENT_CELL_MEMORY = 12;
const MIN_INTRA_WAVE_DISTANCE_CELLS = 2;

export class CoopDefenseWaveSpawner {
  private readonly accumulators: number[];
  private readonly recentCells: string[] = [];
  private exhaustionWarned = false;
  private elapsedMs = 0;

  constructor(
    private readonly enemyManager: EnemyManager,
    private readonly flowFieldService: EnemyFlowFieldService,
    private readonly waveConfigs: readonly ResolvedCoopDefenseMapWaveConfig[],
  ) {
    this.accumulators = waveConfigs.map(() => 0);
  }

  hostUpdate(deltaMs: number, countdownActive: boolean): void {
    if (countdownActive) return;

    const previousElapsedMs = this.elapsedMs;
    this.elapsedMs += deltaMs;

    for (const [index, waveConfig] of this.waveConfigs.entries()) {
      const { intervalMs } = waveConfig;
      const activeDeltaMs = this.getActiveDeltaMs(previousElapsedMs, this.elapsedMs, waveConfig.startAtMs);
      if (activeDeltaMs <= 0) continue;

      let acc = this.accumulators[index] + activeDeltaMs;
      while (acc >= intervalMs) {
        acc -= intervalMs;
        this.runWave(waveConfig.enemyKind, waveConfig.countPerWave);
      }
      this.accumulators[index] = acc;
    }
  }

  reset(): void {
    for (let index = 0; index < this.accumulators.length; index++) {
      this.accumulators[index] = 0;
    }
    this.recentCells.length = 0;
    this.exhaustionWarned = false;
    this.elapsedMs = 0;
  }

  private runWave(kind: CoopDefenseEnemyKind, count: number): void {
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

    for (let i = 0; i < count; i++) {
      if (candidates.length === 0) {
        this.warnExhausted();
        return;
      }

      const pick = Phaser.Math.RND.pick(candidates) as { gridX: number; gridY: number };
      this.enemyManager.hostSpawnDummyAt(pick.gridX, pick.gridY, kind);
      this.pushRecent(this.key(pick.gridX, pick.gridY));

      candidates = candidates.filter(
        (cell) =>
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

  private getActiveDeltaMs(previousElapsedMs: number, nextElapsedMs: number, startAtMs: number): number {
    if (nextElapsedMs <= startAtMs) return 0;
    const activeStartMs = Math.max(previousElapsedMs, startAtMs);
    return Math.max(0, nextElapsedMs - activeStartMs);
  }

  private key(gridX: number, gridY: number): string {
    return `${gridX}:${gridY}`;
  }
}
