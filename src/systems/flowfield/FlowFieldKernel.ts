/**
 * Phaser-, Config- und DOM-freier Rechenkern aller Flowfields.
 *
 * Dieses Modul laeuft unveraendert im Main Thread und im Web Worker. Es darf deshalb ausschliesslich
 * relative Geschwister importieren: `src/config.ts` haelt mit `GRID_COLS`/`ARENA_OFFSET_*` mutable
 * `let`-Exporte, von denen der Worker eine zweite Modulinstanz mit Default-Werten saehe, und
 * `src/types.ts`/`src/arena/BaseRegistry.ts` ziehen Phaser bzw. die Netzwerkschicht nach.
 * Alle Kosten kommen deshalb als {@link FlowFieldTuning} herein, alle Rastermasse als
 * {@link FlowFieldMetrics}.
 *
 * Die Berechnung ist eine verhaltensgleiche Extraktion aus `EnemyFlowFieldService`. Drei Details
 * sind tragend und duerfen nicht "aufgeraeumt" werden:
 * - `Math.fround` in der Kantenrelaxation,
 * - der Gleichkosten-Tiebreak ueber den kleineren Quellindex,
 * - die Heap-Ordnung Prioritaet -> Quelle -> Index.
 * Zusammen machen sie `goalSourceField` deterministisch, und daran haengt die Zielwahl der
 * strategischen Gegner.
 */

export interface FlowFieldMetrics {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  readonly arenaOffsetX: number;
  readonly arenaOffsetY: number;
}

/** Kostentabelle des Rasters; entspricht den `COOP_DEFENSE_FLOW_FIELD_*`-Konstanten. */
export interface FlowFieldTuning {
  readonly groundCost: number;
  readonly dirtCost: number;
  readonly trackCost: number;
  readonly trackLongitudinalCost: number;
  readonly rockCost: number;
  readonly trunkCost: number;
  readonly baseCost: number;
  readonly wallAdjacentCost: number;
}

export type FlowFieldCellKind =
  | 'ground' | 'rock' | 'trunk' | 'dirt' | 'track' | 'pedestal' | 'base' | 'outOfBounds';

export const CELL_CODE = {
  ground: 0,
  rock: 1,
  trunk: 2,
  dirt: 3,
  track: 4,
  pedestal: 5,
  base: 6,
  outOfBounds: 7,
} as const;

export const CELL_KINDS_BY_CODE: readonly FlowFieldCellKind[] = [
  'ground', 'rock', 'trunk', 'dirt', 'track', 'pedestal', 'base', 'outOfBounds',
];

const TRAVERSABLE_BY_CODE = Uint8Array.of(1, 0, 0, 1, 1, 1, 0, 0);
const DESTRUCTIBLE_BY_CODE = Uint8Array.of(0, 1, 0, 0, 0, 0, 0, 0);
/**
 * Zellarten, die dauerhaft blockieren und nicht weggeraeumt werden koennen. Nur sie loesen den
 * Wandaufschlag aus - Felsen sind zerstoerbar und sollen weiterhin angelaufen werden.
 */
const WALL_BY_CODE = Uint8Array.of(0, 0, 1, 0, 0, 0, 1, 1);

export const INTEGRATION_INFINITY = 999999;

export const NEIGHBOR_DIRECTIONS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],      // cardinal
  [1, 1], [-1, -1], [1, -1], [-1, 1],    // diagonal
] as const;

export const NEIGHBOR_MOVE_FACTORS = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2] as const;

export function buildCostByCode(tuning: FlowFieldTuning): Uint32Array {
  const costs = new Uint32Array(8);
  costs[CELL_CODE.ground] = tuning.groundCost;
  costs[CELL_CODE.rock] = tuning.rockCost;
  costs[CELL_CODE.trunk] = tuning.trunkCost;
  costs[CELL_CODE.dirt] = tuning.dirtCost;
  costs[CELL_CODE.track] = tuning.trackCost;
  costs[CELL_CODE.pedestal] = tuning.groundCost;
  costs[CELL_CODE.base] = tuning.baseCost;
  costs[CELL_CODE.outOfBounds] = tuning.trunkCost;
  return costs;
}

