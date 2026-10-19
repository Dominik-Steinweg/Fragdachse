import type { CoopDefenseMapBossConfig } from '../config/coopDefenseMaps';
import type { CoopDefenseEnemyKind } from '../config/coopDefenseEnemies';
import type { EnemyManager, EnemySpawnOptions } from '../entities/EnemyManager';
import { getBossIntroPreset, type BossIntroState } from '../config/bossIntros';
import type { KrakenBossSpawnPort, KrakenHabitatReservation, KrakenHabitatResult } from './KrakenState';
import type { BossTargetRef } from '../combat/CombatPartContact';
import type { FireChunkBurstPort } from './FlamethrowerUpgradeSystem';
import type { SyncedSpawnZoneAlert } from '../types';
import { SPAWN_ZONE_ALERT_LEAD_MS } from './CoopDefenseSpawnZoneAlerts';

interface BossSpawnExecutor {
  hostReserveBossHabitat?(kind: CoopDefenseEnemyKind, habitatId: string): KrakenHabitatResult<KrakenHabitatReservation>;
  spawnAtHabitat?: KrakenBossSpawnPort['spawnAtHabitat'];
  releaseBossHabitat?(reservationId: string): void;
  hostSpawnBoss(kind: CoopDefenseEnemyKind): boolean;
  hostResolveBossSpawnPoint?(kind: CoopDefenseEnemyKind, edgeMarginCells?: number): { readonly x: number; readonly y: number } | null;
  hostSpawnBossAt?(kind: CoopDefenseEnemyKind, x: number, y: number, options?: EnemySpawnOptions): boolean;
}

type BossPhase =
  | { readonly type: 'waiting' }
  | { readonly type: 'intro'; readonly state: BossIntroState; readonly startedAtElapsedMs: number; readonly emergeAtElapsedMs: number; readonly reservation?: KrakenHabitatReservation }
  | { readonly type: 'spawned'; readonly spawnedAtElapsedMs: number };

/**
 * Owns boss timing and defeat state; placement remains with the shared spawn executor.
 * Ein optionales Intro reserviert den Spawnpunkt, kuendigt ihn an und verschiebt den Spawn
 * um die authored `emergeAtMs`.
 */
export class CoopDefenseBossSystem {
  private elapsedMs = 0;
  private phase: BossPhase = { type: 'waiting' };
  private defeatCompletion: (() => boolean) | null = null;
  setDefeatCompletionSource(source: (() => boolean) | null): void { this.defeatCompletion = source; }

  constructor(
    private readonly bossConfig: CoopDefenseMapBossConfig,
    private readonly enemyManager: EnemyManager,
    private readonly spawnExecutor: BossSpawnExecutor,
    private readonly onBossSpawned?: (spawnedAtMs: number, boss?: BossTargetRef, intro?: BossIntroState) => void,
    private readonly onBossIntroStarted?: (state: BossIntroState) => void,
    private readonly random: () => number = Math.random,
    /** Zusaetzliche authored Startbedingung, z. B. "Welle 1 geraeumt". */
    private readonly isStartSatisfied: () => boolean = () => true,
    private readonly fireChunkBurstPort?: FireChunkBurstPort | null,
  ) {}

  hostUpdate(deltaMs: number, countdownActive: boolean, synchronizedNowMs = Date.now()): void {
    if (countdownActive) return;
    this.elapsedMs += Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
    if (this.phase.type === 'spawned') return;
    if (this.elapsedMs < this.bossConfig.spawnAtMs) return;

    if (this.phase.type === 'waiting') {
      if (!this.isStartSatisfied()) return;
      const intro = this.tryStartIntro(synchronizedNowMs);
      if (intro) {
        this.phase = intro;
        return;
      }
      if (this.bossConfig.habitatId || this.bossConfig.intro?.preset === 'kraken-rise') return;
      this.completeSpawn(this.spawnExecutor.hostSpawnBoss(this.bossConfig.enemyKind), synchronizedNowMs);
      return;
    }

    if (this.elapsedMs < this.phase.emergeAtElapsedMs) return;
    const { state, reservation } = this.phase;
    if (reservation) {
      const boss = this.spawnExecutor.spawnAtHabitat?.(this.bossConfig.enemyKind, reservation);
      this.spawnExecutor.releaseBossHabitat?.(reservation.reservationId);
      if (!boss) { this.phase = { type: 'waiting' }; return; }
      this.phase = { type: 'spawned', spawnedAtElapsedMs: this.elapsedMs };
      this.onBossSpawned?.(synchronizedNowMs, boss, state);
      return;
    }
    const spawned = this.spawnExecutor.hostSpawnBossAt?.(
      this.bossConfig.enemyKind,
      state.x,
      state.y,
      { skipSpawnEffect: true },
    ) ?? false;
    this.completeSpawn(spawned, synchronizedNowMs);
    if (spawned && this.fireChunkBurstPort) {
      const preset = getBossIntroPreset(state.preset);
      if ('fireChunkBurst' in preset) {
        const boss = this.enemyManager.getAllEnemies().find(enemy => enemy.kind === this.bossConfig.enemyKind);
        if (boss) this.fireChunkBurstPort.hostCreateFireChunkBurst(
          boss.id, state.x, state.y, preset.fireChunkBurst, `boss-intro:${state.seed}`, synchronizedNowMs,
        );
      }
    }
  }

