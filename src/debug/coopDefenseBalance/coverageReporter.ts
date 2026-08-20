import {
  analyzeWeaponFiveTargetProgression,
  analyzeWeaponSingleTargetProgression,
  type AnalyzeWeaponProgressionOptions,
  type WeaponBenchmarkAggregate,
  type WeaponProgressionAnalysisResult,
} from './progressionAnalyzer';
import { getWeaponConfig } from '../../loadout/LoadoutConfig';
import { resolveAndValidateWeaponSlot } from './weaponBenchmark';
import type { ProgressionStageName } from './progressionStages';
import type { WeaponSlot } from '../../types';
import type { WeaponBalanceScenario } from './scenarioTypes';

export interface WeaponStageCoverageData {
  readonly weaponId: string;
  readonly slot: WeaponSlot;
  readonly scenario: WeaponBalanceScenario;
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly stage: ProgressionStageName;
  readonly stageLabel: string;
  readonly normalPointBudget: number;
  readonly bossPointBudget: number;
  readonly expectedDps: number;
  readonly directDps: number;
  readonly burnDps: number;
  readonly expectedDamageYieldIncludingTail: number;
  readonly expectedTailDamage: number;
  readonly expectedHitRate: number;
  readonly expectedTargetsHitPerShot: number;
  readonly expectedProjectileHitRate: number;
  readonly expectedShotsPerSecond: number;
  readonly adrenalineGeneratedPerSec: number;
  readonly adrenalineSpentPerSec: number;
  readonly selectedBuildSignature: string;
  readonly selectedBuildLevels: Readonly<Record<string, number>>;
  readonly evaluatedCandidates: number;
  readonly totalLegalCandidates: number;
  readonly unsupportedCandidates: number;
  readonly unsupportedReasons: readonly string[];
  readonly incompleteCandidates: number;
  readonly incompleteReasons: readonly string[];
  readonly tailIncompleteCandidates: number;
  readonly tailIncompleteReasons: readonly string[];
  readonly provenMaximum: boolean;
  readonly primaryMetricComplete: boolean;
  readonly tailComplete: boolean;
  readonly settleTruncated: boolean;
}

export interface WeaponCoverageData {
  readonly weaponId: string;
  readonly slot: WeaponSlot;
  readonly scenario: WeaponBalanceScenario;
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly stages: readonly WeaponStageCoverageData[];
  readonly cacheHits: number;
  readonly cacheMisses: number;
}

export interface WeaponBalanceCoverageReportData {
  readonly timestampIso: string;
  readonly weapons: readonly WeaponCoverageData[];
}

export interface CoverageReportOptions extends Omit<AnalyzeWeaponProgressionOptions, 'weaponId'> {
  readonly weaponSlots?: Readonly<Record<string, WeaponSlot>>;
}

function isFiveTargetAggregate(aggregate: WeaponBenchmarkAggregate): aggregate is Extract<WeaponBenchmarkAggregate, { readonly expectedTargetsHitPerShot: number }> {
  return 'expectedTargetsHitPerShot' in aggregate;
}

/**
 * Erzeugt strukturierte, maschinell verifizierte Daten für den Coverage-Report
 * direkt aus der analyzeWeaponSingleTargetProgression-Pipeline.
 */