export function createEmptyCounts(): Record<FlowFieldCellKind, number> {
  return { ground: 0, rock: 0, trunk: 0, dirt: 0, track: 0, pedestal: 0, base: 0, outOfBounds: 0 };
}

/** Allokationsarmer Min-Heap fuer die gewichtete Mehrziel-Dijkstra-Berechnung. */
export class FlowFieldMinHeap {
  private readonly indexes: number[] = [];
  private readonly priorities: number[] = [];
  private readonly sources: number[] = [];
  poppedIndex = -1;
  poppedPriority = 0;
  poppedSource = -1;

  get size(): number { return this.indexes.length; }

  clear(): void {
    this.indexes.length = 0;
    this.priorities.length = 0;
    this.sources.length = 0;
  }

  push(index: number, priority: number, source: number): void {
    let cursor = this.indexes.length;
    this.indexes.push(index);
    this.priorities.push(priority);
    this.sources.push(source);
    while (cursor > 0) {
      const parent = (cursor - 1) >> 1;
      if (!this.less(cursor, parent)) break;
      this.swap(cursor, parent);
      cursor = parent;
    }
  }

  pop(): void {
    this.poppedIndex = this.indexes[0];
    this.poppedPriority = this.priorities[0];
    this.poppedSource = this.sources[0];
    const last = this.indexes.length - 1;
    if (last === 0) {
      this.indexes.pop();
      this.priorities.pop();
      this.sources.pop();
      return;
    }
    this.indexes[0] = this.indexes.pop()!;
    this.priorities[0] = this.priorities.pop()!;
    this.sources[0] = this.sources.pop()!;
    let cursor = 0;
    while (true) {
      const left = cursor * 2 + 1;
      if (left >= this.indexes.length) break;
      const right = left + 1;
      let best = left;
      if (right < this.indexes.length && this.less(right, left)) best = right;
      if (!this.less(best, cursor)) break;
      this.swap(best, cursor);
      cursor = best;
    }
  }

  private less(left: number, right: number): boolean {
    const priorityDelta = this.priorities[left] - this.priorities[right];
    if (priorityDelta !== 0) return priorityDelta < 0;
    const sourceDelta = this.sources[left] - this.sources[right];
    if (sourceDelta !== 0) return sourceDelta < 0;
    return this.indexes[left] < this.indexes[right];
  }

  private swap(left: number, right: number): void {
    [this.indexes[left], this.indexes[right]] = [this.indexes[right], this.indexes[left]];
    [this.priorities[left], this.priorities[right]] = [this.priorities[right], this.priorities[left]];
    [this.sources[left], this.sources[right]] = [this.sources[right], this.sources[left]];
  }
}

// ---- Raster-Geometrie ----

export function totalCellsOf(metrics: FlowFieldMetrics): number {
  return metrics.cols * metrics.rows;
}

export function isInBounds(metrics: FlowFieldMetrics, gridX: number, gridY: number): boolean {
  return gridX >= 0 && gridX < metrics.cols && gridY >= 0 && gridY < metrics.rows;
}

export function toIndex(metrics: FlowFieldMetrics, gridX: number, gridY: number): number {
  return gridY * metrics.cols + gridX;
}

export function gridXOf(metrics: FlowFieldMetrics, index: number): number {
  return index % metrics.cols;
}

export function gridYOf(metrics: FlowFieldMetrics, index: number): number {
  return Math.floor(index / metrics.cols);
}

/**
 * Nachbar- und Diagonalwaechter-Tabellen. Sie haengen ausschliesslich an den Rastermassen und
 * werden deshalb je Seite einmal gebaut statt uebertragen.
 */
export interface FlowFieldNeighborLookups {
  readonly neighborIndices: Int32Array;
  readonly diagonalGuardA: Int32Array;
  readonly diagonalGuardB: Int32Array;
}

