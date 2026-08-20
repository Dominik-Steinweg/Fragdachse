import { getWeaponConfig } from '../../loadout/LoadoutConfig';
import { applyCoopDefenseModifiersToWeaponConfig } from '../../loadout/CoopDefenseLoadoutModifiers';
import { getCoopDefenseResolvedEffectTotals } from '../../utils/coopDefenseUpgrades';
import { DEFAULT_COOP_DEFENSE_CLASS_ID } from '../../config/coopDefenseClasses';
import type { CoopDefenseClassId, WeaponSlot } from '../../types';
import {
  type FiveTargetScenarioConfig,
  type SingleTargetScenarioConfig,
  type WeaponBalanceScenario,
} from './scenarioTypes';
import { PROGRESSION_STAGES, type ProgressionStageName } from './progressionStages';
import {
  generateWeaponUpgradeBuilds,
  type WeaponUpgradeBuild,
} from './WeaponUpgradeBuildGenerator';
import { validateWeaponBalanceCapabilities } from './weaponCapabilityValidator';
import {
  resolveAndValidateWeaponSlot,
  resolveSingleTargetScenarioConfig,
  runWeaponSingleTargetBenchmarkSet,
} from './weaponBenchmark';
import {
  resolveFiveTargetScenarioConfig,
  runWeaponFiveTargetBenchmarkSet,
} from './fiveTargetBenchmark';
import {
  DEFAULT_BENCHMARK_SEEDS,
  type FiveTargetBenchmarkAggregate,
  type FiveTargetBenchmarkResult,
  type SingleTargetBenchmarkAggregate,
  type SingleTargetBenchmarkResult,
} from './weaponBenchmarkTypes';
import { buildScenarioCacheKey } from './scenarioCacheKey';

export type WeaponBenchmarkAggregate = SingleTargetBenchmarkAggregate | FiveTargetBenchmarkAggregate;
export type WeaponBenchmarkResult = SingleTargetBenchmarkResult | FiveTargetBenchmarkResult;
export type WeaponScenarioConfig = SingleTargetScenarioConfig | FiveTargetScenarioConfig;

export interface StageAnalysisResult {
  readonly stage: ProgressionStageName;
  readonly stageLabel: string;
  readonly normalPointBudget: number;
  readonly bossPointBudget: number;
  readonly bestSupportedBuild: WeaponUpgradeBuild | null;
  readonly bestSupportedExpectedDps: number;
  /** Alias fuer bestSupportedExpectedDps zur Abwaertskompatibilitaet. */
  readonly bestSupportedDps: number;
  readonly totalLegalCandidates: number;
  readonly evaluatedCandidates: number;
  readonly unsupportedCandidates: number;
  readonly unsupportedReasons: readonly string[];
  readonly unsupportedReasonCounts: Readonly<Record<string, number>>;
  /** Nur Kandidaten, deren primaeres Measurement Window unvollstaendig ist. */
  readonly incompleteCandidates: number;
  readonly incompleteReasons: readonly string[];
  readonly incompleteReasonCounts: Readonly<Record<string, number>>;
  /** Tail-Unvollstaendigkeit bleibt fuer Diagnose getrennt von incompleteCandidates. */
  readonly tailIncompleteCandidates: number;
  readonly tailIncompleteReasons: readonly string[];
  readonly tailIncompleteReasonCounts: Readonly<Record<string, number>>;
  readonly provenMaximum: boolean;
  readonly primaryMetricComplete: boolean;
  readonly tailComplete: boolean;
  readonly settleTruncated?: boolean;
  readonly benchmarkAggregate?: WeaponBenchmarkAggregate;
  readonly benchmarkResult?: WeaponBenchmarkResult;
}

export interface WeaponProgressionAnalysisResult {
  readonly weaponId: string;
  readonly slot: WeaponSlot;
  readonly scenario: WeaponBalanceScenario;
  readonly stages: readonly StageAnalysisResult[];
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly summaryText: string;
}

export interface AnalyzeWeaponProgressionOptions {
  readonly weaponId: string;
  readonly slot?: WeaponSlot;
  readonly scenario?: Extract<WeaponBalanceScenario, 'single_target_static' | 'five_target'>;
  readonly seeds?: readonly number[];
  /** Optionaler Einzel-Seed fuer Abwaertskompatibilitaet. */
  readonly seed?: number;
  readonly durationMs?: number;
  readonly stepDeltaMs?: number;
  readonly scenarioConfig?: WeaponScenarioConfig;
  readonly classId?: CoopDefenseClassId;
}

