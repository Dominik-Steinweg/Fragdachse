import {
  applyArenaMetricsForMode,
  CELL_SIZE,
  DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS,
  DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS,
} from '../../config';
import { COOP_DEFENSE_MODE } from '../../gameModes';
import type { CoopDefenseMapConfig } from '../../config/coopDefenseMaps';
import type { ArenaDescriptor, ArenaLayout } from '../../types';
import { ArenaGenerator, ARENA_GENERATOR_VERSION } from '../ArenaGenerator';

/**
 * Mess- und Diagnoseharness fuer grosse Arenen.
 *
 * Bewusst **unabhaengig von jeder authored Map**: Die Testarena kann geloescht werden, dieser
 * Harness soll das ueberleben. Er baut sich seine Karte selbst aus einer Groesse und einem
 * Korridorverlauf und misst daran genau die drei Fragen, die Block A offen laesst:
 *
 * 1. Wie lange dauert die Generierung einer 400 x 80-Arena, im Median und im schlechten Fall?
 * 2. Ist derselbe Seed reproduzierbar?
 * 3. Wie klein bleibt der initiale Arena-Descriptor auf der Leitung?
 *
 * Was er ausdruecklich **nicht** ist: ein Performance-Gate. Er liefert Zahlen, keine Grenzwerte.
 * Eine feste Millisekundenschwelle waere auf fremder Hardware und unter Last instabil und wuerde
 * genau dann rot, wenn niemand etwas geaendert hat.
 */

export interface ArenaGenerationSample {
  readonly seed: number;
  readonly durationMs: number;
  readonly rockCount: number;
  readonly dirtCount: number;
  readonly decalCount: number;
  readonly treeCount: number;
  /**
   * Groesse des tatsaechlich uebertragenen Initial-Descriptors in Bytes.
   */
  readonly descriptorBytes: number;
}

export interface ArenaGenerationBenchmarkResult {
  readonly widthCells: number;
  readonly heightCells: number;
  readonly samples: readonly ArenaGenerationSample[];
  readonly minMs: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  /** Ob jeder Seed bei zweitem Lauf dasselbe Layout ergeben hat. */
  readonly deterministic: boolean;
}

export interface ArenaGenerationBenchmarkOptions {
  readonly widthCells?: number;
  readonly heightCells?: number;
  /** Feste Seeds statt Zufall: Der Lauf muss zwischen Maschinen vergleichbar bleiben. */
  readonly seeds?: readonly number[];
  /** Ob jeder Seed ein zweites Mal erzeugt und verglichen wird. */
  readonly checkDeterminism?: boolean;
  readonly now?: () => number;
}

/** Die Standard-Stressgroesse aus Block A. */
export const LARGE_ARENA_BENCHMARK_WIDTH_CELLS = 400;
export const LARGE_ARENA_BENCHMARK_HEIGHT_CELLS = 80;
export const LARGE_ARENA_BENCHMARK_SEEDS: readonly number[] = [1, 1337, 424242, 987654321, 20260817];

/**
 * Baut eine synthetische Coop-Karte in der gewuenschten Groesse.
 *
 * Der Korridorverlauf ist bewusst schematisch: Er soll ein durchgehend begehbares Band und
 * daneben grosse zusammenhaengende Felsmassen erzeugen, nicht gut aussehen. Alles Authored –
 * Encounter, Events, Nebenziele – bleibt leer, damit die Messung wirklich nur die Generierung
 * trifft.
 */
export function createSyntheticLargeArenaMapConfig(
  widthCells = LARGE_ARENA_BENCHMARK_WIDTH_CELLS,
  heightCells = LARGE_ARENA_BENCHMARK_HEIGHT_CELLS,
): CoopDefenseMapConfig {
  const points: Array<{ gridX: number; gridY: number }> = [];
  const step = Math.max(8, Math.round(widthCells / 24));
  for (let gridX = 1; gridX < widthCells - 1; gridX += step) {
    const phase = gridX / widthCells;
    const gridY = Math.round(
      heightCells * 0.5 + heightCells * 0.18 * Math.sin(phase * Math.PI * 3),
    );
    points.push({ gridX, gridY: Math.max(4, Math.min(heightCells - 5, gridY)) });
  }
  points.push({ gridX: widthCells - 2, gridY: Math.round(heightCells * 0.5) });

  return {
    mapId: '__synthetic_large_arena',
    arenaWidthCells: widthCells,
    arenaHeightCells: heightCells,
    trackMode: 'void-fire',
    rockField: {
      corridorRadiusCells: 3,
      corridorRadiusVarianceCells: 0.8,
      corridorWanderCells: 1.5,
      waypointJitterCells: 1,
      rockDensityScale: 1,
      corridors: [{ id: 'synthetic-main', points }],
    },
    objective: 'survive',
    surviveDurationSec: 600,
    balanceReferenceDurationSec: 600,
    respawnsPerPlayer: 0,
    bases: [
      {
        id: 'synthetic-home-base',
        hpMax: 1000,
        anchor: { kind: 'left-center', edgeInsetCells: 1 },
        shape: { kind: 'rectangle', widthCells: 2, heightCells: 2 },
      },
    ],
    powerUps: [],
  };
}