export function buildNeighborLookups(metrics: FlowFieldMetrics): FlowFieldNeighborLookups {
  const totalCells = totalCellsOf(metrics);
  const neighborIndices = new Int32Array(totalCells * 8).fill(-1);
  const diagonalGuardA = new Int32Array(totalCells * 8).fill(-1);
  const diagonalGuardB = new Int32Array(totalCells * 8).fill(-1);

  for (let gridY = 0; gridY < metrics.rows; gridY += 1) {
    for (let gridX = 0; gridX < metrics.cols; gridX += 1) {
      const index = toIndex(metrics, gridX, gridY);
      const base = index * 8;
      for (let direction = 0; direction < 8; direction += 1) {
        const [dx, dy] = NEIGHBOR_DIRECTIONS[direction];
        const neighborX = gridX + dx;
        const neighborY = gridY + dy;
        if (!isInBounds(metrics, neighborX, neighborY)) continue;
        neighborIndices[base + direction] = toIndex(metrics, neighborX, neighborY);
        if (direction < 4) continue;
        diagonalGuardA[base + direction] = toIndex(metrics, gridX + dx, gridY);
        diagonalGuardB[base + direction] = toIndex(metrics, gridX, gridY + dy);
      }
    }
  }

  return { neighborIndices, diagonalGuardA, diagonalGuardB };
}

// ---- Topologie ----

export interface FlowFieldTopology {
  readonly costs: Uint32Array;
  readonly kindCodes: Uint8Array;
  readonly traversable: Uint8Array;
  readonly destructible: Uint8Array;
  readonly wallAdjacent: Uint8Array;
}

/**
 * Zellquellen des Rasters. `staticKind` fasst die vier unveraenderlichen Quellen (Baumstumpf,
 * Gleis, Podest, Erde, sonst Boden) in ihrer Prioritaetsreihenfolge zusammen; Basis und Fels
 * ueberschreiben sie zur Laufzeit und stehen deshalb als eigene Belegungsraster daneben.
 */
export interface FlowFieldTopologySources {
  readonly staticKind: Uint8Array;
  readonly rockOccupancy: Uint8Array;
  readonly baseOccupancy: Uint8Array;
}

export interface FlowFieldTopologyCounts {
  traversableCells: number;
  blockedCells: number;
  countsByKind: Record<FlowFieldCellKind, number>;
}

export function createTopology(totalCells: number): FlowFieldTopology {
  return {
    costs: new Uint32Array(totalCells),
    kindCodes: new Uint8Array(totalCells),
    traversable: new Uint8Array(totalCells),
    destructible: new Uint8Array(totalCells),
    wallAdjacent: new Uint8Array(totalCells),
  };
}

/** Prioritaet: Basis vor Fels vor allen statischen Quellen. */
export function resolveCellCode(sources: FlowFieldTopologySources, index: number): number {
  if (sources.baseOccupancy[index] === 1) return CELL_CODE.base;
  if (sources.rockOccupancy[index] === 1) return CELL_CODE.rock;
  return sources.staticKind[index];
}

/** Vollstaendige Klassifikation inklusive Clearance-Maske und Wandaufschlag. */
export function classifyTopology(
  topology: FlowFieldTopology,
  sources: FlowFieldTopologySources,
  metrics: FlowFieldMetrics,
  costByCode: Uint32Array,
  tuning: FlowFieldTuning,
  clearanceCells: number,
): FlowFieldTopologyCounts {
  const countsByKind = createEmptyCounts();
  let traversableCells = 0;

  for (let gridY = 0; gridY < metrics.rows; gridY += 1) {
    for (let gridX = 0; gridX < metrics.cols; gridX += 1) {
      const index = toIndex(metrics, gridX, gridY);
      const code = resolveCellCode(sources, index);
      const isTraversable = TRAVERSABLE_BY_CODE[code];

      topology.costs[index] = costByCode[code];
      topology.kindCodes[index] = code;
      topology.traversable[index] = isTraversable;
      topology.destructible[index] = DESTRUCTIBLE_BY_CODE[code];
      countsByKind[CELL_KINDS_BY_CODE[code]] += 1;
      if (isTraversable === 1) traversableCells += 1;
    }
  }

  if (clearanceCells > 0) {
    traversableCells = applyClearanceMask(topology, metrics, clearanceCells);
  }

  applyWallAdjacencySurcharge(topology, metrics, tuning);

  return {
    traversableCells,
    blockedCells: totalCellsOf(metrics) - traversableCells,
    countsByKind,
  };
}