export function generateWeaponBalanceCoverageData(
  weaponIds: readonly string[],
  options?: CoverageReportOptions,
): WeaponBalanceCoverageReportData {
  const weaponsData: WeaponCoverageData[] = [];

  for (const weaponId of weaponIds) {
    const config = getWeaponConfig(weaponId);
    if (!config) {
      throw new Error(`[WeaponBalanceLab] Unbekannte Weapon-ID im Coverage-Report: "${weaponId}"`);
    }

    const requestedSlot = options?.weaponSlots?.[weaponId] ?? options?.slot;
    const slot = resolveAndValidateWeaponSlot(config, requestedSlot);

    const scenario = options?.scenario ?? 'single_target_static';
    const result: WeaponProgressionAnalysisResult = scenario === 'five_target'
      ? analyzeWeaponFiveTargetProgression({ ...options, weaponId, slot, scenario })
      : analyzeWeaponSingleTargetProgression({ ...options, weaponId, slot, scenario });

    const stageEntries: WeaponStageCoverageData[] = result.stages.map((st) => {
      const agg = st.benchmarkAggregate;
      const expectedDps = st.bestSupportedExpectedDps;
      const directDps = agg ? agg.expectedDirectDps : expectedDps;
      const burnDps = agg ? agg.expectedBurnDps : 0;
      const expectedDamageYieldIncludingTail = agg ? agg.expectedDamageYieldIncludingTail : 0;
      const expectedTailDamage = agg ? agg.expectedTailDamage : 0;
      const expectedHitRate = agg && !isFiveTargetAggregate(agg) ? agg.expectedHitRate : 0;
      const expectedTargetsHitPerShot = agg && isFiveTargetAggregate(agg)
        ? agg.expectedTargetsHitPerShot
        : 0;
      const expectedProjectileHitRate = agg && isFiveTargetAggregate(agg)
        ? agg.expectedProjectileHitRate
        : 0;
      const expectedShotsPerSecond = agg ? agg.expectedShotsPerSecond : 0;
      const adrenalineGeneratedPerSec = agg ? agg.expectedAdrenalineGeneratedPerSec : 0;
      const adrenalineSpentPerSec = agg ? agg.expectedAdrenalineSpentPerSec : 0;

      return {
        weaponId,
        slot,
        scenario: result.scenario,
        scenarioId: agg?.scenarioId ?? 'unknown',
        scenarioVersion: agg?.scenarioVersion ?? 0,
        stage: st.stage,
        stageLabel: st.stageLabel,
        normalPointBudget: st.normalPointBudget,
        bossPointBudget: st.bossPointBudget,
        expectedDps,
        directDps,
        burnDps,
        expectedDamageYieldIncludingTail,
        expectedTailDamage,
        expectedHitRate,
        expectedTargetsHitPerShot,
        expectedProjectileHitRate,
        expectedShotsPerSecond,
        adrenalineGeneratedPerSec,
        adrenalineSpentPerSec,
        selectedBuildSignature: st.bestSupportedBuild?.signature ?? 'base',
        selectedBuildLevels: st.bestSupportedBuild ? { ...st.bestSupportedBuild.levels } : {},
        evaluatedCandidates: st.evaluatedCandidates,
        totalLegalCandidates: st.totalLegalCandidates,
        unsupportedCandidates: st.unsupportedCandidates,
        unsupportedReasons: [...st.unsupportedReasons],
        incompleteCandidates: st.incompleteCandidates,
        incompleteReasons: [...st.incompleteReasons],
        tailIncompleteCandidates: st.tailIncompleteCandidates,
        tailIncompleteReasons: [...st.tailIncompleteReasons],
        provenMaximum: st.provenMaximum,
        primaryMetricComplete: st.primaryMetricComplete,
        tailComplete: st.tailComplete,
        settleTruncated: Boolean(st.settleTruncated),
      };
    });

    weaponsData.push({
      weaponId,
      slot,
      scenario: result.scenario,
      scenarioId: result.stages[0]?.benchmarkAggregate?.scenarioId ?? 'unknown',
      scenarioVersion: result.stages[0]?.benchmarkAggregate?.scenarioVersion ?? 0,
      stages: stageEntries,
      cacheHits: result.cacheHits,
      cacheMisses: result.cacheMisses,
    });
  }

  return {
    timestampIso: new Date().toISOString(),
    weapons: weaponsData,
  };
}

/**
 * Formatiert die maschinell erzeugten Coverage-Daten als sauberes Markdown.
 */
