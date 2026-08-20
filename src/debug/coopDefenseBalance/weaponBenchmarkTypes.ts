import type { CombatDamageKind, WeaponSlot } from '../../types';
import type { WeaponConfig } from '../../loadout/LoadoutConfig';
import type { FiveTargetScenarioConfig, SingleTargetScenarioConfig } from './scenarioTypes';
import type { HeadlessTarget } from './HeadlessSingleTargetWorld';

/** Standard-Seed-Set für deterministische Multi-Seed-Aggregationen (16 Seeds). */
export const DEFAULT_BENCHMARK_SEEDS: readonly number[] = Object.freeze([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
]);

/** Ein einzelnes aufgezeichnetes Schadensereignis im Benchmark. */
export interface DamageEventRecord {
  readonly timestampMs: number;
  readonly targetId: string;
  readonly damage: number;
  readonly sourceId: string;
  readonly damageKind: CombatDamageKind;
  readonly isCritical?: boolean;
}

/** Ein einzelnes Ressourcenereignis (z.B. Adrenalingewinn oder -verbrauch). */
export interface ResourceEventRecord {
  readonly timestampMs: number;
  readonly action: 'gain' | 'drain';
  readonly amount: number;
  readonly resourceKind: 'adrenaline';
  readonly sourceId?: string;
}

/** Konfigurationsoptionen für den Single-Target-Benchmark. */
export interface SingleTargetBenchmarkOptions {
  /** ID der zu testenden Waffe, z. B. 'P90', 'ASMD_PRIM', 'BITE', 'GLOCK'. */
  readonly weaponId: string;
  /**
   * Versioniertes Szenario-Profil. Fehlt es, wird
   * `DEFAULT_SINGLE_TARGET_SCENARIO_CONFIG` verwendet.
   */
  readonly scenarioConfig?: SingleTargetScenarioConfig;
  /**
   * Legacy-Override fuer die Dauer des versionierten Measurement Windows.
   * Neue Aufrufer sollten `scenarioConfig.attackWindowMs` verwenden.
   */
  readonly durationMs?: number;
  /** Diskrete Zeitschritt-Länge in ms. Standard: 16. */
  readonly stepDeltaMs?: number;
  /** Deterministischer PRNG-Seed. Standard: 1. */
  readonly seed?: number;
  /**
   * Legacy-Override fuer `scenarioConfig.targetDistance`.
   * Es gibt keine waffentypspezifische automatische Distanz mehr.
   */
  readonly targetDistance?: number;
  /** Slot der Waffe ('weapon1' | 'weapon2'). */
  readonly sourceSlot?: WeaponSlot;
  /** Optionale modifizierte WeaponConfig (für Reaktivitäts- und Modifikator-Tests). */
  readonly weaponConfigOverride?: WeaponConfig;
  /** Legacy-Override fuer `scenarioConfig.settleLimitMs`. */
  readonly maxSettleDurationMs?: number;
  /** Falls false, werden keine detaillierten Damage-/Resource-Eventlisten allokiert (Lightweight-Modus). Standard: true. */
  readonly recordEvents?: boolean;
}

