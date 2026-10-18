import type { BaseSpec } from '../arena/BaseRegistry';
import type { CoopDefenseMapSpawnAreaConfig, ResolvedCoopDefenseMapPersistentSpawnConfig } from '../config/coopDefenseMaps';
import type { CoopDefenseEnemyKind } from '../config/coopDefenseEnemies';
import type { SpawnFront, SyncedSpawnZoneAlert } from '../types';
import { SPAWN_ZONE_ALERT_LEAD_MS } from './CoopDefenseSpawnZoneAlerts';

interface PersistentPressureSpawnExecutor {
  hostSpawnPersistentMapGroup(kind: CoopDefenseEnemyKind, count: number, front?: SpawnFront,
    spawnArea?: CoopDefenseMapSpawnAreaConfig): readonly string[];
  hostSpawnPersistentStructureGroup(source: BaseSpec, kind: CoopDefenseEnemyKind, count: number): void;
}

/** Host-only scheduler for optional, unbounded background pressure sources. */
export class CoopDefensePersistentPressureSystem {
  private readonly accumulators: number[];
  private readonly startedSources: boolean[];
  private readonly basesById: ReadonlyMap<string, BaseSpec>;
  private elapsedMs = 0;

  constructor(
    private readonly sources: readonly ResolvedCoopDefenseMapPersistentSpawnConfig[],
    private readonly spawnExecutor: PersistentPressureSpawnExecutor,
    bases: readonly BaseSpec[] = [],
    private readonly getActiveBaseIds: () => ReadonlySet<string> = () => new Set<string>(),
  ) {
    this.accumulators = sources.map(() => 0);
    this.startedSources = sources.map(() => false);
    this.basesById = new Map(bases.map((base) => [base.id, base]));
  }

  hostUpdate(deltaMs: number, countdownActive: boolean): void {
    if (countdownActive) return;
    const previousElapsedMs = this.elapsedMs;
    this.elapsedMs += Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;

    for (const [index, source] of this.sources.entries()) {
      if (!this.isSourceActive(source)) continue;
      if (this.elapsedMs < source.startAtMs) continue;

      if (!this.startedSources[index]) {
        this.startedSources[index] = true;
        this.spawnSource(source);
      }

      const activeDeltaMs = this.getActiveDeltaMs(previousElapsedMs, this.elapsedMs, source.startAtMs);
      if (activeDeltaMs <= 0) continue;
      let accumulator = this.accumulators[index] + activeDeltaMs;
      while (accumulator >= source.intervalMs) {
        accumulator -= source.intervalMs;
        this.spawnSource(source);
      }
      this.accumulators[index] = accumulator;
    }
  }

  reset(): void {
    this.accumulators.fill(0);
    this.startedSources.fill(false);
    this.elapsedMs = 0;
  }

  getElapsedMs(): number {
    return this.elapsedMs;
  }

  /**
   * The next release of every active zone source, announced SPAWN_ZONE_ALERT_LEAD_MS ahead so
   * its haze thickens before each tick (GDD Void-Gefahrenzonen V1, E4).
   */
  getSpawnZoneAlerts(out: SyncedSpawnZoneAlert[] = []): SyncedSpawnZoneAlert[] {
    for (const [index, source] of this.sources.entries()) {
      if (source.source.type !== 'zone' || !this.isSourceActive(source)) continue;
      const atMs = this.startedSources[index] ? this.elapsedMs + source.intervalMs - this.accumulators[index] : source.startAtMs;
      out.push({ zoneId: source.source.zoneId, fromMs: atMs - SPAWN_ZONE_ALERT_LEAD_MS, atMs, endMs: atMs });
    }
    return out;
  }

  private isSourceActive(source: ResolvedCoopDefenseMapPersistentSpawnConfig): boolean {
    return source.source.type !== 'base'
      || this.getActiveBaseIds().has(source.source.baseId);
  }

  private spawnSource(source: ResolvedCoopDefenseMapPersistentSpawnConfig): void {
    if (source.source.type === 'map') {
      this.spawnExecutor.hostSpawnPersistentMapGroup(source.enemyKind, source.countPerTick, source.front);
      return;
    }
    if (source.source.type === 'zone') {
      if (source.spawnArea) this.spawnExecutor.hostSpawnPersistentMapGroup(source.enemyKind, source.countPerTick, undefined, source.spawnArea);
      return;
    }

    const base = this.basesById.get(source.source.baseId);
    if (base) this.spawnExecutor.hostSpawnPersistentStructureGroup(base, source.enemyKind, source.countPerTick);
  }

  private getActiveDeltaMs(previousElapsedMs: number, nextElapsedMs: number, startAtMs: number): number {
    if (nextElapsedMs <= startAtMs) return 0;
    const activeStartMs = Math.max(previousElapsedMs, startAtMs);
    return Math.max(0, nextElapsedMs - activeStartMs);
  }
}
