import type { BaseSpec } from '../arena/BaseRegistry';
import type { CoopDefenseMapSpawnAreaConfig, ResolvedCoopDefenseMapPersistentSpawnConfig } from '../config/coopDefenseMaps';
import type { CoopDefenseEnemyKind } from '../config/coopDefenseEnemies';
import type { SpawnFront, SyncedSpawnZoneAlert } from '../types';
import { SPAWN_ZONE_ALERT_LEAD_MS } from './CoopDefenseSpawnZoneAlerts';

interface PersistentPressureSpawnExecutor {
  hostSpawnPersistentMapGroup(kind: CoopDefenseEnemyKind, count: number, front?: SpawnFront,
    spawnArea?: CoopDefenseMapSpawnAreaConfig, spawnZoneId?: string): readonly string[];
  hostSpawnPersistentStructureGroup(source: BaseSpec, kind: CoopDefenseEnemyKind, count: number): void;
}

/** Host-only scheduler for optional, unbounded background pressure sources. */
export class CoopDefensePersistentPressureSystem {
  private readonly accumulators: number[];
  private readonly startedSources: boolean[];
  /** Spawn structures announce even their first release (GDD Spawnbauwerk V1): its mission time. */
  private readonly firstReleaseAt: (number | null)[];
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
    this.firstReleaseAt = sources.map(() => null);
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
        if (source.source.type === 'base') {
          // The structure charges visibly before its first brood rises; the interval counts from then.
          this.firstReleaseAt[index] ??= this.elapsedMs + SPAWN_ZONE_ALERT_LEAD_MS;
          if (this.elapsedMs < this.firstReleaseAt[index]!) continue;
          this.firstReleaseAt[index] = null;
          this.startedSources[index] = true;
          this.spawnSource(source);
          continue;
        }
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
    this.firstReleaseAt.fill(null);
    this.elapsedMs = 0;
  }

  getElapsedMs(): number {
    return this.elapsedMs;
  }

  /** Zone sources release enemies from their start until the mission ends: upcoming, then active. */
  collectSpawnZoneUse(active: Set<string>, upcoming: Set<string>): void {
    for (const source of this.sources) {
      if (source.source.type !== 'zone') continue;
      (this.elapsedMs >= source.startAtMs ? active : upcoming).add(source.source.zoneId);
    }
  }

  /**
   * The next release of every active zone and structure source, announced SPAWN_ZONE_ALERT_LEAD_MS
   * ahead: a zone's haze thickens (GDD Void-Gefahrenzonen V1, E4), a spawn structure charges and its
   * brood pool heaves (GDD Spawnbauwerk V1).
   */
  getSpawnZoneAlerts(out: SyncedSpawnZoneAlert[] = []): SyncedSpawnZoneAlert[] {
    for (const [index, source] of this.sources.entries()) {
      if (source.source.type === 'map' || !this.isSourceActive(source)) continue;
      if (source.source.type === 'base') {
        if (!this.startedSources[index] && this.elapsedMs < source.startAtMs) continue;
        const atMs = this.startedSources[index] ? this.elapsedMs + source.intervalMs - this.accumulators[index]
          : this.firstReleaseAt[index] ?? this.elapsedMs + SPAWN_ZONE_ALERT_LEAD_MS;
        out.push({ zoneId: source.source.baseId, structure: true, fromMs: atMs - SPAWN_ZONE_ALERT_LEAD_MS, atMs, endMs: atMs });
        continue;
      }
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
      if (source.spawnArea) this.spawnExecutor.hostSpawnPersistentMapGroup(source.enemyKind, source.countPerTick, undefined, source.spawnArea, source.source.zoneId);
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
