import type { LoadoutSlot } from '../../types';
import type { WeaponConfig } from '../../loadout/LoadoutConfig';

/** Ein einzelnes aufgezeichnetes Schadensereignis im Benchmark. */
export interface DamageEventRecord {
  readonly timestampMs: number;
  readonly targetId: string;
  readonly damage: number;
  readonly sourceId: string;
  readonly damageKind: 'direct' | 'burn' | 'chain' | 'radial' | 'reflected';
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
  /** Virtuelle Simulationsdauer in Millisekunden. Standard: 30_000 (30 Sekunden). */
  readonly durationMs?: number;
  /** Diskrete Zeitschritt-Länge in ms. Standard: 16 (ca. 60 Hz). */
  readonly stepDeltaMs?: number;
  /** Deterministischer PRNG-Seed. Standard: 1. */
  readonly seed?: number;
  /**
   * Abstand zwischen Schütze und Ziel in Pixeln.
   * Wenn nicht angegeben, wird automatisch ein waffentypspezifischer Standardabstand gewählt
   * (z.B. 40px für Nahkampf, 150px für Fernkampf).
   */
  readonly targetDistance?: number;
  /** Slot der Waffe ('weapon1' | 'weapon2'). Standardmäßig aus allowedSlots der Waffe. */
  readonly sourceSlot?: LoadoutSlot;
  /** Optionale modifizierte WeaponConfig (für Reaktivitäts- und Modifikator-Tests). */
  readonly weaponConfigOverride?: WeaponConfig;
}

/** Strukturiertes Messergebnis eines Single-Target-Benchmark-Laufs. */
export interface SingleTargetBenchmarkResult {
  readonly weaponId: string;
  readonly durationMs: number;
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
