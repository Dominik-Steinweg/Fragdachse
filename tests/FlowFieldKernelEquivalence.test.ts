import { describe, expect, it } from 'vitest';

import {
  buildCostByCode,
  CELL_CODE,
  buildNeighborLookups,
  classifyTopology,
  computeBaseGoalIndexes,
  computeIntegrationField,
  computeVectorField,
  createFieldArrays,
  createTopology,
  normalizeGoalIndexes,
  resolveCellCode,
  totalCellsOf,
  type FlowFieldMetrics,
  type FlowFieldTopologyCounts,
} from '../src/systems/flowfield/FlowFieldKernel';
import {
  buildBaseDescriptors,
  buildBaseOccupancy,
  buildOccupancyRaster,
  buildStaticKindRaster,
  goalCellsToIndexes,
  createFlowFieldTuning,
} from '../src/systems/flowfield/FlowFieldSources';
import type { ArenaLayout } from '../src/types';
import type { BaseSpec } from '../src/arena/BaseRegistry';

/**
 * Goldene Digests des Rechenkerns.
 *
 * Sie wurden erzeugt, waehrend `EnemyFlowFieldService` seine Felder noch selbst berechnete: Dieselben
 * Fixtures liefen damals durch beide Implementierungen und stimmten Byte fuer Byte ueberein. Seit die
 * Altberechnung entfallen ist, halten die eingefrorenen Digests dieses Ergebnis fest.
 *
 * Drei Details sind dafuer tragend und duerfen im Kernel nicht "aufgeraeumt" werden: `Math.fround`
 * in der Kantenrelaxation, der Gleichkosten-Tiebreak ueber den kleineren Quellindex und die
 * Heap-Ordnung Prioritaet -> Quelle -> Index. Wer einen dieser Punkte anfasst, bricht hier.
 */
const GOLDENS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'one-cell corridor between two bases': { kindCodes: '643a4313', traversable: 'fe700d0e', destructible: 'dede1985', wallAdjacent: '25ce6415', costs: 'c6e7af70', goalIndexes: '05876d91', integrationField: 'ad25be18', vectorField: '3a2f23f0', goalSourceField: 'ab580088' },
  'single rock corner': { kindCodes: '34fab584', traversable: 'd05c7224', destructible: '1e19396c', wallAdjacent: '56451929', costs: 'bbec1bc0', goalIndexes: 'dd9ed725', integrationField: '626c3471', vectorField: 'c8ed62f1', goalSourceField: 'a0f8bb13' },
  'vertical tracks with mixed terrain': { kindCodes: '69f49ac0', traversable: 'dc500e32', destructible: '46cef945', wallAdjacent: '1a9ab4d1', costs: 'ce7dffc6', goalIndexes: 'dd9ed725', integrationField: 'd8367213', vectorField: '0d3aee41', goalSourceField: 'c48397bc' },
  'dormant mission outpost': { kindCodes: 'a946bcc5', traversable: 'cda34b41', destructible: 'dede1985', wallAdjacent: '56451929', costs: '92129865', goalIndexes: 'dd9ed725', integrationField: '86740831', vectorField: '9b9341bd', goalSourceField: 'fd42ad84' },
  'active mission outpost plus decorative outpost and hostile base': { kindCodes: '2c88b075', traversable: '1b8da4db', destructible: 'dede1985', wallAdjacent: '17faa32b', costs: '87be1615', goalIndexes: '9e1985f7', integrationField: '16da13b9', vectorField: 'd68874e4', goalSourceField: '0c792e2b' },
  'dynamic multi-goal field': { kindCodes: '0dd195e0', traversable: '1befd5a4', destructible: '63466724', wallAdjacent: '56451929', costs: 'f515eba0', goalIndexes: 'db069f2a', integrationField: '181bb96d', vectorField: 'e4e5ca29', goalSourceField: '5c74d853' },
  'dynamic goals filtered away fall back to bases': { kindCodes: 'a946bcc5', traversable: 'cda34b41', destructible: 'dede1985', wallAdjacent: '56451929', costs: '92129865', goalIndexes: 'dd9ed725', integrationField: '86740831', vectorField: '9b9341bd', goalSourceField: 'fd42ad84' },
  'boss clearance profile': { kindCodes: 'b2f6480b', traversable: '253f86bc', destructible: 'd900ebf5', wallAdjacent: 'dede1985', costs: '3fbc7e16', goalIndexes: 'f12d11f5', integrationField: 'df1befb1', vectorField: '768db6e0', goalSourceField: '48bdfe2d' },
};

