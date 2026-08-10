import * as Phaser from 'phaser';
import { GRID_COLS, GRID_ROWS } from '../config';
import type {
  CoopDefenseMapBossConfig,
  ResolvedCoopDefenseMapWaveConfig,
} from '../config/coopDefenseMaps';
import type { EnemyManager } from '../entities/EnemyManager';
import type { EnemySpawnOptions } from '../entities/EnemyManager';
import type { BaseSpec } from '../arena/BaseRegistry';
import {
  getCoopDefenseEnemyConfig,
  type CoopDefenseEnemyKind,
} from '../config/coopDefenseEnemies';
import { EnemyFlowFieldService } from './EnemyFlowFieldService';

const LEFT_SPAWN_GRID_X_MAX = Math.max(2, Math.floor(GRID_COLS * 0.15));
const RECENT_CELL_MEMORY = 12;
const MIN_INTRA_WAVE_DISTANCE_CELLS = 2;
/**
 * Spielraum um die kürzeste Grabstrecke herum. Ohne Toleranz würden sich alle eingebuddelten
 * Gegner auf eine einzige Reihe drängen; mit ihr bleiben mehrere Zugänge in Benutzung.
 */
const SPAWN_TUNNEL_DIG_TOLERANCE_CELLS = 2;

export class CoopDefenseWaveSpawner {
  private readonly accumulators: number[];
  private readonly startedWaves: boolean[];
  private readonly spawnPointAccumulators: number[];
  private readonly startedSpawnPointWaves: boolean[];
  private readonly recentCells: string[] = [];
  private exhaustionWarned = false;
  private elapsedMs = 0;
  private bossSpawned = false;
  /** Zeitpunkt (elapsedMs), zu dem das Luftangriffs-Eröffnungsbombardement fertig war; null solange offen/nicht zutreffend. */
  private airstrikeBarrageGateOpenedAtMs: number | null = null;

  constructor(
    private readonly enemyManager: EnemyManager,
    private readonly flowFieldService: EnemyFlowFieldService,
    private readonly waveConfigs: readonly ResolvedCoopDefenseMapWaveConfig[],
    private readonly spawnPointBases: readonly BaseSpec[] = [],
    private readonly getActiveBaseIds: () => ReadonlySet<string> = () => new Set<string>(),
    private readonly bossConfig?: CoopDefenseMapBossConfig,
    private readonly bossFlowFieldService?: EnemyFlowFieldService | null,
    private readonly isAirstrikeBarrageComplete?: () => boolean,
  ) {
    this.accumulators = waveConfigs.map(() => 0);
    this.startedWaves = waveConfigs.map(() => false);
    this.spawnPointAccumulators = this.getSpawnPointSources().map(() => 0);
    this.startedSpawnPointWaves = this.getSpawnPointSources().map(() => false);
  }

  hostUpdate(deltaMs: number, countdownActive: boolean): void {
    if (countdownActive) return;

    const previousElapsedMs = this.elapsedMs;
    this.elapsedMs += deltaMs;

    if (this.airstrikeBarrageGateOpenedAtMs === null && (this.isAirstrikeBarrageComplete?.() ?? false)) {
      this.airstrikeBarrageGateOpenedAtMs = this.elapsedMs;
    }

    if (this.bossConfig && !this.bossSpawned && this.elapsedMs >= this.bossConfig.spawnAtMs) {
      this.bossSpawned = this.spawnOne(this.bossConfig.enemyKind);
    }

    for (const [index, waveConfig] of this.waveConfigs.entries()) {
      const { intervalMs } = waveConfig;
      const effectiveStartAtMs = this.getEffectiveStartAtMs(waveConfig);
      if (effectiveStartAtMs === null || this.elapsedMs < effectiveStartAtMs) continue;

      if (!this.startedWaves[index]) {
        this.startedWaves[index] = true;
        this.runWave(waveConfig.enemyKind, waveConfig.countPerWave);
      }

      const activeDeltaMs = this.getActiveDeltaMs(previousElapsedMs, this.elapsedMs, effectiveStartAtMs);
      if (activeDeltaMs <= 0) continue;

      let acc = this.accumulators[index] + activeDeltaMs;
      while (acc >= intervalMs) {
        acc -= intervalMs;
        this.runWave(waveConfig.enemyKind, waveConfig.countPerWave);
      }
      this.accumulators[index] = acc;
    }

    const activeBaseIds = this.getActiveBaseIds();
    for (const [index, source] of this.getSpawnPointSources().entries()) {
      if (!activeBaseIds.has(source.id)) continue;
      const waveConfig = source.spawnWave;
      if (!waveConfig) continue;
      const effectiveStartAtMs = this.getEffectiveStartAtMs(waveConfig);
      if (effectiveStartAtMs === null || this.elapsedMs < effectiveStartAtMs) continue;

      if (!this.startedSpawnPointWaves[index]) {
        this.startedSpawnPointWaves[index] = true;
        this.runSpawnPointWave(source, waveConfig.countPerWave);
      }

      const activeDeltaMs = this.getActiveDeltaMs(previousElapsedMs, this.elapsedMs, effectiveStartAtMs);
      if (activeDeltaMs <= 0) continue;

      let acc = this.spawnPointAccumulators[index] + activeDeltaMs;
      while (acc >= waveConfig.intervalMs) {
        acc -= waveConfig.intervalMs;
        this.runSpawnPointWave(source, waveConfig.countPerWave);
      }
      this.spawnPointAccumulators[index] = acc;
    }
  }

