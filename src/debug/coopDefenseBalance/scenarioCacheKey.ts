import type { WeaponSlot } from '../../types';
import type { FiveTargetScenarioConfig, SingleTargetScenarioConfig, WeaponBalanceScenario } from './scenarioTypes';
import type { WeaponConfig } from '../../loadout/LoadoutConfig';

type JsonLike = null | boolean | number | string | readonly JsonLike[] | { readonly [key: string]: JsonLike };

export function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
}

export interface ScenarioCacheKeyOptions {
  readonly weaponId: string;
  readonly slot: WeaponSlot;
  readonly buildSignature: string;
  readonly scenario: WeaponBalanceScenario;
  readonly scenarioConfig: SingleTargetScenarioConfig | FiveTargetScenarioConfig;
  readonly seeds: readonly number[];
  readonly stepDeltaMs: number;
}

/** Stabiler Cache-Key fuer alle scenariofaehigen Progressionsanalyzer. */
export function buildScenarioCacheKey(options: ScenarioCacheKeyOptions): string {
  const payload: JsonLike = {
    weaponId: options.weaponId,
    slot: options.slot,
    buildSignature: options.buildSignature,
    scenario: options.scenario,
    scenarioId: options.scenarioConfig.id,
    scenarioVersion: options.scenarioConfig.version,
    scenarioConfig: options.scenarioConfig as unknown as JsonLike,
    layoutVersion: 'layoutVersion' in options.scenarioConfig
      ? options.scenarioConfig.layoutVersion
      : null,
    seeds: options.seeds,
    attackWindowMs: options.scenarioConfig.attackWindowMs,
    warmupMs: options.scenarioConfig.warmupMs,
    settleLimitMs: options.scenarioConfig.settleLimitMs,
    stepDeltaMs: options.stepDeltaMs,
  };
  return stableSerialize(payload);
}

export interface BenchmarkRunCacheKeyOptions {
  readonly weaponId: string;
  readonly slot: WeaponSlot;
  readonly weaponConfig: WeaponConfig;
  readonly scenario: SingleTargetScenarioConfig | FiveTargetScenarioConfig;
  readonly scenarioKind: WeaponBalanceScenario;
  readonly seed: number;
  readonly stepDeltaMs: number;
}

/** Stabiler Key fuer einen einzelnen reinen Benchmark-Run, unabhaengig von Eventaufzeichnung. */
export function buildBenchmarkRunCacheKey(options: BenchmarkRunCacheKeyOptions): string {
  return stableSerialize({
    weaponId: options.weaponId,
    slot: options.slot,
    weaponConfig: options.weaponConfig as unknown as JsonLike,
    scenarioKind: options.scenarioKind,
    scenarioId: options.scenario.id,
    scenarioVersion: options.scenario.version,
    scenario: options.scenario as unknown as JsonLike,
    seed: options.seed,
    stepDeltaMs: options.stepDeltaMs,
  });
}
