import { describe, expect, it, vi } from 'vitest';

// Der Generator fragt die aktive Map ueber die Netzwerk-Bridge ab (Basis-Schutzradien). Ohne
// laufende Netzwerksitzung wird hier nur diese eine Auskunft ersetzt. Bewusst Map 1 und nicht
// die Testarena: Dieser Harness soll das Loeschen von Map 0 ueberleben.
vi.mock('../src/network/bridge', () => ({
  bridge: { getCoopDefenseMapId: () => '1' },
}));

import {
  createSyntheticLargeArenaMapConfig,
  formatArenaGenerationBenchmark,
  LARGE_ARENA_BENCHMARK_HEIGHT_CELLS,
  LARGE_ARENA_BENCHMARK_SEEDS,
  LARGE_ARENA_BENCHMARK_WIDTH_CELLS,
  runArenaGenerationBenchmark,
} from '../src/arena/diagnostics/LargeArenaBenchmark';
import { ArenaGenerator } from '../src/arena/ArenaGenerator';
import {
  applyArenaMetricsForMode,
  DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS,
  DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS,
  GRID_COLS,
  GRID_ROWS,
} from '../src/config';
import { COOP_DEFENSE_MODE } from '../src/gameModes';

/**
 * Der Harness aus {@link ../src/arena/diagnostics/LargeArenaBenchmark} laeuft hier mit.
 *
 * Geprueft werden ausschliesslich **Eigenschaften**, nie Laufzeiten: Determinismus desselben
 * Seeds, Vollstaendigkeit des Layouts und die Tatsache, dass 400 x 80 ueberhaupt durchlaeuft.
 * Die gemessenen Zeiten werden ausgegeben, aber nicht bewertet – ein harter Millisekundenwert
 * waere auf fremder Hardware ein instabiles Gate und keine Aussage ueber den Code.
 */
/**
 * Der Suite-Lauf nimmt drei der fuenf Standard-Seeds. Eine 400 x 80-Generierung kostet knapp
 * eine Sekunde, mit Determinismus-Wiederholung also das Doppelte; der vollstaendige Satz gehoert
 * in den manuellen Lauf des Harness, nicht in jeden `npm test`.
 */
const SUITE_SEEDS = LARGE_ARENA_BENCHMARK_SEEDS.slice(0, 3);

describe('large arena generation', () => {
  it('generates 400 x 80 deterministically for fixed seeds and reports its timings', () => {
    const result = runArenaGenerationBenchmark({ seeds: SUITE_SEEDS });

    expect(result.widthCells).toBe(LARGE_ARENA_BENCHMARK_WIDTH_CELLS);
    expect(result.heightCells).toBe(LARGE_ARENA_BENCHMARK_HEIGHT_CELLS);
    expect(result.samples).toHaveLength(SUITE_SEEDS.length);
    expect(result.deterministic).toBe(true);

    for (const sample of result.samples) {
      // Ein Felsfeld dieser Groesse muss substanziell gefuellt sein; leer waere ein stiller
      // Ausfall des Korridor-Fraesens und keine Stressarena.
      expect(sample.rockCount).toBeGreaterThan(10_000);
      expect(sample.dirtCount).toBeGreaterThan(0);
      expect(sample.decalCount).toBeGreaterThan(0);
      // Das Wire-Format traegt keine Decals; es muss also kleiner sein als das volle Layout.
      expect(sample.wireBytes).toBeLessThan(sample.fullBytes);
    }

    // Landet im Testprotokoll und ist damit die dokumentierte Messung.
    console.info(formatArenaGenerationBenchmark(result));
  }, 120_000);

  it('keeps every generated cell inside the configured 400 x 80 grid', () => {
    applyArenaMetricsForMode(
      COOP_DEFENSE_MODE,
      'ARENA',
      LARGE_ARENA_BENCHMARK_WIDTH_CELLS,
      LARGE_ARENA_BENCHMARK_HEIGHT_CELLS,
    );
    try {
      expect(GRID_COLS).toBe(LARGE_ARENA_BENCHMARK_WIDTH_CELLS);
      expect(GRID_ROWS).toBe(LARGE_ARENA_BENCHMARK_HEIGHT_CELLS);

      const layout = ArenaGenerator.generate(4711, createSyntheticLargeArenaMapConfig());
      for (const cell of [...layout.rocks, ...layout.dirt, ...layout.trees]) {
        expect(cell.gridX).toBeGreaterThanOrEqual(0);
        expect(cell.gridX).toBeLessThan(LARGE_ARENA_BENCHMARK_WIDTH_CELLS);
        expect(cell.gridY).toBeGreaterThanOrEqual(0);
        expect(cell.gridY).toBeLessThan(LARGE_ARENA_BENCHMARK_HEIGHT_CELLS);
      }
      // Ein Felsfeld dieser Groesse muss substanziell gefuellt sein; die freien Zellen sind die
      // gefraesten Gaenge. Der Deckel des Fels-Index selbst wird in `RockGridIndexLarge` geprueft:
      // 400 x 80 bleibt mit 32 000 Zellen knapp *unter* dem alten Int16-Bereich und koennte ihn
      // deshalb gar nicht sprengen.
      expect(layout.rocks.length).toBeGreaterThan(20_000);
    } finally {
      applyArenaMetricsForMode(
        COOP_DEFENSE_MODE,
        'ARENA',
        DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS,
        DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS,
      );
    }
  }, 120_000);
});