export function runArenaGenerationBenchmark(
  options: ArenaGenerationBenchmarkOptions = {},
): ArenaGenerationBenchmarkResult {
  const widthCells = options.widthCells ?? LARGE_ARENA_BENCHMARK_WIDTH_CELLS;
  const heightCells = options.heightCells ?? LARGE_ARENA_BENCHMARK_HEIGHT_CELLS;
  const seeds = options.seeds ?? LARGE_ARENA_BENCHMARK_SEEDS;
  const now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const mapConfig = createSyntheticLargeArenaMapConfig(widthCells, heightCells);

  // Die globalen Arena-Metriken sind Modulzustand; der Harness leiht sie sich und gibt sie
  // danach an die Standard-Coop-Groesse zurueck, damit kein anderer Test sie geerbt bekommt.
  applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', widthCells, heightCells);
  try {
    const samples: ArenaGenerationSample[] = [];
    let deterministic = true;

    for (const seed of seeds) {
      const startedAt = now();
      const layout = ArenaGenerator.generate(seed, mapConfig);
      const durationMs = now() - startedAt;

      const descriptor: ArenaDescriptor = {
        roundRevision: 1,
        gameMode: COOP_DEFENSE_MODE,
        mapId: mapConfig.mapId,
        seed,
        arenaGeneratorVersion: ARENA_GENERATOR_VERSION,
        layoutFingerprint: ArenaGenerator.fingerprint(layout),
      };
      samples.push({
        seed,
        durationMs,
        rockCount: layout.rocks.length,
        dirtCount: layout.dirt.length,
        decalCount: layout.decals?.length ?? 0,
        treeCount: layout.trees.length,
        descriptorBytes: measureJsonBytes(descriptor),
      });

      if (options.checkDeterminism !== false) {
        const repeat = ArenaGenerator.generate(seed, mapConfig);
        if (!layoutsEqual(layout, repeat)) deterministic = false;
      }
    }

    const durations = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
    return {
      widthCells,
      heightCells,
      samples,
      minMs: durations[0] ?? 0,
      medianMs: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      maxMs: durations[durations.length - 1] ?? 0,
      deterministic,
    };
  } finally {
    applyArenaMetricsForMode(
      COOP_DEFENSE_MODE,
      'ARENA',
      DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS,
      DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS,
    );
  }
}

/** Menschenlesbare Zusammenfassung – die Form, in der die Messung dokumentiert wird. */
export function formatArenaGenerationBenchmark(result: ArenaGenerationBenchmarkResult): string {
  const lines: string[] = [];
  lines.push(
    `Arena ${result.widthCells} x ${result.heightCells} Zellen `
    + `(${result.widthCells * CELL_SIZE} x ${result.heightCells * CELL_SIZE} px, `
    + `${result.widthCells * result.heightCells} Zellen)`,
  );
  lines.push(
    `generate(): min ${format(result.minMs)} ms | median ${format(result.medianMs)} ms `
    + `| p95 ${format(result.p95Ms)} ms | max ${format(result.maxMs)} ms `
    + `| deterministisch: ${result.deterministic ? 'ja' : 'NEIN'}`,
  );
  for (const sample of result.samples) {
    lines.push(
      `  seed ${sample.seed}: ${format(sample.durationMs)} ms | `
      + `${sample.rockCount} Felsen, ${sample.dirtCount} Dirt, ${sample.decalCount} Decals | `
      + `Descriptor ${formatBytes(sample.descriptorBytes)}`,
    );
  }
  return lines.join('\n');
}

function format(value: number): string {
  return value.toFixed(1);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function percentile(sortedAscending: readonly number[], fraction: number): number {
  if (sortedAscending.length === 0) return 0;
  const index = Math.min(
    sortedAscending.length - 1,
    Math.max(0, Math.ceil(fraction * sortedAscending.length) - 1),
  );
  return sortedAscending[index];
}

function measureJsonBytes(value: unknown): number {
  const json = JSON.stringify(value);
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(json).length;
  return json.length;
}

function layoutsEqual(left: ArenaLayout, right: ArenaLayout): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
