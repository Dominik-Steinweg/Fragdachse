import type { CombatDamageKind, WeaponSlot } from '../../types';

export type RuntimeBenchmarkScenario = 'single_target' | 'five_target';
export type RuntimeBenchmarkTailStatus = 'complete' | 'truncated' | 'unknown';

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
  readonly adrenalineGenerated: number;
  readonly adrenalineGeneratedPerSecond: number;
  readonly adrenalineConsumed: number;
  readonly adrenalinePerSecond: number;
  readonly tailStatus: RuntimeBenchmarkTailStatus;
  readonly activeOwnedProjectilesAtEnd: number;
  readonly activeBurnSourcesAtEnd: number;
}
