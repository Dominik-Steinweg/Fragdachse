import type { CoopDefenseMapBossConfig } from '../config/coopDefenseMaps';
import type { CoopDefenseEnemyKind } from '../config/coopDefenseEnemies';
import type { EnemyManager, EnemySpawnOptions } from '../entities/EnemyManager';
import { getBossIntroPreset, type BossIntroState } from '../config/bossIntros';

interface BossSpawnExecutor {
  hostSpawnBoss(kind: CoopDefenseEnemyKind): boolean;
  hostResolveBossSpawnPoint?(kind: CoopDefenseEnemyKind, edgeMarginCells?: number): { readonly x: number; readonly y: number } | null;
  hostSpawnBossAt?(kind: CoopDefenseEnemyKind, x: number, y: number, options?: EnemySpawnOptions): boolean;
}

type BossPhase =
  | { readonly type: 'waiting' }
  | { readonly type: 'intro'; readonly state: BossIntroState; readonly emergeAtElapsedMs: number }
  | { readonly type: 'spawned' };

/**
 * Owns boss timing and defeat state; placement remains with the shared spawn executor.
 * Ein optionales Intro reserviert den Spawnpunkt, kuendigt ihn an und verschiebt den Spawn
 * um die authored `emergeAtMs`.
 */
export class CoopDefenseBossSystem {
  private elapsedMs = 0;
  private phase: BossPhase = { type: 'waiting' };

  constructor(
    private readonly bossConfig: CoopDefenseMapBossConfig,
    private readonly enemyManager: EnemyManager,
    private readonly spawnExecutor: BossSpawnExecutor,
    private readonly onBossSpawned?: (spawnedAtMs: number) => void,
    private readonly onBossIntroStarted?: (state: BossIntroState) => void,
    private readonly random: () => number = Math.random,
  ) {}

  hostUpdate(deltaMs: number, countdownActive: boolean, synchronizedNowMs = Date.now()): void {
    if (countdownActive || this.phase.type === 'spawned') return;
    this.elapsedMs += Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
    if (this.elapsedMs < this.bossConfig.spawnAtMs) return;

    if (this.phase.type === 'waiting') {
      const intro = this.tryStartIntro(synchronizedNowMs);
      if (intro) {
        this.phase = intro;
        return;
      }
      this.completeSpawn(this.spawnExecutor.hostSpawnBoss(this.bossConfig.enemyKind), synchronizedNowMs);
      return;
    }

    if (this.elapsedMs < this.phase.emergeAtElapsedMs) return;
    const { state } = this.phase;
    const spawned = this.spawnExecutor.hostSpawnBossAt?.(
      this.bossConfig.enemyKind,
      state.x,
      state.y,
      { skipSpawnEffect: true },
    ) ?? false;
    this.completeSpawn(spawned, synchronizedNowMs);
  }

  reset(): void {
    this.elapsedMs = 0;
    this.phase = { type: 'waiting' };
  }

  isBossDefeated(): boolean {
    return this.phase.type === 'spawned' && !this.enemyManager.hasEnemyKind(this.bossConfig.enemyKind);
  }

  private tryStartIntro(synchronizedNowMs: number): BossPhase | null {
    const introConfig = this.bossConfig.intro;
    if (!introConfig || !this.spawnExecutor.hostResolveBossSpawnPoint || !this.spawnExecutor.hostSpawnBossAt) return null;
    const preset = getBossIntroPreset(introConfig.preset);
    const point = this.spawnExecutor.hostResolveBossSpawnPoint(this.bossConfig.enemyKind, preset.spawnEdgeMarginCells);
    // Ohne freien Punkt wird regulaer im naechsten Frame erneut versucht.
    if (!point) return null;
    const state: BossIntroState = {
      preset: introConfig.preset,
      x: point.x,
      y: point.y,
      startedAtMs: synchronizedNowMs,
      seed: Math.floor(this.random() * 0xffffffff) >>> 0,
    };
    this.onBossIntroStarted?.(state);
    return {
      type: 'intro',
      state,
      emergeAtElapsedMs: this.elapsedMs + preset.emergeAtMs,
    };
  }

  private completeSpawn(spawned: boolean, synchronizedNowMs: number): void {
    if (!spawned) return;
    this.phase = { type: 'spawned' };
    this.onBossSpawned?.(synchronizedNowMs);
  }
}