function aggregateHasFiveTargetMetrics(
  aggregate: WeaponBenchmarkAggregate,
): aggregate is FiveTargetBenchmarkAggregate {
  return 'expectedTargetsHitPerShot' in aggregate;
}

function formatProgressionSummary(
  weaponId: string,
  slot: WeaponSlot,
  scenario: Extract<WeaponBalanceScenario, 'single_target_static' | 'five_target'>,
  stages: readonly StageAnalysisResult[],
  cacheHits: number,
  cacheMisses: number,
): string {
  const isFiveTarget = scenario === 'five_target';
  const lines: string[] = [];
  lines.push(`=== ${isFiveTarget ? 'Five-Target' : 'Single-Target'} Progression: ${weaponId} (${slot}) [Scenario: ${scenario}] ===`);
  lines.push(`Cache-Statistik: ${cacheHits} Hits / ${cacheMisses} Misses (Simulationsläufe)`);

  for (const st of stages) {
    lines.push(`\n[${st.stageLabel.toUpperCase()}] Budget: ${st.normalPointBudget} normal / ${st.bossPointBudget} boss`);
    lines.push(`  Best Supported Expected ${isFiveTarget ? '5T Total' : 'ST'} DPS: ${st.bestSupportedExpectedDps.toFixed(1)}`);
    if (st.benchmarkAggregate) {
      const aggregate = st.benchmarkAggregate;
      if (aggregate.expectedBurnDps > 0) {
        lines.push(`    (Direct DPS: ${aggregate.expectedDirectDps.toFixed(1)} | Burn DPS: ${aggregate.expectedBurnDps.toFixed(1)})`);
      }
      lines.push(`    (Median: ${aggregate.medianDps.toFixed(1)} | P10: ${aggregate.p10Dps.toFixed(1)} | P90: ${aggregate.p90Dps.toFixed(1)} | Min: ${aggregate.minDps.toFixed(1)} | Max: ${aggregate.maxDps.toFixed(1)})`);
      if (aggregateHasFiveTargetMetrics(aggregate)) {
        lines.push(`    (Targets hit/shot: ${aggregate.expectedTargetsHitPerShot.toFixed(2)} | Shots/s: ${aggregate.expectedShotsPerSecond.toFixed(1)})`);
      } else {
        lines.push(`    (Expected Hit Rate: ${(aggregate.expectedHitRate * 100).toFixed(1)}% | Shots/s: ${aggregate.expectedShotsPerSecond.toFixed(1)})`);
      }
      lines.push(`    (Primary complete: ${aggregate.primaryMetricComplete ? 'YES' : 'NO'} | Tail complete: ${aggregate.tailComplete ? 'YES' : 'NO'})`);
    }
    lines.push(`  Proven Maximum: ${st.provenMaximum ? 'YES' : 'NO (partiell unterstützt)'}`);
    lines.push(`  Candidates: ${st.evaluatedCandidates}/${st.totalLegalCandidates} ausgewertet (${st.unsupportedCandidates} unsupported, ${st.incompleteCandidates} primary-incomplete)`);

    if (st.bestSupportedBuild && st.bestSupportedBuild.signature !== 'base') {
      lines.push('  Build:');
      for (const [upId, lvl] of Object.entries(st.bestSupportedBuild.levels)) {
        lines.push(`    - ${upId}: Level ${lvl}`);
      }
    } else {
      lines.push('  Build: Base (keine Upgrades)');
    }

    if (st.benchmarkAggregate) {
      if (slot === 'weapon1') {
        lines.push(`  Adrenalin/s generiert: ${st.benchmarkAggregate.expectedAdrenalineGeneratedPerSec.toFixed(1)}`);
      } else {
        lines.push(`  Adrenalin/s verbraucht: ${st.benchmarkAggregate.expectedAdrenalineSpentPerSec.toFixed(1)}`);
      }
      lines.push(`  Tail: ${st.tailComplete ? 'complete' : 'truncated'} (settleTruncated=${Boolean(st.settleTruncated)})`);
    }

    if (st.unsupportedReasons.length > 0) {
      lines.push('  Nicht unterstützte relevante Mechaniken:');
      for (const [reason, count] of Object.entries(st.unsupportedReasonCounts)) {
        lines.push(`    - ${reason} (${count} Kandidaten)`);
      }
    }
    if (st.incompleteReasons.length > 0) {
      lines.push(`  Primary-Incomplete Reasons: ${st.incompleteReasons.join(', ')}`);
    }
  }

  return lines.join('\n');
}

