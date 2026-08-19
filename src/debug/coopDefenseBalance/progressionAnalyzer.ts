import { getWeaponConfig } from '../../loadout/LoadoutConfig';
import { applyCoopDefenseModifiersToWeaponConfig } from '../../loadout/CoopDefenseLoadoutModifiers';
import { getCoopDefenseResolvedEffectTotals } from '../../utils/coopDefenseUpgrades';
import { DEFAULT_COOP_DEFENSE_CLASS_ID } from '../../config/coopDefenseClasses';
import type { CoopDefenseClassId, LoadoutSlot } from '../../types';
import { PROGRESSION_STAGES, type ProgressionStageName } from './progressionStages';
import {
  generateWeaponUpgradeBuilds,
  type WeaponUpgradeBuild,
} from './WeaponUpgradeBuildGenerator';
import { validateWeaponBalanceCapabilities } from './weaponCapabilityValidator';
import { runWeaponSingleTargetBenchmark } from './weaponBenchmark';
import type { SingleTargetBenchmarkResult } from './weaponBenchmarkTypes';

export interface StageAnalysisResult {
  readonly stage: ProgressionStageName;
  readonly stageLabel: string;
  readonly normalPointBudget: number;
  readonly bossPointBudget: number;
  readonly bestSupportedBuild: WeaponUpgradeBuild | null;
  readonly bestSupportedDps: number;
  readonly totalLegalCandidates: number;
  readonly evaluatedCandidates: number;
  readonly unsupportedCandidates: number;
  readonly unsupportedReasons: readonly string[];
  readonly provenMaximum: boolean;
  readonly benchmarkResult?: SingleTargetBenchmarkResult;
}

export interface WeaponProgressionAnalysisResult {
  readonly weaponId: string;
  readonly slot: LoadoutSlot;
  readonly stages: readonly StageAnalysisResult[];
  readonly summaryText: string;
}

export interface AnalyzeWeaponProgressionOptions {
  readonly weaponId: string;
  readonly slot?: LoadoutSlot;
  readonly seed?: number;
  readonly durationMs?: number;
  readonly stepDeltaMs?: number;
  readonly classId?: CoopDefenseClassId;
}

/**
 * Erzeugt eine strukturierte Text-Zusammenfassung der Progressionsanalyse.
 */
function formatProgressionSummary(
  weaponId: string,
  slot: LoadoutSlot,
  stages: readonly StageAnalysisResult[],
): string {
  const lines: string[] = [];
  lines.push(`=== Single-Target Progression: ${weaponId} (${slot}) ===`);

  for (const st of stages) {
    lines.push(`\n[${st.stageLabel.toUpperCase()}] Budget: ${st.normalPointBudget} normal / ${st.bossPointBudget} boss`);
    lines.push(`  Best Supported ST DPS: ${st.bestSupportedDps.toFixed(1)}`);
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

    if (st.benchmarkResult) {
      if (slot === 'weapon1') {
        lines.push(`  Adrenalin/s generiert: ${st.benchmarkResult.adrenalineGeneratedPerSec.toFixed(1)}`);
      } else {
        lines.push(`  Adrenalin/s verbraucht: ${st.benchmarkResult.adrenalineSpentPerSec.toFixed(1)}`);
      }
    }

    if (st.unsupportedReasons.length > 0) {
      lines.push(`  Nicht unterstützte Mechaniken: ${st.unsupportedReasons.join('; ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Führt die vollständige Single-Target-Progressionsanalyse über alle fünf Stufen für eine Waffe durch.
 *
 * Findet für jede Stufe deterministisch den besten legal erreichbaren Build, der im aktuellen
 * Headless-Simulationskern vollständig unterstützt wird, und weist transparent aus, ob das
 * theoretische Maximum bewiesen ist (`provenMaximum = true`) oder noch unvollständig analysiert
 * werden musste (`provenMaximum = false`).
 */
export function analyzeWeaponSingleTargetProgression(
  options: AnalyzeWeaponProgressionOptions,
): WeaponProgressionAnalysisResult {
  const baseConfig = getWeaponConfig(options.weaponId);
  if (!baseConfig) {
    throw new Error(`[WeaponBalanceLab] Unbekannte Weapon-ID: "${options.weaponId}"`);
  }

  const slot = options.slot ?? (baseConfig.allowedSlots[0] ?? 'weapon1');
  const classId = options.classId ?? DEFAULT_COOP_DEFENSE_CLASS_ID;
  const seed = options.seed ?? 1;
  const durationMs = options.durationMs ?? 30_000;
  const stepDeltaMs = options.stepDeltaMs ?? 16;

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
    let bestDps = -Infinity;
    let bestResult: SingleTargetBenchmarkResult | undefined = undefined;

    let evaluatedCandidates = 0;
    let unsupportedCandidates = 0;
    const unsupportedReasonsSet = new Set<string>();

    for (const candidate of candidates) {
      const effectTotals = getCoopDefenseResolvedEffectTotals(candidate.profile, classId);
      const modifiedConfig = applyCoopDefenseModifiersToWeaponConfig(
        baseConfig,
        slot as 'weapon1' | 'weapon2',
        effectTotals,
      );

      const capCheck = validateWeaponBalanceCapabilities(modifiedConfig);
      if (!capCheck.supported) {
        unsupportedCandidates += 1;
        for (const reason of capCheck.unsupportedReasons) {
          unsupportedReasonsSet.add(reason);
        }
        continue;
      }

      evaluatedCandidates += 1;
      const simResult = runWeaponSingleTargetBenchmark({
        weaponId: options.weaponId,
        weaponConfigOverride: modifiedConfig,
        sourceSlot: slot,
        seed,
        durationMs,
        stepDeltaMs,
      });

      // Deterministischer Tie-Breaker bei identischem DPS
      let isBetter = false;
      if (simResult.dps > bestDps) {
        isBetter = true;
      } else if (Math.abs(simResult.dps - bestDps) < 1e-6 && bestBuild !== null) {
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
        bestDps = simResult.dps;
        bestBuild = candidate;
        bestResult = simResult;
      }
    }

    const provenMaximum = unsupportedCandidates === 0 && evaluatedCandidates > 0;
    const unsupportedReasons = Array.from(unsupportedReasonsSet).sort();

    stages.push({
      stage: stageDef.name,
      stageLabel: stageDef.label,
      normalPointBudget: stageDef.normalPointBudget,
      bossPointBudget: stageDef.bossPointBudget,
      bestSupportedBuild: bestBuild,
      bestSupportedDps: bestDps >= 0 ? bestDps : 0,
      totalLegalCandidates: candidates.length,
      evaluatedCandidates,
      unsupportedCandidates,
      unsupportedReasons,
      provenMaximum,
      benchmarkResult: bestResult,
    });
  }

  const summaryText = formatProgressionSummary(options.weaponId, slot, stages);

  return {
    weaponId: options.weaponId,
    slot,
    stages,
    summaryText,
  };
}