/** Strukturiertes Messergebnis eines Single-Target-Benchmark-Laufs. */
export interface SingleTargetBenchmarkResult {
  readonly weaponId: string;
  readonly scenarioId: SingleTargetScenarioConfig['id'];
  readonly scenarioVersion: SingleTargetScenarioConfig['version'];
  readonly warmupMs: number;
  readonly measurementStartMs: number;
  readonly measurementEndMs: number;
  readonly durationMs: number;
  readonly settleDurationMs: number;
  /** Schaden ausschließlich aus [measurementStartMs, measurementEndMs). */
  readonly totalDamage: number;
  readonly directDamage: number;
  readonly burnDamage: number;
  /** Vollständiger Schaden inklusive Warmup-/Settle-Tail. */
  readonly damageYieldIncludingTail: number;
  readonly directDamageIncludingTail: number;
  readonly burnDamageIncludingTail: number;
  readonly tailDamage: number;
  readonly tailDirectDamage: number;
  readonly tailBurnDamage: number;
  readonly dps: number;
  readonly directDps: number;
  readonly burnDps: number;
  readonly shotsFired: number;
  readonly hits: number;
  /** V0.8-Kompatibilitaetsrate ueber alle aufgezeichneten Treffer. */
  readonly hitRate: number;
  /** Primaere Rate-Zaehler, strikt aus [measurementStartMs, measurementEndMs). */
  readonly measurementShotsFired: number;
  readonly measurementTargetHits: number;
  readonly measurementProjectileHits: number;
  readonly measurementHitRate: number;
  readonly measurementAdrenalineGenerated: number;
  readonly measurementAdrenalineSpent: number;
  readonly adrenalineGenerated: number;
  readonly adrenalineSpent: number;
  readonly adrenalineGeneratedPerSec: number;
  readonly adrenalineSpentPerSec: number;
  readonly primaryMetricComplete: boolean;
  readonly tailComplete: boolean;
  readonly settleTruncated?: boolean;
  readonly damageEvents: readonly DamageEventRecord[];
  readonly resourceEvents: readonly ResourceEventRecord[];
}

/** Konfigurationsoptionen für einen Multi-Seed-Benchmark-Lauf. */
export interface SingleTargetBenchmarkSetOptions {
  readonly weaponId: string;
  readonly weaponConfigOverride?: WeaponConfig;
  readonly sourceSlot?: WeaponSlot;
  readonly scenarioConfig?: SingleTargetScenarioConfig;
  readonly durationMs?: number;
  readonly stepDeltaMs?: number;
  /** Legacy-Override fuer `scenarioConfig.targetDistance`. */
  readonly targetDistance?: number;
  /** Legacy-Override fuer `scenarioConfig.settleLimitMs`. */
  readonly maxSettleDurationMs?: number;
  readonly seeds?: readonly number[];
  readonly includeIndividualRuns?: boolean;
}

/** Strukturiertes Aggregationsergebnis über mehrere Seeds. */
export interface SingleTargetBenchmarkAggregate {
  readonly weaponId: string;
  readonly scenarioId: SingleTargetScenarioConfig['id'];
  readonly scenarioVersion: SingleTargetScenarioConfig['version'];
  readonly seedCount: number;
  readonly seeds: readonly number[];
  readonly expectedDps: number;       // Mittelwert (Mean Total DPS)
  readonly expectedDirectDps: number; // Mittelwert (Mean Direct DPS)
  readonly expectedBurnDps: number;   // Mittelwert (Mean Burn DPS)
  readonly expectedDamageYieldIncludingTail: number;
  readonly expectedTailDamage: number;
  readonly medianDps: number;         // 50. Perzentil
  readonly p10Dps: number;            // 10. Perzentil
  readonly p90Dps: number;            // 90. Perzentil
  readonly minDps: number;
  readonly maxDps: number;
  readonly expectedHitRate: number;
  readonly expectedShotsPerSecond: number;
  readonly expectedAdrenalineGeneratedPerSec: number;
  readonly expectedAdrenalineSpentPerSec: number;
  readonly primaryMetricComplete: boolean;
  readonly tailComplete: boolean;
  readonly settleTruncated?: boolean;
  readonly runs?: readonly SingleTargetBenchmarkResult[];
}

/** Konfigurationsoptionen fuer einen versionierten Five-Target-Benchmark. */
export interface FiveTargetBenchmarkOptions {
  readonly weaponId: string;
  readonly scenarioConfig?: FiveTargetScenarioConfig;
  readonly durationMs?: number;
  readonly stepDeltaMs?: number;
  /** Oeffentlicher Benchmark-Seed; Layout- und Weapon-Seed werden daraus getrennt abgeleitet. */
  readonly seed?: number;
  readonly sourceSlot?: WeaponSlot;
  readonly weaponConfigOverride?: WeaponConfig;
  readonly maxSettleDurationMs?: number;
  readonly recordEvents?: boolean;
}