function resolveScenarioConfig(
  options: AnalyzeWeaponProgressionOptions,
  scenario: Extract<WeaponBalanceScenario, 'single_target_static' | 'five_target'>,
  fireType: string,
): WeaponScenarioConfig {
  if (scenario === 'single_target_static') {
    return resolveSingleTargetScenarioConfig({
      weaponId: options.weaponId,
      scenarioConfig: options.scenarioConfig as SingleTargetScenarioConfig | undefined,
      durationMs: options.durationMs,
      stepDeltaMs: options.stepDeltaMs,
    }, fireType);
  }
  return resolveFiveTargetScenarioConfig({
    weaponId: options.weaponId,
    scenarioConfig: options.scenarioConfig as FiveTargetScenarioConfig | undefined,
    durationMs: options.durationMs,
    stepDeltaMs: options.stepDeltaMs,
  }, fireType);
}

function analyzeWeaponProgression(
  options: AnalyzeWeaponProgressionOptions,
  scenario: Extract<WeaponBalanceScenario, 'single_target_static' | 'five_target'>,
): WeaponProgressionAnalysisResult {
  const baseConfig = getWeaponConfig(options.weaponId);
  if (!baseConfig) {
    throw new Error(`[WeaponBalanceLab] Unbekannte Weapon-ID: "${options.weaponId}"`);
  }
  const slot = resolveAndValidateWeaponSlot(baseConfig, options.slot);
  const classId = options.classId ?? DEFAULT_COOP_DEFENSE_CLASS_ID;

  if (options.scenario !== undefined && options.scenario !== scenario) {
    throw new Error(
      `[WeaponBalanceLab] Analyzer-Szenario "${scenario}" kann nicht mit "${options.scenario}" ausgefuehrt werden.`,
    );
  }

  const rawSeeds = options.seeds && options.seeds.length > 0
    ? options.seeds
    : options.seed !== undefined
      ? [options.seed]
      : DEFAULT_BENCHMARK_SEEDS;
  const seeds = Array.from(new Set(rawSeeds)).sort((a, b) => a - b);
  const stepDeltaMs = options.stepDeltaMs ?? 16;
  const scenarioConfig = resolveScenarioConfig(options, scenario, baseConfig.fire.type);
  const buildCache = new Map<string, WeaponBenchmarkAggregate>();
  let cacheHits = 0;
  let cacheMisses = 0;
  const stages: StageAnalysisResult[] = [];

  for (const stageDef of PROGRESSION_STAGES) {
    const candidates = generateWeaponUpgradeBuilds({
      weaponId: options.weaponId,
      slot,
      normalPointBudget: stageDef.normalPointBudget,
      bossPointBudget: stageDef.bossPointBudget,
      classId,
    });
    let bestBuild: WeaponUpgradeBuild | null = null;
    let bestExpectedDps = -Infinity;
    let bestAggregate: WeaponBenchmarkAggregate | undefined;
    let evaluatedCandidates = 0;
    let unsupportedCandidates = 0;
    let incompleteCandidates = 0;
    let tailIncompleteCandidates = 0;
    const unsupportedReasonCounts: Record<string, number> = {};
    const incompleteReasonCounts: Record<string, number> = {};
    const tailIncompleteReasonCounts: Record<string, number> = {};

    for (const candidate of candidates) {
      const effectTotals = getCoopDefenseResolvedEffectTotals(candidate.profile, classId);
      const modifiedConfig = applyCoopDefenseModifiersToWeaponConfig(baseConfig, slot, effectTotals);
      const capCheck = validateWeaponBalanceCapabilities(modifiedConfig, scenario);
      if (!capCheck.supported) {
        unsupportedCandidates += 1;
        for (const reason of capCheck.unsupportedRelevant) {
          unsupportedReasonCounts[reason] = (unsupportedReasonCounts[reason] ?? 0) + 1;
        }
        continue;
      }

      const cacheKey = buildScenarioCacheKey({
        weaponId: options.weaponId,
        slot,
        buildSignature: candidate.signature,
        scenario,
        scenarioConfig,
        seeds,
        stepDeltaMs,
      });
      let aggregate = buildCache.get(cacheKey);
      if (aggregate) {
        cacheHits += 1;
      } else {
        cacheMisses += 1;
        aggregate = scenario === 'single_target_static'
          ? runWeaponSingleTargetBenchmarkSet({
            weaponId: options.weaponId,
            weaponConfigOverride: modifiedConfig,
            sourceSlot: slot,
            seeds,
            stepDeltaMs,
            scenarioConfig: scenarioConfig as SingleTargetScenarioConfig,
            includeIndividualRuns: false,
          })
          : runWeaponFiveTargetBenchmarkSet({
            weaponId: options.weaponId,
            weaponConfigOverride: modifiedConfig,
            sourceSlot: slot,
            seeds,
            stepDeltaMs,
            scenarioConfig: scenarioConfig as FiveTargetScenarioConfig,
            includeIndividualRuns: false,
          });
        buildCache.set(cacheKey, aggregate);
      }

      if (!aggregate.tailComplete) {
        tailIncompleteCandidates += 1;
        tailIncompleteReasonCounts['settle_truncated'] = (tailIncompleteReasonCounts['settle_truncated'] ?? 0) + 1;
      }
      if (!aggregate.primaryMetricComplete) {
        incompleteCandidates += 1;
        incompleteReasonCounts['primary_metric_incomplete'] = (incompleteReasonCounts['primary_metric_incomplete'] ?? 0) + 1;
        continue;
      }

      evaluatedCandidates += 1;
      let isBetter = false;
      if (aggregate.expectedDps > bestExpectedDps) {
        isBetter = true;
      } else if (Math.abs(aggregate.expectedDps - bestExpectedDps) < 1e-6 && bestBuild !== null) {
        if (candidate.spentNormalPoints < bestBuild.spentNormalPoints) {
          isBetter = true;
        } else if (
          candidate.spentNormalPoints === bestBuild.spentNormalPoints
          && candidate.spentBossPoints < bestBuild.spentBossPoints
        ) {
          isBetter = true;
        } else if (
          candidate.spentNormalPoints === bestBuild.spentNormalPoints
          && candidate.spentBossPoints === bestBuild.spentBossPoints
          && candidate.signature.localeCompare(bestBuild.signature) < 0
        ) {
          isBetter = true;
        }
      }
      if (isBetter || bestBuild === null) {
        bestExpectedDps = aggregate.expectedDps;
        bestBuild = candidate;
        bestAggregate = aggregate;
      }
    }

    const provenMaximum = unsupportedCandidates === 0
      && incompleteCandidates === 0
      && evaluatedCandidates === candidates.length
      && candidates.length > 0;
    const dps = bestExpectedDps >= 0 ? bestExpectedDps : 0;
    stages.push({
      stage: stageDef.name,
      stageLabel: stageDef.label,
      normalPointBudget: stageDef.normalPointBudget,
      bossPointBudget: stageDef.bossPointBudget,
      bestSupportedBuild: bestBuild,
      bestSupportedExpectedDps: dps,
      bestSupportedDps: dps,
      totalLegalCandidates: candidates.length,
      evaluatedCandidates,
      unsupportedCandidates,
      unsupportedReasons: Object.keys(unsupportedReasonCounts).sort(),
      unsupportedReasonCounts,
      incompleteCandidates,
      incompleteReasons: Object.keys(incompleteReasonCounts).sort(),
      incompleteReasonCounts,
      tailIncompleteCandidates,
      tailIncompleteReasons: Object.keys(tailIncompleteReasonCounts).sort(),
      tailIncompleteReasonCounts,
      provenMaximum,
      primaryMetricComplete: bestAggregate?.primaryMetricComplete ?? false,
      tailComplete: bestAggregate?.tailComplete ?? false,
      settleTruncated: bestAggregate?.settleTruncated,
      benchmarkAggregate: bestAggregate,
      benchmarkResult: bestAggregate?.runs?.[0],
    });
  }

  return {
    weaponId: options.weaponId,
    slot,
    scenario,
    stages,
    cacheHits,
    cacheMisses,
    summaryText: formatProgressionSummary(options.weaponId, slot, scenario, stages, cacheHits, cacheMisses),
  };
}

/** Gemeinsamer Analyzer-Einstieg fuer den versionierten ST-Benchmark. */
export function analyzeWeaponSingleTargetProgression(
  options: AnalyzeWeaponProgressionOptions,
): WeaponProgressionAnalysisResult {
  return analyzeWeaponProgression(options, 'single_target_static');
}

/** Gemeinsamer Analyzer-Einstieg fuer den versionierten Five-Target-Benchmark. */
export function analyzeWeaponFiveTargetProgression(
  options: AnalyzeWeaponProgressionOptions,
): WeaponProgressionAnalysisResult {
  return analyzeWeaponProgression(options, 'five_target');
}