/**
 * Sperrt jede Zelle, deren volles (2c+1)-Quadrat nicht begehbar ist. Der Arenarand zaehlt dabei als
 * gesperrt, damit ein breiter Koerper nicht mit halbem Volumen ausserhalb der Karte plant.
 */
function applyClearanceMask(
  topology: FlowFieldTopology,
  metrics: FlowFieldMetrics,
  clearanceCells: number,
): number {
  const source = topology.traversable.slice();
  let traversableCells = 0;

  for (let gridY = 0; gridY < metrics.rows; gridY += 1) {
    for (let gridX = 0; gridX < metrics.cols; gridX += 1) {
      const index = toIndex(metrics, gridX, gridY);
      if (source[index] !== 1) {
        topology.traversable[index] = 0;
        continue;
      }

      let hasClearance = true;
      for (let offsetY = -clearanceCells; offsetY <= clearanceCells && hasClearance; offsetY += 1) {
        for (let offsetX = -clearanceCells; offsetX <= clearanceCells; offsetX += 1) {
          const neighborX = gridX + offsetX;
          const neighborY = gridY + offsetY;
          if (!isInBounds(metrics, neighborX, neighborY) || source[toIndex(metrics, neighborX, neighborY)] !== 1) {
            hasClearance = false;
            break;
          }
        }
      }

      topology.traversable[index] = hasClearance ? 1 : 0;
      if (hasClearance) traversableCells += 1;
    }
  }

  return traversableCells;
}

/**
 * Markiert begehbare Zellen neben unzerstoerbaren Hindernissen und verteuert sie.
 *
 * Das Feld plant auf Zellmittelpunkten, normale Koerper sind dabei hoechstens 30 px breit bei
 * 32 px Zellgroesse. Eine Route direkt an einer Basiswand laesst den Koerper deshalb dauerhaft in
 * der Wand stecken. Der Aufschlag ist absichtlich klein - enge Korridore bleiben passierbar, offene
 * Wege biegen sich aber um eine Zelle von der Wand weg.
 *
 * Laeuft bewusst NACH der Clearance-Maske und liest `traversable`: Ein Clearance-Profil erhaelt
 * dadurch nicht nur ein eigenes `traversable`, sondern auch eigene `costs` und `wallAdjacent`.
 */
function applyWallAdjacencySurcharge(
  topology: FlowFieldTopology,
  metrics: FlowFieldMetrics,
  tuning: FlowFieldTuning,
): void {
  topology.wallAdjacent.fill(0);
  if (tuning.wallAdjacentCost <= 0) return;

  for (let gridY = 0; gridY < metrics.rows; gridY += 1) {
    for (let gridX = 0; gridX < metrics.cols; gridX += 1) {
      const index = toIndex(metrics, gridX, gridY);
      if (topology.traversable[index] !== 1) continue;
      if (!hasIndestructibleBlockerNeighbor(topology, metrics, gridX, gridY)) continue;
      topology.wallAdjacent[index] = 1;
      topology.costs[index] += tuning.wallAdjacentCost;
    }
  }
}

function hasIndestructibleBlockerNeighbor(
  topology: FlowFieldTopology,
  metrics: FlowFieldMetrics,
  gridX: number,
  gridY: number,
): boolean {
  for (const [dx, dy] of NEIGHBOR_DIRECTIONS) {
    const neighborX = gridX + dx;
    const neighborY = gridY + dy;
    // Der Arenarand zaehlt nicht mit: Sonst waere jede Randspur teuer, obwohl dort weder
    // Basiswaende noch Baumstuempfe stehen und Gegner regulaer am Rand einbuddeln.
    if (!isInBounds(metrics, neighborX, neighborY)) continue;
    // Bewusst ueber die Zellart statt ueber `traversable`: Der Clearance-Mask sperrt zusaetzliche
    // Bodenzellen, die keine echten Waende sind und deshalb keinen Aufschlag ausloesen duerfen.
    if (WALL_BY_CODE[topology.kindCodes[toIndex(metrics, neighborX, neighborY)]] === 1) return true;
  }
  return false;
}

