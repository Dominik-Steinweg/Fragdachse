import { getWeaponConfig } from '../../loadout/LoadoutConfig';
import { applyCoopDefenseModifiersToWeaponConfig } from '../../loadout/CoopDefenseLoadoutModifiers';
import { getCoopDefenseResolvedEffectTotals } from '../../utils/coopDefenseUpgrades';
import { DEFAULT_COOP_DEFENSE_CLASS_ID } from '../../config/coopDefenseClasses';
import type { CoopDefenseClassId, WeaponSlot } from '../../types';
import type { SingleTargetScenarioConfig, WeaponBalanceScenario } from './scenarioTypes';
import { PROGRESSION_STAGES, type ProgressionStageName } from './progressionStages';
import {
  generateWeaponUpgradeBuilds,
  type WeaponUpgradeBuild,
} from './WeaponUpgradeBuildGenerator';
import { validateWeaponBalanceCapabilities } from './weaponCapabilityValidator';
import {
  resolveAndValidateWeaponSlot,
  runWeaponSingleTargetBenchmarkSet,
} from './weaponBenchmark';
import {
  DEFAULT_BENCHMARK_SEEDS,
  type SingleTargetBenchmarkAggregate,
  type SingleTargetBenchmarkResult,
} from './weaponBenchmarkTypes';

export interface StageAnalysisResult {
  readonly stage: ProgressionStageName;
  readonly stageLabel: string;
  readonly normalPointBudget: number;
  readonly bossPointBudget: number;
  readonly bestSupportedBuild: WeaponUpgradeBuild | null;
  readonly bestSupportedExpectedDps: number;
  /** Alias für bestSupportedExpectedDps zur Abwärtskompatibilität. */
  readonly bestSupportedDps: number;
  readonly totalLegalCandidates: number;
  readonly evaluatedCandidates: number;
  readonly unsupportedCandidates: number;
  readonly unsupportedReasons: readonly string[];
  readonly unsupportedReasonCounts: Readonly<Record<string, number>>;
  readonly incompleteCandidates: number;
  readonly incompleteReasons: readonly string[];
  readonly incompleteReasonCounts: Readonly<Record<string, number>>;
  readonly provenMaximum: boolean;
  readonly settleTruncated?: boolean;
  readonly benchmarkAggregate?: SingleTargetBenchmarkAggregate;
  readonly benchmarkResult?: SingleTargetBenchmarkResult;
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
  readonly scenario?: WeaponBalanceScenario;
  readonly seeds?: readonly number[];
  /** Optionaler Einzel-Seed für Abwärtskompatibilität. */
  readonly seed?: number;
  readonly durationMs?: number;
  readonly stepDeltaMs?: number;
  readonly scenarioConfig?: SingleTargetScenarioConfig;
  readonly classId?: CoopDefenseClassId;
}

/**
 * Erzeugt eine strukturierte Text-Zusammenfassung der Progressionsanalyse.
 */