export function formatWeaponBalanceCoverageMarkdown(
  data: WeaponBalanceCoverageReportData,
): string {
  const lines: string[] = [];

  const scenarios = new Set(data.weapons.map((weapon) => weapon.scenario));
  const title = scenarios.size === 1 && scenarios.has('five_target')
    ? '### Five-Target Progression Coverage Overview'
    : scenarios.size === 1
      ? '### Single-Target Progression Coverage Overview'
      : '### Weapon Balance Progression Coverage Overview';
  lines.push(title);
  lines.push('');
  lines.push('| Waffe | Slot | Base | Early | Mid | Late | Endgame | Proven Maximum |');
  lines.push('|---|---|---|---|---|---|---|---|');

  for (const w of data.weapons) {
    const stageMap = new Map<string, WeaponStageCoverageData>();
    for (const s of w.stages) {
      stageMap.set(s.stage, s);
    }

    const formatStageCell = (st?: WeaponStageCoverageData): string => {
      if (!st) return '-';
      const dpsStr = `${st.expectedDps.toFixed(1)} DPS`;
      if (st.burnDps > 0.05) {
        return `${dpsStr} *(Dir: ${st.directDps.toFixed(1)}, Burn: ${st.burnDps.toFixed(1)})*`;
      }
      return dpsStr;
    };

    const allProven = w.stages.every((s) => s.provenMaximum);
    const provenStatus = allProven
      ? '**YES** (alle 5 Stufen)'
      : w.stages.map((s) => `${s.stage}: ${s.provenMaximum ? 'YES' : 'NO'}`).join(', ');

    const baseCell = formatStageCell(stageMap.get('base'));
    const earlyCell = formatStageCell(stageMap.get('early'));
    const midCell = formatStageCell(stageMap.get('mid'));
    const lateCell = formatStageCell(stageMap.get('late'));
    const endgameCell = formatStageCell(stageMap.get('endgame'));

    lines.push(
      `| **${w.weaponId}** | \`${w.slot}\` | ${baseCell} | ${earlyCell} | ${midCell} | ${lateCell} | ${endgameCell} | ${provenStatus} |`,
    );
  }

  lines.push('');
  lines.push('### Detail-Aufschlüsselung nach Waffe und Progressionsstufe');

  for (const w of data.weapons) {
    lines.push('');
    lines.push(`#### ${w.weaponId} (\`${w.slot}\`, ${w.scenario} ${w.scenarioVersion})`);

    for (const st of w.stages) {
      lines.push(`- **[${st.stageLabel.toUpperCase()}]** (Budget: ${st.normalPointBudget}N / ${st.bossPointBudget}B)`);
      lines.push(`  - **Expected DPS**: ${st.expectedDps.toFixed(1)} (Direct: ${st.directDps.toFixed(1)}, Burn: ${st.burnDps.toFixed(1)})`);
      lines.push(`  - **Yield inkl. Tail**: ${st.expectedDamageYieldIncludingTail.toFixed(1)} (Tail: ${st.expectedTailDamage.toFixed(1)})`);
      if (st.scenario === 'five_target') {
        lines.push(`  - **Targets hit / Kadenz**: ${st.expectedTargetsHitPerShot.toFixed(2)} Ziele/Schuss | ${st.expectedShotsPerSecond.toFixed(1)} Schüsse/s`);
      } else {
        lines.push(`  - **Hit Rate / Kadenz**: ${(st.expectedHitRate * 100).toFixed(1)}% Trefferquote | ${st.expectedShotsPerSecond.toFixed(1)} Schüsse/s`);
      }
      if (w.slot === 'weapon1') {
        lines.push(`  - **Adrenalin generiert**: ${st.adrenalineGeneratedPerSec.toFixed(1)} / s`);
      } else {
        lines.push(`  - **Adrenalin verbraucht**: ${st.adrenalineSpentPerSec.toFixed(1)} / s`);
      }
      lines.push(`  - **Proven Maximum**: ${st.provenMaximum ? 'YES' : 'NO'}`);
      lines.push(`  - **Completeness**: primary=${st.primaryMetricComplete ? 'complete' : 'incomplete'}, tail=${st.tailComplete ? 'complete' : 'truncated'}`);
      lines.push(`  - **Kandidaten**: ${st.evaluatedCandidates}/${st.totalLegalCandidates} evaluiert (${st.unsupportedCandidates} unsupported, ${st.incompleteCandidates} primary-incomplete, ${st.tailIncompleteCandidates} tail-incomplete)`);

      if (st.selectedBuildSignature !== 'base') {
        const buildStr = Object.entries(st.selectedBuildLevels)
          .map(([up, lvl]) => `${up}: ${lvl}`)
          .join(', ');
        lines.push(`  - **Selected Build**: ${buildStr}`);
      } else {
        lines.push('  - **Selected Build**: Base (keine Upgrades)');
      }

      if (st.unsupportedReasons.length > 0) {
        lines.push(`  - **Unsupported Reasons**: ${st.unsupportedReasons.join(', ')}`);
      }
      if (st.incompleteReasons.length > 0) {
        lines.push(`  - **Incomplete Reasons**: ${st.incompleteReasons.join(', ')}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Convenience-Funktion: Führt die Coverage-Pipeline aus und liefert direkt das formatierte Markdown.
 */
export function generateWeaponBalanceCoverageReport(
  weaponIds: readonly string[],
  options?: CoverageReportOptions,
): string {
  const data = generateWeaponBalanceCoverageData(weaponIds, options);
  return formatWeaponBalanceCoverageMarkdown(data);
}

/** Erzeugt den machine-generated Abschlussdatensatz fuer ST und 5T gemeinsam. */
export function generateWeaponBalanceCoverageDataForScenarios(
  weaponIds: readonly string[],
  options?: Omit<CoverageReportOptions, 'scenario'>,
): WeaponBalanceCoverageReportData {
  const single = generateWeaponBalanceCoverageData(weaponIds, {
    ...options,
    scenario: 'single_target_static',
  });
  const five = generateWeaponBalanceCoverageData(weaponIds, {
    ...options,
    scenario: 'five_target',
  });
  return {
    timestampIso: new Date().toISOString(),
    weapons: [...single.weapons, ...five.weapons],
  };
}

/** Formatiert den gemeinsamen machine-generated ST-/5T-Abschlussbericht. */
export function generateWeaponBalanceCoverageReportForScenarios(
  weaponIds: readonly string[],
  options?: Omit<CoverageReportOptions, 'scenario'>,
): string {
  return formatWeaponBalanceCoverageMarkdown(
    generateWeaponBalanceCoverageDataForScenarios(weaponIds, options),
  );
}