/**
 * Aktualisiert bei einem Fels-/Bauplatzereignis nur die betroffenen Zellen samt
 * Wall-Adjacency-Nachbarschaft. Nur fuer Profile ohne Clearance gueltig - eine Clearance-Maske
 * kann durch eine einzelne Zelle beliebig weit entfernte Zellen umschalten.
 */
export function patchTopologyCells(
  topology: FlowFieldTopology,
  sources: FlowFieldTopologySources,
  metrics: FlowFieldMetrics,
  costByCode: Uint32Array,
  tuning: FlowFieldTuning,
  lookups: FlowFieldNeighborLookups,
  indexes: Iterable<number>,
  counts: FlowFieldTopologyCounts,
): void {
  const adjacencyCandidates = new Set<number>();
  for (const index of indexes) {
    const oldCode = topology.kindCodes[index];
    const nextCode = resolveCellCode(sources, index);
    if (oldCode !== nextCode) {
      const nextTraversable = TRAVERSABLE_BY_CODE[nextCode];
      counts.countsByKind[CELL_KINDS_BY_CODE[oldCode]] -= 1;
      counts.countsByKind[CELL_KINDS_BY_CODE[nextCode]] += 1;
      const wasTraversable = topology.traversable[index] === 1;
      topology.kindCodes[index] = nextCode;
      topology.traversable[index] = nextTraversable;
      topology.destructible[index] = DESTRUCTIBLE_BY_CODE[nextCode];
      if (wasTraversable !== (nextTraversable === 1)) {
        counts.traversableCells += nextTraversable === 1 ? 1 : -1;
      }
    }
    adjacencyCandidates.add(index);
    const neighborBase = index * 8;
    for (let direction = 0; direction < 8; direction += 1) {
      const neighborIndex = lookups.neighborIndices[neighborBase + direction];
      if (neighborIndex >= 0) adjacencyCandidates.add(neighborIndex);
    }
  }
  for (const index of adjacencyCandidates) {
    refreshWallAdjacencyAt(topology, metrics, costByCode, tuning, index);
  }
  counts.blockedCells = totalCellsOf(metrics) - counts.traversableCells;
}

function refreshWallAdjacencyAt(
  topology: FlowFieldTopology,
  metrics: FlowFieldMetrics,
  costByCode: Uint32Array,
  tuning: FlowFieldTuning,
  index: number,
): void {
  topology.costs[index] = costByCode[topology.kindCodes[index]];
  topology.wallAdjacent[index] = 0;
  if (tuning.wallAdjacentCost <= 0 || topology.traversable[index] !== 1) return;
  const gridX = gridXOf(metrics, index);
  const gridY = gridYOf(metrics, index);
  if (!hasIndestructibleBlockerNeighbor(topology, metrics, gridX, gridY)) return;
  topology.wallAdjacent[index] = 1;
  topology.costs[index] += tuning.wallAdjacentCost;
}

// ---- Erreichbarkeit und Kosten ----

export function isFlowPassableAt(
  topology: FlowFieldTopology,
  metrics: FlowFieldMetrics,
  gridX: number,
  gridY: number,
): boolean {
  if (!isInBounds(metrics, gridX, gridY)) return false;
  return topology.traversable[toIndex(metrics, gridX, gridY)] === 1;
}

export function isReachableNeighborIndex(
  topology: FlowFieldTopology,
  lookups: FlowFieldNeighborLookups,
  currentIndex: number,
  direction: number,
): boolean {
  const lookupIndex = currentIndex * 8 + direction;
  const neighborIndex = lookups.neighborIndices[lookupIndex];
  if (neighborIndex < 0 || topology.traversable[neighborIndex] !== 1) return false;
  if (direction < 4) return true;
  const guardA = lookups.diagonalGuardA[lookupIndex];
  const guardB = lookups.diagonalGuardB[lookupIndex];
  return guardA >= 0
    && guardB >= 0
    && topology.traversable[guardA] === 1
    && topology.traversable[guardB] === 1;
}

/**
 * Gleise bleiben begehbar. Nur ein Uebergang von einer Gleiszelle in die naechste wird fuer
 * laengs gerichtete Bewegung verteuert; ein seitliches Ueberqueren bezahlt weiterhin nur die
 * normale moderate Gleiskostenklasse. Der Check sitzt hier zentral, damit Flow Field und seltene
 * zielgebundene A*-Pfade dieselbe Gewichtung verwenden.
 */