function formatProgressionSummary(
  weaponId: string,
  slot: WeaponSlot,
  scenario: WeaponBalanceScenario,
  stages: readonly StageAnalysisResult[],
  cacheHits: number,
  cacheMisses: number,
): string {
  const lines: string[] = [];
  lines.push(`=== Single-Target Progression: ${weaponId} (${slot}) [Scenario: ${scenario}] ===`);
  lines.push(`Cache-Statistik: ${cacheHits} Hits / ${cacheMisses} Misses (Simulationsläufe)`);

  for (const st of stages) {
    lines.push(`\n[${st.stageLabel.toUpperCase()}] Budget: ${st.normalPointBudget} normal / ${st.bossPointBudget} boss`);
    lines.push(`  Best Supported Expected ST DPS: ${st.bestSupportedExpectedDps.toFixed(1)}`);
    if (st.benchmarkAggregate) {
      if (st.benchmarkAggregate.expectedBurnDps > 0) {
        lines.push(`    (Direct DPS: ${st.benchmarkAggregate.expectedDirectDps.toFixed(1)} | Burn DPS: ${st.benchmarkAggregate.expectedBurnDps.toFixed(1)})`);
      }
      lines.push(`    (Median: ${st.benchmarkAggregate.medianDps.toFixed(1)} | P10: ${st.benchmarkAggregate.p10Dps.toFixed(1)} | P90: ${st.benchmarkAggregate.p90Dps.toFixed(1)} | Min: ${st.benchmarkAggregate.minDps.toFixed(1)} | Max: ${st.benchmarkAggregate.maxDps.toFixed(1)})`);
      lines.push(`    (Expected Hit Rate: ${(st.benchmarkAggregate.expectedHitRate * 100).toFixed(1)}% | Shots/s: ${st.benchmarkAggregate.expectedShotsPerSecond.toFixed(1)})`);
    }
    lines.push(`  Proven Maximum: ${st.provenMaximum ? 'YES' : 'NO (partiell unterstützt)'}`);
    lines.push(`  Candidates: ${st.evaluatedCandidates}/${st.totalLegalCandidates} ausgewertet (${st.unsupportedCandidates} unsupported)`);

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
    }

    if (st.unsupportedReasons.length > 0) {
      lines.push('  Nicht unterstützte relevante Mechaniken:');
      for (const [reason, count] of Object.entries(st.unsupportedReasonCounts)) {
        lines.push(`    - ${reason} (${count} Kandidaten)`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Führt die vollständige Single-Target-Progressionsanalyse über alle fünf Stufen für eine Waffe durch.
 *
 * Optimierungsmerkmale in V0.5:
 * - Analyse-lokales Caching verhindert redundante Simulationen identischer Builds über verschachtelte Stages.
 * - Lightweight-Modus spart Allokationen großer Event-Historien während des Parameter-Sweeps.
 * - Szenario-spezifische Capability-Klassifizierung trennt relevante von irrelevanten Effekten.
 */
export function analyzeWeaponSingleTargetProgression(
  options: AnalyzeWeaponProgressionOptions,
): WeaponProgressionAnalysisResult {
  const baseConfig = getWeaponConfig(options.weaponId);
  if (!baseConfig) {
    throw new Error(`[WeaponBalanceLab] Unbekannte Weapon-ID: "${options.weaponId}"`);
  }

  const slot = resolveAndValidateWeaponSlot(baseConfig, options.slot);
  const classId = options.classId ?? DEFAULT_COOP_DEFENSE_CLASS_ID;

  if (options.scenario !== undefined && options.scenario !== 'single_target_static') {
    throw new Error(
      `[WeaponBalanceLab] analyzeWeaponSingleTargetProgression() unterstützt ausschließlich das Szenario "single_target_static" (angefragt: "${options.scenario}").`,
    );
  }
  const scenario: WeaponBalanceScenario = 'single_target_static';

  // Deterministisches Multi-Seed-Set auflösen und normalisieren
  const rawSeeds = options.seeds && options.seeds.length > 0
    ? options.seeds
    : options.seed !== undefined
      ? [options.seed]
      : DEFAULT_BENCHMARK_SEEDS;
  const seeds = Array.from(new Set(rawSeeds)).sort((a, b) => a - b);

  const durationMs = options.durationMs ?? 30_000;
  const stepDeltaMs = options.stepDeltaMs ?? 16;

  // Analyse-lokaler Cache
  const buildCache = new Map<string, SingleTargetBenchmarkAggregate>();
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
    let bestAggregate: SingleTargetBenchmarkAggregate | undefined = undefined;

    let evaluatedCandidates = 0;
    let unsupportedCandidates = 0;
    const unsupportedReasonCounts: Record<string, number> = {};
    let incompleteCandidates = 0;
    const incompleteReasonCounts: Record<string, number> = {};

    for (const candidate of candidates) {
      const effectTotals = getCoopDefenseResolvedEffectTotals(candidate.profile, classId);
      const modifiedConfig = applyCoopDefenseModifiersToWeaponConfig(
        baseConfig,
        slot,
        effectTotals,
      );

      const capCheck = validateWeaponBalanceCapabilities(modifiedConfig, scenario);
      if (!capCheck.supported) {
        unsupportedCandidates += 1;
        for (const reason of capCheck.unsupportedRelevant) {
          unsupportedReasonCounts[reason] = (unsupportedReasonCounts[reason] ?? 0) + 1;
        }
        continue;
      }

      // Cache-Key für diesen Build
      const scenarioKey = options.scenarioConfig
        ? `${options.scenarioConfig.id}:${options.scenarioConfig.version}:${options.scenarioConfig.targetRadius}:${options.scenarioConfig.targetDistance}:${options.scenarioConfig.attackWindowMs}:${options.scenarioConfig.warmupMs}:${options.scenarioConfig.settleLimitMs}:${options.scenarioConfig.triggerPolicy}:${options.scenarioConfig.aimPolicy}`
        : 'profile:auto';
      const cacheKey = `${options.weaponId}:${slot}:${candidate.signature}:${seeds.join(',')}:${durationMs}:${stepDeltaMs}:${scenario}:${scenarioKey}`;
      let aggregate = buildCache.get(cacheKey);

      if (aggregate) {
        cacheHits += 1;
      } else {
        cacheMisses += 1;
        aggregate = runWeaponSingleTargetBenchmarkSet({
          weaponId: options.weaponId,
          weaponConfigOverride: modifiedConfig,
          sourceSlot: slot,
          seeds,
          durationMs,
          stepDeltaMs,
          scenarioConfig: options.scenarioConfig,
          includeIndividualRuns: false, // Lightweight-Modus während Sweep
        });
        buildCache.set(cacheKey, aggregate);
      }

      // Unvollständig ausgewertete Settle-Läufe (z.B. abgebrochener Brand) dürfen nicht
      // still als bewiesenes Ergebnis in die Best-Suche einfließen
      if (aggregate.settleTruncated) {
        incompleteCandidates += 1;
        incompleteReasonCounts['settle_truncated'] = (incompleteReasonCounts['settle_truncated'] ?? 0) + 1;
        continue;
      }

      evaluatedCandidates += 1;

      // Deterministischer Tie-Breaker bei identischem Expected DPS
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
    const unsupportedReasons = Object.keys(unsupportedReasonCounts).sort();
    const incompleteReasons = Object.keys(incompleteReasonCounts).sort();

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
      unsupportedReasons,
      unsupportedReasonCounts,
      incompleteCandidates,
      incompleteReasons,
      incompleteReasonCounts,
      provenMaximum,
      settleTruncated: bestAggregate?.settleTruncated,
      benchmarkAggregate: bestAggregate,
      benchmarkResult: bestAggregate?.runs?.[0],
    });
  }

  const summaryText = formatProgressionSummary(
    options.weaponId,
    slot,
    scenario,
    stages,
    cacheHits,
    cacheMisses,
  );

  return {
    weaponId: options.weaponId,
    slot,
    scenario,
    stages,
    cacheHits,
    cacheMisses,
    summaryText,
  };
}