const METRICS: FlowFieldMetrics = {
  cols: 16,
  rows: 11,
  cellSize: 32,
  arenaOffsetX: 0,
  arenaOffsetY: 0,
};

function createLayout(overrides: Partial<ArenaLayout> = {}): ArenaLayout {
  return {
    seed: 1,
    rocks: [],
    trees: [],
    tracks: [],
    dirt: [],
    powerUpPedestals: [],
    ...overrides,
  } as ArenaLayout;
}

function createBase(
  id: string,
  minGridX: number,
  minGridY: number,
  width: number,
  height: number,
  overrides: Partial<Pick<BaseSpec, 'role' | 'faction' | 'dormantObjectiveId'>> = {},
): BaseSpec {
  const cells: { gridX: number; gridY: number }[] = [];
  for (let gridY = minGridY; gridY < minGridY + height; gridY += 1) {
    for (let gridX = minGridX; gridX < minGridX + width; gridX += 1) {
      cells.push({ gridX, gridY });
    }
  }
  return {
    id,
    cells,
    region: {
      minGridX,
      minGridY,
      maxGridX: minGridX + width - 1,
      maxGridY: minGridY + height - 1,
    },
    hpMax: 1000,
    faction: 'friendly',
    role: 'main',
    turrets: [],
    powerUpPedestals: [],
    ...overrides,
  } as unknown as BaseSpec;
}

interface Fixture {
  readonly name: string;
  readonly layout: ArenaLayout;
  readonly bases: readonly BaseSpec[];
  readonly goalMode?: 'bases' | 'dynamic' | 'dynamic-fallback-bases';
  readonly dynamicGoalCells?: ReadonlyArray<{ gridX: number; gridY: number }>;
  readonly clearanceCells?: number;
  readonly activeBaseIds?: readonly string[];
}

function verticalTracks(gridX: number): ArenaLayout['tracks'] {
  return Array.from({ length: METRICS.rows }, (_, gridY) => ({ gridX, gridY }));
}

const FIXTURES: readonly Fixture[] = [
  {
    name: 'one-cell corridor between two bases',
    layout: createLayout(),
    bases: [createBase('top', 4, 0, 3, 5), createBase('bottom', 4, 7, 3, 4)],
  },
  {
    name: 'single rock corner',
    layout: createLayout({ rocks: [{ gridX: 2, gridY: 2 }] as ArenaLayout['rocks'] }),
    bases: [createBase('main', 12, 4, 2, 2)],
  },
  {
    name: 'vertical tracks with mixed terrain',
    layout: createLayout({
      tracks: verticalTracks(7),
      dirt: [{ gridX: 3, gridY: 3 }, { gridX: 3, gridY: 4 }] as ArenaLayout['dirt'],
      trees: [{ gridX: 9, gridY: 2 }] as ArenaLayout['trees'],
      powerUpPedestals: [{ gridX: 5, gridY: 8 }] as ArenaLayout['powerUpPedestals'],
      rocks: [{ gridX: 10, gridY: 6 }, { gridX: 10, gridY: 7 }] as ArenaLayout['rocks'],
    }),
    bases: [createBase('main', 12, 4, 2, 2)],
  },
  {
    name: 'dormant mission outpost',
    layout: createLayout(),
    bases: [
      createBase('main', 12, 4, 2, 2),
      createBase('mission-outpost', 2, 5, 1, 1, { role: 'outpost', dormantObjectiveId: 'hold-outpost' }),
    ],
    activeBaseIds: ['main'],
  },
  {
    name: 'active mission outpost plus decorative outpost and hostile base',
    layout: createLayout(),
    bases: [
      createBase('main', 12, 4, 2, 2),
      createBase('mission-outpost', 2, 5, 1, 1, { role: 'outpost', dormantObjectiveId: 'hold-outpost' }),
      createBase('decor-outpost', 6, 9, 1, 1, { role: 'outpost' }),
      createBase('hostile-camp', 1, 1, 2, 1, { faction: 'hostile' }),
    ],
  },
  {
    name: 'dynamic multi-goal field',
    layout: createLayout({ rocks: [{ gridX: 8, gridY: 5 }] as ArenaLayout['rocks'] }),
    bases: [createBase('main', 12, 4, 2, 2)],
    goalMode: 'dynamic',
    dynamicGoalCells: [{ gridX: 2, gridY: 5 }, { gridX: 13, gridY: 8 }, { gridX: 8, gridY: 5 }],
  },
  {
    name: 'dynamic goals filtered away fall back to bases',
    layout: createLayout(),
    bases: [createBase('main', 12, 4, 2, 2)],
    goalMode: 'dynamic-fallback-bases',
    dynamicGoalCells: [{ gridX: 12, gridY: 4 }, { gridX: 99, gridY: 99 }],
  },
  {
    name: 'boss clearance profile',
    layout: createLayout({
      rocks: [{ gridX: 5, gridY: 5 }, { gridX: 9, gridY: 2 }] as ArenaLayout['rocks'],
      trees: [{ gridX: 3, gridY: 8 }] as ArenaLayout['trees'],
    }),
    bases: [createBase('main', 12, 4, 2, 2)],
    clearanceCells: 1,
  },
];