export function getTransitionCost(
  topology: FlowFieldTopology,
  tuning: FlowFieldTuning,
  currentIndex: number,
  nextIndex: number,
  direction: number,
): number {
  const nextCost = topology.costs[nextIndex];
  if (
    tuning.trackLongitudinalCost <= 0
    || topology.kindCodes[currentIndex] !== CELL_CODE.track
    || topology.kindCodes[nextIndex] !== CELL_CODE.track
    || NEIGHBOR_DIRECTIONS[direction][1] === 0
  ) {
    return nextCost;
  }
  return nextCost + tuning.trackLongitudinalCost;
}

// ---- Ziele ----

/** Basisbeschreibung des Worker-Protokolls: Zellen als rohe Koordinatenpaare (x0, y0, x1, y1, ...). */
export interface FlowFieldBaseDescriptor {
  readonly id: string;
  /**
   * Bewusst Koordinatenpaare statt Zellindizes: Eine Basis darf Zellen ausserhalb des Rasters
   * fuehren. Sie zaehlen dann nicht als Hindernis, koennen ueber den Zielabstand aber trotzdem
   * eine gueltige Zielzelle im Raster erzeugen.
   */
  readonly cellCoords: Int32Array;
  /**
   * Ob die Basis Zielzellen beitraegt. Fasst die authored Filter zusammen: feindliche Fraktion,
   * Spawn-Punkte und objectivelose Vorposten liefern keine Ziele, bleiben als aktive Basis aber
   * weiterhin Hindernis.
   */
  readonly isGoalSource: boolean;
}

export function isGoalCandidateAt(
  topology: FlowFieldTopology,
  metrics: FlowFieldMetrics,
  gridX: number,
  gridY: number,
): boolean {
  if (!isFlowPassableAt(topology, metrics, gridX, gridY)) return false;
  return topology.kindCodes[toIndex(metrics, gridX, gridY)] !== CELL_CODE.base;
}

const BASE_GOAL_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

export function computeBaseGoalIndexes(
  bases: readonly FlowFieldBaseDescriptor[],
  activeBaseIds: ReadonlySet<string>,
  clearanceCells: number,
  topology: FlowFieldTopology,
  metrics: FlowFieldMetrics,
): number[] {
  const goalSet = new Set<number>();
  const goalDistance = clearanceCells + 1;

  for (const base of bases) {
    if (!activeBaseIds.has(base.id)) continue;
    // Nur die Ziele werden gefiltert: feindliche Basiszellen bleiben Hindernisse und muessen
    // deshalb weiterhin im Kostenfeld stehen.
    if (!base.isGoalSource) continue;
    for (let cursor = 0; cursor < base.cellCoords.length; cursor += 2) {
      const cellX = base.cellCoords[cursor];
      const cellY = base.cellCoords[cursor + 1];
      for (const [dx, dy] of BASE_GOAL_DIRECTIONS) {
        const neighborX = cellX + dx * goalDistance;
        const neighborY = cellY + dy * goalDistance;
        if (!isGoalCandidateAt(topology, metrics, neighborX, neighborY)) continue;
        goalSet.add(toIndex(metrics, neighborX, neighborY));
      }
    }
  }

  return [...goalSet].sort((left, right) => left - right);
}

/** Entdoppelt, filtert gegen das Profil-`traversable` und sortiert - je Profil eigenstaendig. */
export function normalizeGoalIndexes(
  rawIndexes: ArrayLike<number>,
  topology: FlowFieldTopology,
  metrics: FlowFieldMetrics,
): number[] {
  const uniqueGoalIndexes = new Set<number>();
  const totalCells = totalCellsOf(metrics);
  for (let cursor = 0; cursor < rawIndexes.length; cursor += 1) {
    const index = rawIndexes[cursor];
    if (index < 0 || index >= totalCells) continue;
    if (!isGoalCandidateAt(topology, metrics, gridXOf(metrics, index), gridYOf(metrics, index))) continue;
    uniqueGoalIndexes.add(index);
  }
  return [...uniqueGoalIndexes].sort((left, right) => left - right);
}

