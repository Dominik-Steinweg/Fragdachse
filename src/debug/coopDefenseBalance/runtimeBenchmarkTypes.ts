import type { CombatDamageKind, WeaponSlot } from '../../types';

export type RuntimeBenchmarkScenario = 'single_target' | 'five_target';
export type RuntimeBenchmarkTailStatus = 'complete' | 'truncated' | 'unknown';

/** Actual Activity counters, distinct from local-player gross weapon rewards. */
export interface RuntimeBenchmarkEssenceSnapshot {
  readonly worldRevision: number;
  readonly activityRevision: number;
  readonly authoredValue: number;
  readonly materializedValue: number;
  readonly committedValue: number;
  readonly expiredValue: number;
  readonly placementFailedValue: number;
  readonly lifecycleDiscardedValue: number;
}

export interface RuntimeBenchmarkEssenceAccounting extends RuntimeBenchmarkEssenceSnapshot {
  /** Deltas of real events in the measurement window; may include warmup essence arrivals/expiry. */
  readonly measurement: 'activity-measurement-window';
}

export interface RuntimeBenchmarkRequest {
  readonly slot: WeaponSlot;
  readonly scenario: RuntimeBenchmarkScenario;
  readonly distance: number;
  readonly warmupMs: number;
  readonly measurementMs: number;
  readonly settleMs: number;
}

export interface RuntimeBenchmarkResult {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly createdAt: string;
  readonly weaponId: string;
  readonly slot: WeaponSlot;
  readonly scenario: RuntimeBenchmarkScenario;
  readonly targetCount: number;
  readonly distance: number;
  readonly warmupMs: number;
  readonly measurementMs: number;
  readonly settleMs: number;
  readonly upgradeLevels: Readonly<Record<string, number>>;
  readonly buildSignature: string;
  readonly shotsFired: number;
  readonly damagingHitEvents: number;
  readonly criticalDamageEvents: number;
  readonly targetsDamaged: number;
  readonly totalDamage: number;
  readonly dps: number;
  readonly damageByKind: Readonly<Partial<Record<CombatDamageKind, number>>>;
  readonly tailDamage: number;
  /** Gross theoretical primary-hit value, independent of cap, distance and collection. */
  readonly adrenalineGenerated: number;
  readonly adrenalineMeasurement?: 'gross-primary-hit-reward';
  /** Actual observed resource gains in the controlled run, separate from gross generation. */
  readonly adrenalineResourceGained?: number;
  /** Absent when the Activity accounting was unavailable or changed scope during the run. */
  readonly essenceAccounting?: RuntimeBenchmarkEssenceAccounting;
  readonly adrenalineGeneratedPerSecond: number;
  readonly adrenalineConsumed: number;
  readonly adrenalinePerSecond: number;
  readonly tailStatus: RuntimeBenchmarkTailStatus;
  readonly activeOwnedProjectilesAtEnd: number;
  readonly activeBurnSourcesAtEnd: number;
}