interface KernelResult {
  readonly topology: ReturnType<typeof createTopology>;
  readonly counts: FlowFieldTopologyCounts;
  readonly goalIndexes: readonly number[];
  readonly fields: ReturnType<typeof createFieldArrays>;
}

function runKernel(fixture: Fixture): KernelResult {
  const clearanceCells = fixture.clearanceCells ?? 0;
  const goalMode = fixture.goalMode ?? 'bases';
  const tuning = createFlowFieldTuning();
  const costByCode = buildCostByCode(tuning);
  const bases = buildBaseDescriptors(fixture.bases);
  const activeBaseIds = new Set(fixture.activeBaseIds ?? fixture.bases.map((base) => base.id));
  const sources = {
    staticKind: buildStaticKindRaster(fixture.layout, METRICS),
    rockOccupancy: buildOccupancyRaster(fixture.layout.rocks, METRICS),
    baseOccupancy: buildBaseOccupancy(bases, activeBaseIds, METRICS),
    barrierOccupancy: new Uint8Array(METRICS.cols * METRICS.rows),
  };

  const topology = createTopology(totalCellsOf(METRICS));
  const counts = classifyTopology(topology, sources, METRICS, costByCode, tuning, clearanceCells);
  const lookups = buildNeighborLookups(METRICS);

  const rawGoals = goalCellsToIndexes(fixture.dynamicGoalCells ?? [], METRICS);
  let goalIndexes: number[] = [];
  if (goalMode !== 'bases') {
    goalIndexes = normalizeGoalIndexes(rawGoals, topology, METRICS);
  }
  if (goalMode === 'bases' || (goalMode === 'dynamic-fallback-bases' && goalIndexes.length === 0)) {
    goalIndexes = computeBaseGoalIndexes(bases, activeBaseIds, clearanceCells, topology, METRICS);
  }

  const fields = createFieldArrays(totalCellsOf(METRICS));
  computeIntegrationField(fields, topology, lookups, tuning, goalIndexes);
  computeVectorField(fields, topology, lookups, METRICS);

  return { topology, counts, goalIndexes, fields };
}

