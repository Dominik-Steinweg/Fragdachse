import type { RuntimeBenchmarkResult } from './runtimeBenchmarkTypes';

export const RUNTIME_BENCHMARK_STORAGE_KEY = 'fragdachse_weapon_balance_runtime_v1';
const MAX_RESULTS = 200;

function normalizeResult(value: unknown): RuntimeBenchmarkResult | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Partial<RuntimeBenchmarkResult>;
  const valid = entry.schemaVersion === 1
    && typeof entry.runId === 'string'
    && typeof entry.createdAt === 'string'
    && typeof entry.weaponId === 'string'
    && (entry.slot === 'weapon1' || entry.slot === 'weapon2')
    && (entry.scenario === 'single_target' || entry.scenario === 'five_target')
    && typeof entry.totalDamage === 'number'
    && Number.isFinite(entry.totalDamage)
    && typeof entry.dps === 'number'
    && Number.isFinite(entry.dps);
  if (!valid) return null;
  return {
    ...(entry as RuntimeBenchmarkResult),
    adrenalineGenerated: Number.isFinite(entry.adrenalineGenerated) ? entry.adrenalineGenerated! : 0,
    adrenalineGeneratedPerSecond: Number.isFinite(entry.adrenalineGeneratedPerSecond)
      ? entry.adrenalineGeneratedPerSecond!
      : 0,
  };
}

export function loadRuntimeBenchmarkResults(storage: Storage | null = globalThis.localStorage ?? null): RuntimeBenchmarkResult[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(RUNTIME_BENCHMARK_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.map(normalizeResult).filter((entry): entry is RuntimeBenchmarkResult => entry !== null).slice(0, MAX_RESULTS)
      : [];
  } catch {
    return [];
  }
}

export function storeRuntimeBenchmarkResult(
  result: RuntimeBenchmarkResult,
  storage: Storage | null = globalThis.localStorage ?? null,
): RuntimeBenchmarkResult[] {
  const results = [result, ...loadRuntimeBenchmarkResults(storage)]
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.runId === entry.runId) === index)
    .slice(0, MAX_RESULTS);
  try {
    storage?.setItem(RUNTIME_BENCHMARK_STORAGE_KEY, JSON.stringify(results));
  } catch {
    // Eine volle oder gesperrte Browser-Persistence darf den abgeschlossenen Lauf nicht verwerfen.
  }
  return results;
}

export interface RuntimeBestObservedResult {
  readonly result: RuntimeBenchmarkResult;
  readonly sampleCount: number;
}

function comparisonKey(result: RuntimeBenchmarkResult): string {
  return [
    result.weaponId,
    result.slot,
    result.scenario,
    result.targetCount,
    result.distance,
    result.measurementMs,
    result.buildSignature,
  ].join('|');
}

/** Gruppiert nur direkt vergleichbare Runs und markiert den hoechsten gemessenen DPS-Wert. */
export function selectBestObservedRuntimeResults(
  results: readonly RuntimeBenchmarkResult[],
): RuntimeBestObservedResult[] {
  const groups = new Map<string, RuntimeBestObservedResult>();
  for (const result of results) {
    const key = comparisonKey(result);
    const current = groups.get(key);
    groups.set(key, {
      result: !current || result.dps > current.result.dps ? result : current.result,
      sampleCount: (current?.sampleCount ?? 0) + 1,
    });
  }
  return [...groups.values()].sort((a, b) => b.result.createdAt.localeCompare(a.result.createdAt));
}

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
}

export function runtimeBenchmarkResultsToCsv(results: readonly RuntimeBenchmarkResult[]): string {
  const rows: unknown[][] = [[
    'Run-ID', 'Zeitpunkt', 'Waffe', 'Slot', 'Szenario', 'Ziele', 'Distanz',
    'Messdauer (s)', 'Build', 'Schüsse', 'Schadensereignisse', 'Crit-Ereignisse',
    'Getroffene Ziele', 'Gesamtschaden', 'DPS', 'Direkt', 'Explosion', 'Brand',
    'Chain', 'Tail-Schaden', 'Tail-Status', 'Adrenalin erzeugt', 'Adrenalin erzeugt/s',
    'Adrenalin verbraucht', 'Adrenalin verbraucht/s',
  ]];
  for (const result of results) {
    rows.push([
      result.runId,
      result.createdAt,
      result.weaponId,
      result.slot,
      result.scenario,
      result.targetCount,
      result.distance,
      result.measurementMs / 1000,
      result.buildSignature,
      result.shotsFired,
      result.damagingHitEvents,
      result.criticalDamageEvents,
      result.targetsDamaged,
      result.totalDamage,
      result.dps,
      result.damageByKind.direct ?? 0,
      result.damageByKind.explosion ?? 0,
      result.damageByKind.burn ?? 0,
      result.damageByKind.chain ?? 0,
      result.tailDamage,
      result.tailStatus,
      result.adrenalineGenerated,
      result.adrenalineGeneratedPerSecond,
      result.adrenalineConsumed,
      result.adrenalinePerSecond,
    ]);
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`;
}