  reset(): void {
    if (this.phase.type === 'intro' && this.phase.reservation) this.spawnExecutor.releaseBossHabitat?.(this.phase.reservation.reservationId);
    this.elapsedMs = 0;
    this.phase = { type: 'waiting' };
  }

  /** Missionszeit seit dem tatsaechlichen Boss-Spawn; `null`, solange der Boss nicht steht. */
  getMsSinceSpawn(): number | null {
    return this.phase.type === 'spawned' ? this.elapsedMs - this.phase.spawnedAtElapsedMs : null;
  }

  isBossDefeated(): boolean {
    return this.phase.type === 'spawned' && !this.enemyManager.hasEnemyKind(this.bossConfig.enemyKind)
      && (!(this.bossConfig.habitatId || this.bossConfig.intro?.preset === 'kraken-rise') || this.defeatCompletion?.() === true);
  }

  /**
   * The boss's spawn zone from the start of its intro until it has emerged (GDD
   * Void-Gefahrenzonen V1); null without a zone or before the intro.
   */
  /** The boss zone waits for the boss, is active during its intro and spent once it emerged. */
  collectSpawnZoneUse(active: Set<string>, upcoming: Set<string>): void {
    const zoneId = this.bossConfig.spawnZoneId;
    if (!zoneId || this.phase.type === 'spawned') return;
    (this.phase.type === 'intro' ? active : upcoming).add(zoneId);
  }

  getSpawnZoneAlert(): SyncedSpawnZoneAlert | null {
    const zoneId = this.bossConfig.spawnZoneId;
    if (!zoneId) return null;
    if (this.phase.type === 'intro') return { zoneId, fromMs: this.phase.startedAtElapsedMs, atMs: this.phase.emergeAtElapsedMs, endMs: null };
    if (this.phase.type === 'spawned') {
      const at = this.phase.spawnedAtElapsedMs;
      return { zoneId, fromMs: at - SPAWN_ZONE_ALERT_LEAD_MS, atMs: at, endMs: at };
    }
    return null;
  }

  private tryStartIntro(synchronizedNowMs: number): BossPhase | null {
    const introConfig = this.bossConfig.intro;
    if (introConfig?.preset === 'kraken-rise') {
      if (!this.bossConfig.habitatId || !this.spawnExecutor.spawnAtHabitat) return null;
      const result = this.spawnExecutor.hostReserveBossHabitat?.(this.bossConfig.enemyKind, this.bossConfig.habitatId);
      if (result?.status !== 'valid') return null;
      const r = result.value;
      const state: BossIntroState = { preset: 'kraken-rise', habitatId: r.habitatId, waterAnchorId: r.waterAnchorId,
        x: r.x, y: r.y, startedAtMs: synchronizedNowMs, seed: Math.floor(this.random() * 0xffffffff) >>> 0 };
      this.onBossIntroStarted?.(state);
      return { type: 'intro', state, reservation: r, startedAtElapsedMs: this.elapsedMs, emergeAtElapsedMs: this.elapsedMs + getBossIntroPreset('kraken-rise').emergeAtMs };
    }
    if (this.bossConfig.habitatId) return null;
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
      startedAtElapsedMs: this.elapsedMs,
      emergeAtElapsedMs: this.elapsedMs + preset.emergeAtMs,
    };
  }

  private completeSpawn(spawned: boolean, synchronizedNowMs: number): void {
    if (!spawned) return;
    this.phase = { type: 'spawned', spawnedAtElapsedMs: this.elapsedMs };
    this.onBossSpawned?.(synchronizedNowMs);
  }
}