/** Einzelresultat des statischen 5T-Benchmarks. */
export interface FiveTargetBenchmarkResult {
  readonly weaponId: string;
  readonly scenarioId: FiveTargetScenarioConfig['id'];
  readonly scenarioVersion: FiveTargetScenarioConfig['version'];
  readonly benchmarkSeed: number;
  readonly layoutSeed: number;
  readonly weaponSeed: number;
  readonly targetLayout: readonly HeadlessTarget[];
  readonly warmupMs: number;
  readonly measurementStartMs: number;
  readonly measurementEndMs: number;
  readonly durationMs: number;
  readonly settleDurationMs: number;
  readonly measurementTotalDamage: number;
  readonly measurementDirectDamage: number;
  readonly measurementBurnDamage: number;
  readonly totalDamage: number;
  readonly directDamage: number;
  readonly burnDamage: number;
  readonly damageYieldIncludingTail: number;
  readonly directDamageIncludingTail: number;
  readonly burnDamageIncludingTail: number;
  readonly tailDamage: number;
  readonly tailDirectDamage: number;
  readonly tailBurnDamage: number;
  readonly dps: number;
  readonly directDps: number;
  readonly burnDps: number;
  /** Primary target-hit counter, restricted to [measurementStartMs, measurementEndMs). */
  readonly targetHits: number;
  readonly measurementTargetHits: number;
  readonly measurementProjectileHits: number;
  readonly shotsFired: number;
  readonly measurementShotsFired: number;
  readonly targetsHitPerShot: number;
  readonly projectileHitRate?: number;
  /** Primary resource counters, restricted to the Measurement Window. */
  readonly adrenalineGenerated: number;
  readonly adrenalineSpent: number;
  readonly measurementAdrenalineGenerated: number;
  readonly measurementAdrenalineSpent: number;
  readonly adrenalineGeneratedPerSec: number;
  readonly adrenalineSpentPerSec: number;
  readonly primaryMetricComplete: boolean;
  readonly tailComplete: boolean;
  readonly settleTruncated?: boolean;
  readonly damageEvents: readonly DamageEventRecord[];
  readonly resourceEvents: readonly ResourceEventRecord[];
}

export interface FiveTargetBenchmarkSetOptions {
  readonly weaponId: string;
  readonly weaponConfigOverride?: WeaponConfig;
  readonly sourceSlot?: WeaponSlot;
  readonly scenarioConfig?: FiveTargetScenarioConfig;
  readonly durationMs?: number;
  readonly stepDeltaMs?: number;
  readonly maxSettleDurationMs?: number;
  readonly seeds?: readonly number[];
  readonly includeIndividualRuns?: boolean;
}

/** Deterministische Multi-Seed-Aggregation fuer den 5T-Total-DPS. */
export interface FiveTargetBenchmarkAggregate {
  readonly weaponId: string;
  readonly scenarioId: FiveTargetScenarioConfig['id'];
  readonly scenarioVersion: FiveTargetScenarioConfig['version'];
  readonly seedCount: number;
  readonly seeds: readonly number[];
  readonly expectedDps: number;
  readonly expectedDirectDps: number;
  readonly expectedBurnDps: number;
  readonly expectedDamageYieldIncludingTail: number;
  readonly expectedTailDamage: number;
  readonly medianDps: number;
  readonly p10Dps: number;
  readonly p90Dps: number;
  readonly minDps: number;
  readonly maxDps: number;
  readonly expectedTargetsHitPerShot: number;
  readonly expectedProjectileHitRate: number;
  readonly expectedShotsPerSecond: number;
  readonly expectedAdrenalineGeneratedPerSec: number;
  readonly expectedAdrenalineSpentPerSec: number;
  readonly primaryMetricComplete: boolean;
  readonly tailComplete: boolean;
  readonly settleTruncated?: boolean;
  readonly runs?: readonly FiveTargetBenchmarkResult[];
}