/** FNV-1a ueber die Bytes eines Arrays; kurz, stabil und im Diff lesbar. */
function digest(view: ArrayBufferView | readonly number[]): string {
  const bytes = Array.isArray(view)
    ? new Uint8Array(Int32Array.from(view as readonly number[]).buffer)
    : new Uint8Array((view as ArrayBufferView).buffer, (view as ArrayBufferView).byteOffset, (view as ArrayBufferView).byteLength);
  let hash = 0x811c9dc5;
  for (let cursor = 0; cursor < bytes.length; cursor += 1) {
    hash ^= bytes[cursor];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function digestsOf(result: KernelResult): Record<string, string> {
  return {
    kindCodes: digest(result.topology.kindCodes),
    traversable: digest(result.topology.traversable),
    destructible: digest(result.topology.destructible),
    wallAdjacent: digest(result.topology.wallAdjacent),
    costs: digest(result.topology.costs),
    goalIndexes: digest(result.goalIndexes),
    integrationField: digest(result.fields.integrationField),
    vectorField: digest(result.fields.vectorField),
    goalSourceField: digest(result.fields.goalSourceField),
  };
}

describe('FlowFieldKernel golden fields', () => {
  it('maps barrier occupancy to the existing non-destructible hard-wall code', () => {
    const total = METRICS.cols * METRICS.rows;
    const barrierOccupancy = new Uint8Array(total);
    barrierOccupancy[3] = 1;
    const sources = {
      staticKind: new Uint8Array(total).fill(CELL_CODE.ground),
      rockOccupancy: new Uint8Array(total),
      baseOccupancy: new Uint8Array(total),
      barrierOccupancy,
    };

    expect(resolveCellCode(sources, 3)).toBe(CELL_CODE.trunk);
    expect(Object.keys(CELL_CODE)).not.toContain('barrier');
  });
  for (const fixture of FIXTURES) {
    it(`reproduces every field for: ${fixture.name}`, () => {
      const actual = digestsOf(runKernel(fixture));
      const expected = GOLDENS[fixture.name];
      if (!expected) {
        // eslint-disable-next-line no-console
        console.log(`GOLDEN ${JSON.stringify(fixture.name)}: ${JSON.stringify(actual)},`);
        return;
      }
      expect(actual).toEqual(expected);
    });
  }

  it('keeps the corridor between the two bases open', () => {
    const kernel = runKernel(FIXTURES[0]);
    const index = (gridX: number, gridY: number): number => gridY * METRICS.cols + gridX;
    // Basen belegen die Zeilen 0..4 und 7..10; dazwischen bleiben zwei Zeilen begehbar.
    expect(kernel.topology.traversable[index(5, 4)]).toBe(0);
    expect(kernel.topology.traversable[index(5, 5)]).toBe(1);
    expect(kernel.topology.traversable[index(5, 6)]).toBe(1);
    expect(kernel.topology.traversable[index(5, 7)]).toBe(0);
    // Beide Korridorzeilen grenzen an eine Basiswand und tragen deshalb den Wandaufschlag.
    expect(kernel.topology.wallAdjacent[index(5, 5)]).toBe(1);
    expect(kernel.topology.costs[index(5, 5)]).toBeGreaterThan(kernel.topology.costs[index(0, 5)]);
  });

  it('pins the clearance profile as a genuinely different topology, not just a mask', () => {
    const fixture = FIXTURES[FIXTURES.length - 1];
    const withClearance = runKernel(fixture);
    const withoutClearance = runKernel({ ...fixture, clearanceCells: 0 });

    // Die Maske erodiert die Begehbarkeit ...
    expect(withClearance.counts.traversableCells).toBeLessThan(withoutClearance.counts.traversableCells);
    // ... und weil der Wandaufschlag danach laeuft und auf `traversable` gated ist, weichen auch
    // `wallAdjacent` und `costs` ab. Genau deshalb braucht das Profil eigene Arrays.
    expect(Array.from(withClearance.topology.wallAdjacent))
      .not.toEqual(Array.from(withoutClearance.topology.wallAdjacent));
    expect(Array.from(withClearance.topology.costs))
      .not.toEqual(Array.from(withoutClearance.topology.costs));
    // Der Zielabstand waechst mit der Clearance: Ziele liegen zwei statt einer Zelle vom Rand der
    // Basis (Spalten 12..13) entfernt.
    expect(withoutClearance.goalIndexes.map((index) => index % METRICS.cols)).toContain(11);
    expect(withClearance.goalIndexes.map((index) => index % METRICS.cols)).toContain(10);
    expect(withClearance.goalIndexes.map((index) => index % METRICS.cols)).not.toContain(11);
  });
});
