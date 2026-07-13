import * as Phaser from 'phaser';
import { GRID_COLS, GRID_ROWS } from '../config';
import type {
  CoopDefenseMapBossConfig,
  ResolvedCoopDefenseMapWaveConfig,
} from '../config/coopDefenseMaps';
import type { EnemyManager } from '../entities/EnemyManager';
import {
  getCoopDefenseEnemyConfig,
  type CoopDefenseEnemyKind,
} from '../config/coopDefenseEnemies';
import { EnemyFlowFieldService } from './EnemyFlowFieldService';

const LEFT_SPAWN_GRID_X_MAX = Math.max(2, Math.floor(GRID_COLS * 0.15));
const RECENT_CELL_MEMORY = 12;
const MIN_INTRA_WAVE_DISTANCE_CELLS = 2;

export class CoopDefenseWaveSpawner {
  private readonly accumulators: number[];
  private readonly recentCells: string[] = [];
  private exhaustionWarned = false;
  private elapsedMs = 0;
  private bossSpawned = false;

  constructor(
    private readonly enemyManager: EnemyManager,
    private readonly flowFieldService: EnemyFlowFieldService,
    private readonly waveConfigs: readonly ResolvedCoopDefenseMapWaveConfig[],
    private readonly bossConfig?: CoopDefenseMapBossConfig,
    private readonly bossFlowFieldService?: EnemyFlowFieldService | null,
  ) {
    this.accumulators = waveConfigs.map(() => 0);
  }

  hostUpdate(deltaMs: number, countdownActive: boolean): void {
    if (countdownActive) return;

    const previousElapsedMs = this.elapsedMs;
    this.elapsedMs += deltaMs;

    if (this.bossConfig && !this.bossSpawned && this.elapsedMs >= this.bossConfig.spawnAtMs) {
      this.bossSpawned = this.spawnOne(this.bossConfig.enemyKind);
    }

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
    this.bossSpawned = false;
  }

  isBossDefeated(): boolean {
    return !!this.bossConfig
      && this.bossSpawned
      && !this.enemyManager.hasEnemyKind(this.bossConfig.enemyKind);
  }

  private runWave(kind: CoopDefenseEnemyKind, count: number): void {
    const candidatesAll = this.collectCandidates(kind);
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

  private spawnOne(kind: CoopDefenseEnemyKind): boolean {
    const candidates = this.collectCandidates(kind);
    if (candidates.length === 0) {
      this.warnExhausted();
      return false;
    }

    const pick = Phaser.Math.RND.pick(candidates) as { gridX: number; gridY: number };
    this.enemyManager.hostSpawnDummyAt(pick.gridX, pick.gridY, kind);
    this.pushRecent(this.key(pick.gridX, pick.gridY));
    return true;
  }

  private collectCandidates(kind: CoopDefenseEnemyKind): { gridX: number; gridY: number }[] {
    const flowFieldService = this.bossConfig?.enemyKind === kind && this.bossFlowFieldService
      ? this.bossFlowFieldService
      : this.flowFieldService;
    const enemies = this.enemyManager.getAllEnemies();
    const spawnRadius = getCoopDefenseEnemyConfig(kind).size * 0.5;

    const cells: { gridX: number; gridY: number }[] = [];
    const maxGridX = Math.min(LEFT_SPAWN_GRID_X_MAX, GRID_COLS - 1);
    for (let gridX = 0; gridX <= maxGridX; gridX++) {
      for (let gridY = 0; gridY < GRID_ROWS; gridY++) {
        if (!flowFieldService.isTraversableAt(gridX, gridY)) continue;
        const integration = flowFieldService.getIntegrationValueAt(gridX, gridY);
        if (integration >= EnemyFlowFieldService.INTEGRATION_INFINITY) continue;
        const world = flowFieldService.gridToWorld(gridX, gridY);
        if (!world) continue;
        const overlapsEnemy = enemies.some((enemy) => {
          const minimumDistance = spawnRadius + enemy.getCollisionRadius();
          return Phaser.Math.Distance.Squared(world.x, world.y, enemy.sprite.x, enemy.sprite.y)
            < minimumDistance * minimumDistance;
        });
        if (overlapsEnemy) continue;
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
