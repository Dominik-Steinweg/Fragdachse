import type { CoopDefenseMapBossConfig } from '../config/coopDefenseMaps';
import type { CoopDefenseEnemyKind } from '../config/coopDefenseEnemies';
import type { EnemyManager } from '../entities/EnemyManager';

interface BossSpawnExecutor {
  hostSpawnBoss(kind: CoopDefenseEnemyKind): boolean;
}

/** Owns boss timing and defeat state; placement remains with the shared spawn executor. */
export class CoopDefenseBossSystem {
  private elapsedMs = 0;
  private bossSpawned = false;

  constructor(
    private readonly bossConfig: CoopDefenseMapBossConfig,
    private readonly enemyManager: EnemyManager,
    private readonly spawnExecutor: BossSpawnExecutor,
    private readonly onBossSpawned?: (spawnedAtMs: number) => void,
  ) {}

  hostUpdate(deltaMs: number, countdownActive: boolean, synchronizedNowMs = Date.now()): void {
    if (countdownActive || this.bossSpawned) return;
    this.elapsedMs += Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
    if (this.elapsedMs < this.bossConfig.spawnAtMs) return;
    this.bossSpawned = this.spawnExecutor.hostSpawnBoss(this.bossConfig.enemyKind);
    if (this.bossSpawned) this.onBossSpawned?.(synchronizedNowMs);
  }

  reset(): void {
    this.elapsedMs = 0;
    this.bossSpawned = false;
  }

  isBossDefeated(): boolean {
    return this.bossSpawned && !this.enemyManager.hasEnemyKind(this.bossConfig.enemyKind);
  }
}