  reset(): void {
    for (let index = 0; index < this.accumulators.length; index++) {
      this.accumulators[index] = 0;
      this.startedWaves[index] = false;
    }
    for (let index = 0; index < this.spawnPointAccumulators.length; index++) {
      this.spawnPointAccumulators[index] = 0;
      this.startedSpawnPointWaves[index] = false;
    }
    this.recentCells.length = 0;
    this.exhaustionWarned = false;
    this.elapsedMs = 0;
    this.bossSpawned = false;
    this.airstrikeBarrageGateOpenedAtMs = null;
  }

  isBossDefeated(): boolean {
    return !!this.bossConfig
      && this.bossSpawned
      && !this.enemyManager.hasEnemyKind(this.bossConfig.enemyKind);
  }

  /**
   * Einmaliger Ausführungspfad für den MapDirector. Die Auswahl der normalen linken Spawnregion,
   * Flow-Field-Erreichbarkeit, Abstände und Sonderfälle bleiben bewusst hier gebündelt.
   */
  hostSpawnEncounterGroup(kind: CoopDefenseEnemyKind, count: number): void {
    this.runWave(kind, count);
  }

  private runWave(kind: CoopDefenseEnemyKind, count: number): void {
    if (count <= 0) return;
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

  private runSpawnPointWave(source: BaseSpec, count: number): void {
    if (!source.spawnCenter || !source.spawnWave || count <= 0) return;
    const spawnOptions: EnemySpawnOptions = { spawnBurrowed: true };
    for (let index = 0; index < count; index += 1) {
      this.enemyManager.hostSpawnAtWorld(
        source.spawnCenter.x,
        source.spawnCenter.y,
        source.spawnWave.enemyKind,
        spawnOptions,
      );
    }
  }

  private getSpawnPointSources(): readonly BaseSpec[] {
    return this.spawnPointBases.filter((base) => base.role === 'spawn-point' && base.spawnCenter && base.spawnWave);
  }

  private spawnOne(kind: CoopDefenseEnemyKind): boolean {
    let candidates = this.collectCandidates(kind);
    if (candidates.length === 0 && this.bossConfig?.enemyKind === kind && this.bossFlowFieldService) {
      candidates = this.collectCandidates(kind, this.flowFieldService);
    }
    if (candidates.length === 0) {
      this.warnExhausted();
      return false;
    }

    const pick = Phaser.Math.RND.pick(candidates) as { gridX: number; gridY: number };
    this.enemyManager.hostSpawnDummyAt(pick.gridX, pick.gridY, kind);
    this.pushRecent(this.key(pick.gridX, pick.gridY));
    return true;
  }

  private collectCandidates(
    kind: CoopDefenseEnemyKind,
    fallbackFlowFieldService?: EnemyFlowFieldService,
  ): { gridX: number; gridY: number }[] {
    if (getCoopDefenseEnemyConfig(kind).burrow?.spawnBurrowedAtLeftEdge) {
      return this.collectLeftEdgeCandidates(kind);
    }

    const flowFieldService = fallbackFlowFieldService
      ?? (this.bossConfig?.enemyKind === kind && this.bossFlowFieldService
      ? this.bossFlowFieldService
      : this.flowFieldService);
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

  /**
   * Eingebuddelt startende Gegner erscheinen direkt in der äußersten linken Spalte – auch dort,
   * wo Felsen den Weg versperren. Sie graben sich anschließend geradeaus nach rechts frei
   * (siehe CoopDefenseEnemyBurrowSystem), Begehbarkeit ist beim Spawn deshalb irrelevant.
   *
   * Bevorzugt werden Reihen mit der kürzesten Grabstrecke bis zum ersten begehbaren, erreichbaren
   * Feld. Auf stark zugebauten Maps taucht der Gegner dadurch am Eingang eines Weges auf, statt
   * sich minutenlang quer durch das Felsfeld zu wühlen.
   */
  private collectLeftEdgeCandidates(kind: CoopDefenseEnemyKind): { gridX: number; gridY: number }[] {
    const enemies = this.enemyManager.getAllEnemies();
    const spawnRadius = getCoopDefenseEnemyConfig(kind).size * 0.5;

    const rows: { gridY: number; digCells: number | null }[] = [];
    let shortestDigCells = Number.POSITIVE_INFINITY;
    for (let gridY = 0; gridY < GRID_ROWS; gridY++) {
      const world = this.flowFieldService.gridToWorld(0, gridY);
      if (!world) continue;
      const overlapsEnemy = enemies.some((enemy) => {
        const minimumDistance = spawnRadius + enemy.getCollisionRadius();
        return Phaser.Math.Distance.Squared(world.x, world.y, enemy.sprite.x, enemy.sprite.y)
          < minimumDistance * minimumDistance;
      });
      if (overlapsEnemy) continue;

      const digCells = this.measureLeftEdgeDigDistance(gridY);
      if (digCells !== null) shortestDigCells = Math.min(shortestDigCells, digCells);
      rows.push({ gridY, digCells });
    }

    // Meldet keine Reihe erreichbaren Boden (etwa bevor das Flow-Field steht), zählt wie bisher
    // jede freie Randzelle; sonst gewinnen die Reihen mit der kürzesten Grabstrecke.
    if (!Number.isFinite(shortestDigCells)) {
      return rows.map((row) => ({ gridX: 0, gridY: row.gridY }));
    }

    const maxDigCells = shortestDigCells + SPAWN_TUNNEL_DIG_TOLERANCE_CELLS;
    return rows
      .filter((row) => row.digCells !== null && row.digCells <= maxDigCells)
      .map((row) => ({ gridX: 0, gridY: row.gridY }));
  }

  /** Spalten-Index des ersten begehbaren, erreichbaren Feldes einer Reihe; null = ganze Reihe zu. */
  private measureLeftEdgeDigDistance(gridY: number): number | null {
    for (let gridX = 0; gridX < GRID_COLS; gridX++) {
      if (!this.flowFieldService.isTraversableAt(gridX, gridY)) continue;
      if (this.flowFieldService.getIntegrationValueAt(gridX, gridY) >= EnemyFlowFieldService.INTEGRATION_INFINITY) continue;
      return gridX;
    }
    return null;
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

  /**
   * Effektiver Startzeitpunkt einer Welle: normal `startAtMs`, außer die Welle wartet auf das
   * Ende des Luftangriffs-Eröffnungsbombardements – dann frühestens `startAtMs`, aber nicht bevor
   * das Bombardement abgeschlossen ist (null = Gate noch geschlossen, Welle startet noch nicht).
   */
  private getEffectiveStartAtMs(waveConfig: ResolvedCoopDefenseMapWaveConfig): number | null {
    if (!waveConfig.startsAfterAirstrikeBarrage) return waveConfig.startAtMs;
    if (this.airstrikeBarrageGateOpenedAtMs === null) return null;
    return Math.max(waveConfig.startAtMs, this.airstrikeBarrageGateOpenedAtMs);
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
