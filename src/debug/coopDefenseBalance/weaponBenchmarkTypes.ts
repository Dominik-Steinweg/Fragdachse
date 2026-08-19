import type { CombatDamageKind, WeaponSlot } from '../../types';
import type { WeaponConfig } from '../../loadout/LoadoutConfig';

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
  /** ID der zu testenden Waffe, z. B. 'P90', 'ASMD_PRIM', 'BITE'. */
  readonly weaponId: string;
  /** Virtuelles Angriffsfenster (Attack Window) in Millisekunden. Standard: 30_000 (30 Sekunden). */
  readonly durationMs?: number;
  /** Diskrete Zeitschritt-Länge in ms. Standard: 16. */
  readonly stepDeltaMs?: number;
  /** Deterministischer PRNG-Seed. Standard: 1. */
  readonly seed?: number;
  /**
   * Abstand zwischen Schütze und Ziel in Pixeln.
   * Wenn nicht angegeben, wird automatisch ein waffentypspezifischer Standardabstand gewählt
   * (z.B. 40px für Nahkampf, 150px für Fernkampf).
   */
  readonly targetDistance?: number;
  /** Slot der Waffe ('weapon1' | 'weapon2'). */
  readonly sourceSlot?: WeaponSlot;
  /** Optionale modifizierte WeaponConfig (für Reaktivitäts- und Modifikator-Tests). */
  readonly weaponConfigOverride?: WeaponConfig;
  /** Maximale Dauer der Settle-Phase nach dem Angriffsfenster in ms. Standard: 5_000. */
  readonly maxSettleDurationMs?: number;
  /** Falls false, werden keine detaillierten Damage-/Resource-Eventlisten allokiert (Lightweight-Modus). Standard: true. */
  readonly recordEvents?: boolean;
}

/** Strukturiertes Messergebnis eines Single-Target-Benchmark-Laufs. */
export interface SingleTargetBenchmarkResult {
  readonly weaponId: string;
  readonly durationMs: number;
  readonly settleDurationMs: number;
  readonly totalDamage: number;
  readonly dps: number;
  readonly shotsFired: number;
  readonly hits: number;
  readonly hitRate: number;
  readonly adrenalineGenerated: number;
  readonly adrenalineSpent: number;
  readonly adrenalineGeneratedPerSec: number;
  readonly adrenalineSpentPerSec: number;
  readonly damageEvents: readonly DamageEventRecord[];
  readonly resourceEvents: readonly ResourceEventRecord[];
}

/** Konfigurationsoptionen für einen Multi-Seed-Benchmark-Lauf. */
export interface SingleTargetBenchmarkSetOptions {
  readonly weaponId: string;
  readonly weaponConfigOverride?: WeaponConfig;
  readonly sourceSlot?: WeaponSlot;
  readonly durationMs?: number;
  readonly stepDeltaMs?: number;
  readonly targetDistance?: number;
  readonly maxSettleDurationMs?: number;
  readonly seeds?: readonly number[];
  readonly includeIndividualRuns?: boolean;
}

/** Strukturiertes Aggregationsergebnis über mehrere Seeds. */
export interface SingleTargetBenchmarkAggregate {
  readonly weaponId: string;
  readonly seedCount: number;
  readonly seeds: readonly number[];
  readonly expectedDps: number;       // Mittelwert (Mean DPS)
  readonly medianDps: number;         // 50. Perzentil
  readonly p10Dps: number;            // 10. Perzentil
  readonly p90Dps: number;            // 90. Perzentil
  readonly minDps: number;
  readonly maxDps: number;
  readonly expectedHitRate: number;
  readonly expectedShotsPerSecond: number;
  readonly expectedAdrenalineGeneratedPerSec: number;
  readonly expectedAdrenalineSpentPerSec: number;
  readonly runs?: readonly SingleTargetBenchmarkResult[];
}