// ---- Felder ----

export interface FlowFieldArrays {
  readonly integrationField: Float32Array;
  readonly vectorField: Float32Array;
  readonly goalSourceField: Int32Array;
}

export function createFieldArrays(totalCells: number): FlowFieldArrays {
  return {
    integrationField: new Float32Array(totalCells),
    vectorField: new Float32Array(totalCells * 2),
    goalSourceField: new Int32Array(totalCells),
  };
}

export function computeIntegrationField(
  target: FlowFieldArrays,
  topology: FlowFieldTopology,
  lookups: FlowFieldNeighborLookups,
  tuning: FlowFieldTuning,
  goalIndexes: ArrayLike<number>,
  heap: FlowFieldMinHeap = new FlowFieldMinHeap(),
): void {
  const { integrationField, goalSourceField } = target;
  integrationField.fill(INTEGRATION_INFINITY);
  goalSourceField.fill(-1);

  heap.clear();
  for (let cursor = 0; cursor < goalIndexes.length; cursor += 1) {
    const index = goalIndexes[cursor];
    integrationField[index] = 0;
    goalSourceField[index] = index;
    heap.push(index, 0, index);
  }

  while (heap.size > 0) {
    heap.pop();
    const currentIndex = heap.poppedIndex;
    const currentValue = heap.poppedPriority;
    const sourceIndex = heap.poppedSource;
    // Eine Zelle darf mehrfach im Heap liegen. Veraltete Eintraege kosten nur diesen Test.
    if (
      currentValue !== integrationField[currentIndex]
      || sourceIndex !== goalSourceField[currentIndex]
    ) continue;

    const neighborBase = currentIndex * 8;
    for (let direction = 0; direction < 8; direction += 1) {
      if (!isReachableNeighborIndex(topology, lookups, currentIndex, direction)) continue;
      const neighborIndex = lookups.neighborIndices[neighborBase + direction];
      const neighborCost = getTransitionCost(topology, tuning, currentIndex, neighborIndex, direction);
      const newValue = Math.fround(currentValue + neighborCost * NEIGHBOR_MOVE_FACTORS[direction]);

      if (
        newValue < integrationField[neighborIndex]
        || (newValue === integrationField[neighborIndex]
          && sourceIndex >= 0
          && (goalSourceField[neighborIndex] < 0 || sourceIndex < goalSourceField[neighborIndex]))
      ) {
        integrationField[neighborIndex] = newValue;
        goalSourceField[neighborIndex] = sourceIndex;
        heap.push(neighborIndex, newValue, sourceIndex);
      }
    }
  }
}

export function computeVectorField(
  target: FlowFieldArrays,
  topology: FlowFieldTopology,
  lookups: FlowFieldNeighborLookups,
  metrics: FlowFieldMetrics,
): void {
  const { integrationField, vectorField } = target;
  for (let gridY = 0; gridY < metrics.rows; gridY += 1) {
    for (let gridX = 0; gridX < metrics.cols; gridX += 1) {
      const index = toIndex(metrics, gridX, gridY);
      const vIndex = index * 2;

      if (topology.traversable[index] !== 1) {
        vectorField[vIndex] = 0;
        vectorField[vIndex + 1] = 0;
        continue;
      }

      let bestDirection = -1;
      let bestValue = integrationField[index];

      const neighborBase = index * 8;
      for (let direction = 0; direction < 8; direction += 1) {
        if (!isReachableNeighborIndex(topology, lookups, index, direction)) continue;
        const neighborValue = integrationField[lookups.neighborIndices[neighborBase + direction]];
        if (neighborValue < bestValue) {
          bestValue = neighborValue;
          bestDirection = direction;
        }
      }

      if (bestDirection >= 0) {
        const [dirX, dirY] = NEIGHBOR_DIRECTIONS[bestDirection];
        const invLength = bestDirection < 4 ? 1 : Math.SQRT1_2;
        vectorField[vIndex] = dirX * invLength;
        vectorField[vIndex + 1] = dirY * invLength;
      } else {
        vectorField[vIndex] = 0;
        vectorField[vIndex + 1] = 0;
      }
    }
  }
}
