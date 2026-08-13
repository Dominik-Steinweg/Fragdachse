import type { ArenaLayout, PowerUpPedestalCell } from '../types';
import type { BaseSpec } from '../arena/BaseRegistry';
import {
  COOP_DEFENSE_FLOW_FIELD_BASE_COST,
  COOP_DEFENSE_FLOW_FIELD_DIRT_COST,
  COOP_DEFENSE_FLOW_FIELD_GROUND_COST,
  COOP_DEFENSE_FLOW_FIELD_REBUILD_INTERVAL_MS,
  COOP_DEFENSE_FLOW_FIELD_ROCK_COST,
  COOP_DEFENSE_FLOW_FIELD_TRACK_COST,
  COOP_DEFENSE_FLOW_FIELD_TRUNK_COST,
  COOP_DEFENSE_FLOW_FIELD_WALL_ADJACENT_COST,
} from '../config';
import {
  ARENA_MAP_GRID_CHANGED_EVENT,
  type ArenaEventBus,
  type ArenaMapGridChangedEvent,
} from '../scenes/arena/ArenaEvents';

export interface EnemyFlowFieldMetrics {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  readonly arenaOffsetX: number;
  readonly arenaOffsetY: number;
}

export interface EnemyFlowFieldGridCell {
  readonly gridX: number;
  readonly gridY: number;
}

export type EnemyFlowFieldGoalCell = EnemyFlowFieldGridCell;
export type EnemyFlowFieldGoalMode = 'bases' | 'dynamic' | 'dynamic-fallback-bases';

export interface EnemyFlowFieldSummary {
  readonly cols: number;
  readonly rows: number;
  readonly totalCells: number;
  readonly traversableCells: number;
  readonly blockedCells: number;
  readonly goalCells: number;
  readonly countsByKind: Readonly<Record<EnemyFlowFieldCellKind, number>>;
}

export interface EnemyFlowFieldVector {
  readonly x: number;
  readonly y: number;
}

type SourceCellLookup = ReadonlySet<number>;

interface EnemyFlowFieldBuildContext {
  readonly dirtCells: SourceCellLookup;
  readonly rockCells: SourceCellLookup;
  readonly trunkCells: SourceCellLookup;
  readonly trackCells: SourceCellLookup;
  readonly pedestalCells: SourceCellLookup;
  readonly baseCells: SourceCellLookup;
}

interface EnemyFlowFieldCellDefinition {
  readonly code: number;
  readonly cost: number;
  readonly isTraversable: boolean;
  readonly isDestructible: boolean;
}

interface EnemyFlowFieldCellRule {
  readonly kind: EnemyFlowFieldCellKind;
  readonly matches: (cellKey: number, context: EnemyFlowFieldBuildContext) => boolean;
}

export interface EnemyFlowFieldServiceOptions {
  readonly eventBus?: ArenaEventBus;
  readonly obstacleCellProvider?: () => ReadonlyArray<EnemyFlowFieldGridCell>;
  readonly goalMode?: EnemyFlowFieldGoalMode;
  readonly dynamicGoalCells?: ReadonlyArray<EnemyFlowFieldGoalCell>;
  /** Number of whole cells kept clear around an enemy's center. */
  readonly clearanceCells?: number;
  /** Teilt die unveraenderliche/topologische Rasterbasis mit einem gleich grossen Service. */
  readonly topologySource?: EnemyFlowFieldService;
}

/** Begrenzter Sonderbewegungs-Check fuer einen Kreis entlang eines kurzen Weltsegments. */
export type EnemyCirclePathResolver = (
  fromWorldX: number,
  fromWorldY: number,
  toWorldX: number,
  toWorldY: number,
  radius: number,
) => boolean;

const CELL_DEFINITIONS = {
  ground: { code: 0, cost: COOP_DEFENSE_FLOW_FIELD_GROUND_COST, isTraversable: true, isDestructible: false },
  rock: { code: 1, cost: COOP_DEFENSE_FLOW_FIELD_ROCK_COST, isTraversable: false, isDestructible: true },
  trunk: { code: 2, cost: COOP_DEFENSE_FLOW_FIELD_TRUNK_COST, isTraversable: false, isDestructible: false },
  dirt: { code: 3, cost: COOP_DEFENSE_FLOW_FIELD_DIRT_COST, isTraversable: true, isDestructible: false },
  track: { code: 4, cost: COOP_DEFENSE_FLOW_FIELD_TRACK_COST, isTraversable: true, isDestructible: false },
  pedestal: { code: 5, cost: COOP_DEFENSE_FLOW_FIELD_GROUND_COST, isTraversable: true, isDestructible: false },
  base: { code: 6, cost: COOP_DEFENSE_FLOW_FIELD_BASE_COST, isTraversable: false, isDestructible: false },
  outOfBounds: { code: 7, cost: COOP_DEFENSE_FLOW_FIELD_TRUNK_COST, isTraversable: false, isDestructible: false },
} as const satisfies Record<string, EnemyFlowFieldCellDefinition>;

const CELL_KINDS_BY_CODE = Object.entries(CELL_DEFINITIONS).reduce<Record<number, EnemyFlowFieldCellKind>>(
  (result, [kind, definition]) => {
    result[definition.code] = kind as EnemyFlowFieldCellKind;
    return result;
  },
  {},
);

const CELL_RULES: readonly EnemyFlowFieldCellRule[] = [
  { kind: 'base', matches: (cellKey, context) => context.baseCells.has(cellKey) },
  { kind: 'rock', matches: (cellKey, context) => context.rockCells.has(cellKey) },
  { kind: 'trunk', matches: (cellKey, context) => context.trunkCells.has(cellKey) },
  { kind: 'track', matches: (cellKey, context) => context.trackCells.has(cellKey) },
  { kind: 'pedestal', matches: (cellKey, context) => context.pedestalCells.has(cellKey) },
  { kind: 'dirt', matches: (cellKey, context) => context.dirtCells.has(cellKey) },
  { kind: 'ground', matches: () => true },
] as const;

export type EnemyFlowFieldCellKind = keyof typeof CELL_DEFINITIONS;

/**
 * Zellarten, die dauerhaft blockieren und nicht weggeraeumt werden koennen. Nur sie loesen den
 * Wandaufschlag aus – Felsen sind zerstoerbar und sollen weiterhin angelaufen werden.
 */
const WALL_KIND_CODES: ReadonlySet<number> = new Set(
  Object.values(CELL_DEFINITIONS)
    .filter((definition) => !definition.isTraversable && !definition.isDestructible)
    .map((definition) => definition.code),
);
const MAX_SAFE_POSITION_SEARCH_RADIUS_CELLS = 4;
const NEIGHBOR_MOVE_FACTORS = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2] as const;

/** Allokationsarmer Min-Heap fuer die gewichtete Mehrziel-Dijkstra-Berechnung. */
class FlowFieldMinHeap {
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

export class EnemyFlowFieldService {
  private readonly metrics: EnemyFlowFieldMetrics;
  private readonly layout: ArenaLayout;
  private readonly baseSpecs: readonly BaseSpec[];
  private readonly goalMode: EnemyFlowFieldGoalMode;
  private readonly clearanceCells: number;
  private activeBaseIds: Set<string>;
  private dynamicGoalCells: EnemyFlowFieldGoalCell[];
  private readonly eventBus: ArenaEventBus | null;
  private readonly obstacleCellProvider: (() => ReadonlyArray<EnemyFlowFieldGridCell>) | null;
  private readonly topologySource: EnemyFlowFieldService | null;
  private readonly costs: Uint32Array;
  private readonly kindCodes: Uint8Array;
  private readonly traversable: Uint8Array;
  private readonly destructible: Uint8Array;
  /**
   * Begehbare Zellen mit mindestens einem unzerstoerbaren Hindernis in der 8er-Nachbarschaft.
   * Traegt beides: den Kostenaufschlag beim Feldaufbau und die Umschaltung auf Wegpunkt-Steuerung
   * beim Verbraucher.
   */
  private readonly wallAdjacent: Uint8Array;
  private readonly neighborIndices: Int32Array;
  private readonly diagonalGuardA: Int32Array;
  private readonly diagonalGuardB: Int32Array;
  private readonly goalMask: Uint8Array;
  private readonly goalCells: EnemyFlowFieldGoalCell[];
  private readonly summary: {
    cols: number;
    rows: number;
    totalCells: number;
    traversableCells: number;
    blockedCells: number;
    goalCells: number;
    countsByKind: Record<EnemyFlowFieldCellKind, number>;
  };
  private readonly integrationField: Float32Array;
  private readonly vectorField: Float32Array; // 2 floats (x, y) per cell
  /** Index der Zielzelle hinter der guenstigsten Route; -1 bedeutet nicht erreichbar. */
  private readonly goalSourceField: Int32Array;
  /** Wiederverwendeter Workspace fuer seltene zielgebundene Sonderpfade. */
  private readonly targetPathCosts: Float32Array;
  private readonly targetPathParents: Int32Array;
  private readonly targetPathGeneration: Uint32Array;
  private readonly targetPathOpen = new FlowFieldMinHeap();
  private targetPathGenerationId = 0;
  private targetPathSequence = 0;
  private debugOverlayCallback: ((renderer: EnemyFlowFieldDebugRenderer) => void) | null = null;
  private isTopologyDirty = false;
  private isGoalDirty = false;
  private fullTopologyRebuildRequired = false;
  private readonly pendingTopologyCells = new Set<number>();
  private lastDirtyCheckAt = 0;

  static readonly INTEGRATION_INFINITY = 999999;
  static readonly NEIGHBOR_DIRECTIONS = [
    [1, 0], [-1, 0], [0, 1], [0, -1],      // cardinal
    [1, 1], [-1, -1], [1, -1], [-1, 1],    // diagonal
  ] as const;

  constructor(
    layout: ArenaLayout,
    baseSpecs: readonly BaseSpec[],
    metrics: EnemyFlowFieldMetrics,
    options: EnemyFlowFieldServiceOptions = {},
  ) {
    this.layout = layout;
    this.baseSpecs = [...baseSpecs];
    this.goalMode = options.goalMode ?? 'bases';
    this.clearanceCells = Math.max(0, Math.floor(options.clearanceCells ?? 0));
    this.activeBaseIds = new Set(this.baseSpecs.map((spec) => spec.id));
    const initialDynamicGoalCells = options.dynamicGoalCells ?? [];
    this.dynamicGoalCells = [];
    this.metrics = { ...metrics };
    this.eventBus = options.eventBus ?? null;
    this.obstacleCellProvider = options.obstacleCellProvider ?? null;
    const totalCells = this.metrics.cols * this.metrics.rows;
    const requestedTopologySource = options.topologySource ?? null;
    const canShareTopology = requestedTopologySource !== null
      && requestedTopologySource.costs.length === totalCells
      && requestedTopologySource.clearanceCells === this.clearanceCells;
    this.topologySource = canShareTopology ? requestedTopologySource : null;
    this.costs = canShareTopology ? this.topologySource!.costs : new Uint32Array(totalCells);
    this.kindCodes = canShareTopology ? this.topologySource!.kindCodes : new Uint8Array(totalCells);
    this.traversable = canShareTopology ? this.topologySource!.traversable : new Uint8Array(totalCells);
    this.destructible = canShareTopology ? this.topologySource!.destructible : new Uint8Array(totalCells);
    this.wallAdjacent = canShareTopology ? this.topologySource!.wallAdjacent : new Uint8Array(totalCells);
    this.neighborIndices = canShareTopology ? this.topologySource!.neighborIndices : new Int32Array(totalCells * 8);
    this.diagonalGuardA = canShareTopology ? this.topologySource!.diagonalGuardA : new Int32Array(totalCells * 8);
    this.diagonalGuardB = canShareTopology ? this.topologySource!.diagonalGuardB : new Int32Array(totalCells * 8);
    this.goalMask = new Uint8Array(totalCells);
    this.integrationField = new Float32Array(totalCells);
    this.vectorField = new Float32Array(totalCells * 2);
    this.goalSourceField = new Int32Array(totalCells);
    this.targetPathCosts = new Float32Array(totalCells);
    this.targetPathParents = new Int32Array(totalCells);
    this.targetPathGeneration = new Uint32Array(totalCells);
    this.goalCells = [];
    this.summary = {
      cols: this.metrics.cols,
      rows: this.metrics.rows,
      totalCells,
      traversableCells: 0,
      blockedCells: totalCells,
      goalCells: 0,
      countsByKind: this.createEmptyCounts(),
    };

    if (!canShareTopology) this.buildNeighborLookups();
    this.recomputeTopology();
    if (initialDynamicGoalCells.length > 0) {
      this.dynamicGoalCells = this.normalizeGoalCells(initialDynamicGoalCells);
    }
    this.recomputeGoalAndVectorFields();
    this.lastDirtyCheckAt = Date.now();
    this.eventBus?.on(ARENA_MAP_GRID_CHANGED_EVENT, this.handleArenaMapGridChanged, this);
  }

  getCols(): number {
    return this.metrics.cols;
  }

  getRows(): number {
    return this.metrics.rows;
  }

  getCellSize(): number {
    return this.metrics.cellSize;
  }

  getLayout(): ArenaLayout {
    return this.layout;
  }

  getBaseRegions(): readonly BaseSpec[] {
    return this.baseSpecs;
  }

  getGoalCells(): readonly EnemyFlowFieldGoalCell[] {
    return this.goalCells;
  }

  isGoalCell(gridX: number, gridY: number): boolean {
    if (!this.isInBounds(gridX, gridY)) return false;
    return this.goalMask[this.toIndex(gridX, gridY)] === 1;
  }

  getSummary(): EnemyFlowFieldSummary {
    return this.summary;
  }

  getCostAt(gridX: number, gridY: number): number {
    if (!this.isInBounds(gridX, gridY)) return CELL_DEFINITIONS.outOfBounds.cost;
    return this.costs[this.toIndex(gridX, gridY)];
  }

  getKindAt(gridX: number, gridY: number): EnemyFlowFieldCellKind {
    if (!this.isInBounds(gridX, gridY)) return 'outOfBounds';
    return CELL_KINDS_BY_CODE[this.kindCodes[this.toIndex(gridX, gridY)]];
  }

  isTraversableAt(gridX: number, gridY: number): boolean {
    if (!this.isInBounds(gridX, gridY)) return false;
    return this.traversable[this.toIndex(gridX, gridY)] === 1;
  }

  isDestructibleAt(gridX: number, gridY: number): boolean {
    if (!this.isInBounds(gridX, gridY)) return false;
    return this.destructible[this.toIndex(gridX, gridY)] === 1;
  }

  /**
   * True, wenn die Zelle an ein unzerstoerbares Hindernis grenzt (Basis oder Baumstumpf).
   * Verbraucher schalten dort auf Wegpunkt-Steuerung um, statt dem groben Zellvektor zu folgen.
   */
  isWallAdjacentAt(gridX: number, gridY: number): boolean {
    if (!this.isInBounds(gridX, gridY)) return false;
    return this.wallAdjacent[this.toIndex(gridX, gridY)] === 1;
  }

  /**
   * Prueft, ob die Luftlinie zwischen zwei Weltpunkten ausschliesslich ueber begehbare Zellen
   * laeuft. Direkte Steuerung auf ein nahes Ziel darf nur so freigegeben werden – sonst laeuft eine
   * Einheit die letzten Meter stur in eine Basiswand und bleibt dort stehen.
   */
  hasWalkableLine(fromWorldX: number, fromWorldY: number, toWorldX: number, toWorldY: number): boolean {
    const deltaX = toWorldX - fromWorldX;
    const deltaY = toWorldY - fromWorldY;
    const distance = Math.hypot(deltaX, deltaY);
    // Halbe Zellgroesse als Schrittweite: feiner als jede Zelle, damit kein Hindernis uebersprungen wird.
    const steps = Math.max(1, Math.ceil(distance / (this.metrics.cellSize * 0.5)));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const cell = this.worldToGrid(fromWorldX + deltaX * t, fromWorldY + deltaY * t);
      if (!cell || !this.isFlowPassableAt(cell.gridX, cell.gridY)) return false;
    }
    return true;
  }

  /** Prueft Mittelpunkt plus vier kardinale und vier diagonale Randpunkte eines Kreiskoerpers. */
  isCircleGroundFreeAt(worldX: number, worldY: number, radius: number): boolean {
    return this.isCircleClearAt(worldX, worldY, radius, false);
  }

  /** Prueft Kreisfreiheit und ob alle Randproben im aktuellen Flowfield erreichbar sind. */
  isCircleFlowReachableAt(worldX: number, worldY: number, radius: number): boolean {
    return this.isCircleClearAt(worldX, worldY, radius, true);
  }

  /** Semantischer Alias fuer Sonderfaelle wie Auftauchen: frei und vom Flowfield erreichbar. */
  isCirclePositionFreeAt(worldX: number, worldY: number, radius: number): boolean {
    return this.isCircleFlowReachableAt(worldX, worldY, radius);
  }

  /**
   * Prueft einen kurzen Kreis-Korridor. Die Abtastung bleibt auf maximal einer halben Rasterzelle
   * und wird nur von Sonderbewegungen verwendet, nicht von der normalen Flowfield-Steuerung.
   */
  hasWalkableCircleLine(
    fromWorldX: number,
    fromWorldY: number,
    toWorldX: number,
    toWorldY: number,
    radius: number,
    requireReachable = false,
  ): boolean {
    if (
      !Number.isFinite(fromWorldX)
      || !Number.isFinite(fromWorldY)
      || !Number.isFinite(toWorldX)
      || !Number.isFinite(toWorldY)
      || !Number.isFinite(radius)
      || radius < 0
    ) return false;
    const deltaX = toWorldX - fromWorldX;
    const deltaY = toWorldY - fromWorldY;
    const distance = Math.hypot(deltaX, deltaY);
    const steps = Math.max(1, Math.ceil(distance / (this.metrics.cellSize * 0.5)));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const sampleX = fromWorldX + deltaX * t;
      const sampleY = fromWorldY + deltaY * t;
      const clear = requireReachable
        ? this.isCircleFlowReachableAt(sampleX, sampleY, radius)
        : this.isCircleGroundFreeAt(sampleX, sampleY, radius);
      if (!clear) return false;
    }
    return true;
  }

  worldToGrid(worldX: number, worldY: number): EnemyFlowFieldGridCell | null {
    const gridX = Math.floor((worldX - this.metrics.arenaOffsetX) / this.metrics.cellSize);
    const gridY = Math.floor((worldY - this.metrics.arenaOffsetY) / this.metrics.cellSize);
    if (!this.isInBounds(gridX, gridY)) return null;
    return { gridX, gridY };
  }

  gridToWorld(gridX: number, gridY: number): { x: number; y: number } | null {
    if (!this.isInBounds(gridX, gridY)) return null;
    return {
      x: this.metrics.arenaOffsetX + gridX * this.metrics.cellSize + this.metrics.cellSize * 0.5,
      y: this.metrics.arenaOffsetY + gridY * this.metrics.cellSize + this.metrics.cellSize * 0.5,
    };
  }

  /**
   * Aktualisiert die Liste der aktiven (= noch nicht zerstörten) Basen.
   * Wird vom `BaseManager`-Destroy-Callback gerufen; der nächste Rebuild
   * berechnet Goal-Cells & Integration-Field ausschließlich über aktive Basen.
   */
  setActiveBaseIds(ids: ReadonlySet<string>): void {
    this.topologySource?.setActiveBaseIds(ids);
    const next = new Set(ids);
    if (next.size === this.activeBaseIds.size) {
      let identical = true;
      for (const id of next) {
        if (!this.activeBaseIds.has(id)) { identical = false; break; }
      }
      if (identical) return;
    }
    this.activeBaseIds = next;
    // A base can be destroyed after the regular flow-field update of the
    // current frame. Rebuilding only after the normal throttle interval
    // leaves an enemy standing on the old goal in the meantime; for bosses
    // this is especially visible because they have no separation movement to
    // nudge them out of that cell. Base changes are rare, so apply this
    // topology change immediately instead of waiting for update().
    this.fullTopologyRebuildRequired = true;
    this.isTopologyDirty = true;
    this.recomputeFields();
    this.isTopologyDirty = false;
    this.isGoalDirty = false;
  }

  rebuild(): EnemyFlowFieldService {
    return new EnemyFlowFieldService(this.layout, this.baseSpecs, this.metrics, {
      eventBus: this.eventBus ?? undefined,
      obstacleCellProvider: this.obstacleCellProvider ?? undefined,
      goalMode: this.goalMode,
      dynamicGoalCells: this.dynamicGoalCells,
      clearanceCells: this.clearanceCells,
      topologySource: this.topologySource ?? undefined,
    });
  }

  setDynamicGoalCells(cells: ReadonlyArray<EnemyFlowFieldGoalCell>): void {
    const next = this.normalizeGoalCells(cells);
    if (next.length === this.dynamicGoalCells.length) {
      let identical = true;
      for (let index = 0; index < next.length; index += 1) {
        const current = this.dynamicGoalCells[index];
        const candidate = next[index];
        if (current.gridX !== candidate.gridX || current.gridY !== candidate.gridY) {
          identical = false;
          break;
        }
      }
      if (identical) return;
    }

    this.dynamicGoalCells = next;
    this.isGoalDirty = true;
  }

  update(now: number): boolean {
    if (now - this.lastDirtyCheckAt < COOP_DEFENSE_FLOW_FIELD_REBUILD_INTERVAL_MS) {
      return false;
    }

    this.lastDirtyCheckAt = now;
    if (!this.isTopologyDirty && !this.isGoalDirty) {
      return false;
    }

    if (this.isTopologyDirty) {
      this.recomputeFields();
    } else {
      this.recomputeGoalAndVectorFields();
    }
    this.isTopologyDirty = false;
    this.isGoalDirty = false;
    return true;
  }

  destroy(): void {
    this.eventBus?.off(ARENA_MAP_GRID_CHANGED_EVENT, this.handleArenaMapGridChanged, this);
    this.debugOverlayCallback = null;
  }

  getIntegrationValueAt(gridX: number, gridY: number): number {
    if (!this.isInBounds(gridX, gridY)) return EnemyFlowFieldService.INTEGRATION_INFINITY;
    return this.integrationField[this.toIndex(gridX, gridY)];
  }

  /** Liefert die konkrete Mehrziel-Quelle hinter dem Flow-Vektor an dieser Zelle. */
  getReachedGoalCellAt(gridX: number, gridY: number): EnemyFlowFieldGoalCell | null {
    if (!this.isInBounds(gridX, gridY)) return null;
    const sourceIndex = this.goalSourceField[this.toIndex(gridX, gridY)];
    if (sourceIndex < 0) return null;
    return {
      gridX: sourceIndex % this.metrics.cols,
      gridY: Math.floor(sourceIndex / this.metrics.cols),
    };

  }

  /**
   * Zielgebundener Einzelpfad auf demselben Kostenraster. Er erzeugt kein weiteres Flow Field und
   * wird nur fuer seltene feste Jagdzustaende verwendet; normale Gegner bleiben im Mehrzielfeld.
   */
  findNextWorldPositionTowards(
    fromGridX: number,
    fromGridY: number,
    targetGridX: number,
    targetGridY: number,
  ): { x: number; y: number } | null {
    if (!this.isFlowPassableAt(fromGridX, fromGridY)) return null;
    const target = this.findNearestPassableCell(targetGridX, targetGridY, 3);
    if (!target) return null;
    const startIndex = this.toIndex(fromGridX, fromGridY);
    const targetIndex = this.toIndex(target.gridX, target.gridY);
    if (startIndex === targetIndex) return this.gridToWorld(target.gridX, target.gridY);

    const generation = this.beginTargetPathSearch(startIndex);
    while (this.targetPathOpen.size > 0) {
      this.targetPathOpen.pop();
      const currentIndex = this.targetPathOpen.poppedIndex;
      const currentCost = this.targetPathCosts[currentIndex];
      const currentX = currentIndex % this.metrics.cols;
      const currentY = Math.floor(currentIndex / this.metrics.cols);
      const currentScore = currentCost + Math.hypot(target.gridX - currentX, target.gridY - currentY);
      // Der Heap erlaubt bewusst doppelte Eintraege: veraltete Prioritaeten werden hier billig
      // verworfen, statt das Open Set linear nach dem Zellindex zu durchsuchen.
      if (this.targetPathOpen.poppedPriority > currentScore) continue;
      if (currentIndex === targetIndex) break;

      const neighborBase = currentIndex * 8;
      for (let direction = 0; direction < 8; direction += 1) {
        if (!this.isReachableNeighborIndex(currentIndex, direction)) continue;
        const nextIndex = this.neighborIndices[neighborBase + direction];
        const previousCost = this.targetPathGeneration[nextIndex] === generation
          ? this.targetPathCosts[nextIndex]
          : EnemyFlowFieldService.INTEGRATION_INFINITY;
        const candidate = currentCost + this.costs[nextIndex] * NEIGHBOR_MOVE_FACTORS[direction];
        if (candidate >= previousCost) continue;
        this.targetPathGeneration[nextIndex] = generation;
        this.targetPathCosts[nextIndex] = candidate;
        this.targetPathParents[nextIndex] = currentIndex;
        const nextX = nextIndex % this.metrics.cols;
        const nextY = Math.floor(nextIndex / this.metrics.cols);
        this.targetPathOpen.push(
          nextIndex,
          candidate + Math.hypot(target.gridX - nextX, target.gridY - nextY),
          this.targetPathSequence++,
        );
      }
    }

    if (
      this.targetPathGeneration[targetIndex] !== generation
      || this.targetPathParents[targetIndex] < 0
    ) {
      this.targetPathOpen.clear();
      return null;
    }
    let stepIndex = targetIndex;
    while (
      this.targetPathParents[stepIndex] >= 0
      && this.targetPathParents[stepIndex] !== startIndex
    ) {
      stepIndex = this.targetPathParents[stepIndex];
    }
    this.targetPathOpen.clear();
    return this.gridToWorld(stepIndex % this.metrics.cols, Math.floor(stepIndex / this.metrics.cols));
  }

  getVectorAt(gridX: number, gridY: number): EnemyFlowFieldVector {
    if (!this.isInBounds(gridX, gridY)) return { x: 0, y: 0 };
    const index = this.toIndex(gridX, gridY);
    const vIndex = index * 2;
    return {
      x: this.vectorField[vIndex],
      y: this.vectorField[vIndex + 1],
    };
  }

  /**
   * Liefert den Mittelpunkt der naechsten Flow-Field-Zelle. Groessere Gegner
   * steuern damit gezielt durch den sicheren Korridor, statt eine grobe
   * Zellrichtung beizubehalten, wenn sie innerhalb der Zelle versetzt sind.
   */
  getNextCellWorldPosition(gridX: number, gridY: number): { x: number; y: number } | null {
    const vector = this.getVectorAt(gridX, gridY);
    const stepX = Math.sign(vector.x);
    const stepY = Math.sign(vector.y);
    if (stepX === 0 && stepY === 0) return null;
    return this.gridToWorld(gridX + stepX, gridY + stepY);
  }

  /**
   * Sucht von einer ungueltigen/abgedraengten Zelle aus den naechsten
   * erreichbaren Korridorpunkt. Das ist insbesondere nach Rueckstoss oder
   * Kollisionsaufloesung wichtig: Ohne Recovery bleibt ein grosser Gegner in
   * einer durch den Clearance-Mask gesperrten Randzelle dauerhaft stehen.
   */
  findNearestReachableWorldPosition(
    gridX: number,
    gridY: number,
    maxRadiusCells = 3,
  ): { x: number; y: number } | null {
    const radius = Math.max(1, Math.floor(maxRadiusCells));
    let best: { x: number; y: number; distanceSq: number; integration: number } | null = null;

    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        const candidateX = gridX + offsetX;
        const candidateY = gridY + offsetY;
        if (!this.isFlowPassableAt(candidateX, candidateY)) continue;

        const integration = this.getIntegrationValueAt(candidateX, candidateY);
        if (integration >= EnemyFlowFieldService.INTEGRATION_INFINITY) continue;

        const distanceSq = offsetX * offsetX + offsetY * offsetY;
        if (
          best
          && (distanceSq > best.distanceSq
            || (distanceSq === best.distanceSq && integration >= best.integration))
        ) {
          continue;
        }

        const world = this.gridToWorld(candidateX, candidateY);
        if (!world) continue;
        best = { ...world, distanceSq, integration };
      }
    }

    return best ? { x: best.x, y: best.y } : null;
  }

  /** Sucht innerhalb eines festen Zellradius einen koerperlich freien, erreichbaren Mittelpunkt. */
  findNearestSafeWorldPosition(
    worldX: number,
    worldY: number,
    radius: number,
    maxRadiusCells = 4,
  ): { x: number; y: number } | null {
    const origin = this.worldToGrid(worldX, worldY);
    if (!origin || !Number.isFinite(radius) || radius < 0) return null;
    if (this.isCirclePositionFreeAt(worldX, worldY, radius)) return { x: worldX, y: worldY };

    const searchRadius = Math.min(
      MAX_SAFE_POSITION_SEARCH_RADIUS_CELLS,
      Math.max(1, Math.floor(maxRadiusCells)),
    );
    let best: { x: number; y: number; distanceSq: number; integration: number } | null = null;
    for (let offsetY = -searchRadius; offsetY <= searchRadius; offsetY += 1) {
      for (let offsetX = -searchRadius; offsetX <= searchRadius; offsetX += 1) {
        const candidateX = origin.gridX + offsetX;
        const candidateY = origin.gridY + offsetY;
        const world = this.gridToWorld(candidateX, candidateY);
        if (!world || !this.isCirclePositionFreeAt(world.x, world.y, radius)) continue;

        const distanceSq = offsetX * offsetX + offsetY * offsetY;
        const integration = this.getIntegrationValueAt(candidateX, candidateY);
        if (
          best
          && (distanceSq > best.distanceSq
            || (distanceSq === best.distanceSq && integration >= best.integration))
        ) {
          continue;
        }
        best = { x: world.x, y: world.y, distanceSq, integration };
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  registerDebugOverlayCallback(
    callback: ((renderer: EnemyFlowFieldDebugRenderer) => void) | null,
  ): void {
    this.debugOverlayCallback = callback;
    if (callback) {
      const renderer = new EnemyFlowFieldDebugRendererImpl(this);
      callback(renderer);
    }
  }

  private handleArenaMapGridChanged(event: ArenaMapGridChangedEvent): void {
    this.isTopologyDirty = true;
    this.isGoalDirty = true;
    if (this.topologySource) return;
    if (
      this.clearanceCells === 0
      && event.gridX !== undefined
      && event.gridY !== undefined
      && this.isInBounds(event.gridX, event.gridY)
    ) {
      this.pendingTopologyCells.add(this.toIndex(event.gridX, event.gridY));
      return;
    }
    this.fullTopologyRebuildRequired = true;
  }

  private recomputeFields(): void {
    this.refreshTopology();
    this.recomputeGoalAndVectorFields();
  }

  private refreshTopology(): void {
    if (this.topologySource) {
      this.topologySource.refreshTopologyIfDirty();
      this.copyTopologySummary(this.topologySource);
    } else if (!this.fullTopologyRebuildRequired && this.pendingTopologyCells.size > 0) {
      this.recomputeTopologyCells(this.pendingTopologyCells);
    } else {
      this.recomputeTopology();
    }
    this.pendingTopologyCells.clear();
    this.fullTopologyRebuildRequired = false;
    this.isTopologyDirty = false;
  }

  private refreshTopologyIfDirty(): void {
    if (!this.isTopologyDirty) return;
    this.refreshTopology();
    this.isGoalDirty = true;
  }

  private recomputeTopology(): void {
    if (this.topologySource) {
      this.topologySource.refreshTopologyIfDirty();
      this.copyTopologySummary(this.topologySource);
      return;
    }
    const activeSpecs = this.baseSpecs.filter((spec) => this.activeBaseIds.has(spec.id));
    const buildContext = this.createBuildContext(this.layout, activeSpecs);
    const countsByKind = this.createEmptyCounts();

    let traversableCells = 0;
    for (let gridY = 0; gridY < this.metrics.rows; gridY++) {
      for (let gridX = 0; gridX < this.metrics.cols; gridX++) {
        const index = this.toIndex(gridX, gridY);
        const kind = this.resolveKind(index, buildContext);
        const definition = CELL_DEFINITIONS[kind];

        this.costs[index] = definition.cost;
        this.kindCodes[index] = definition.code;
        this.traversable[index] = definition.isTraversable ? 1 : 0;
        this.destructible[index] = definition.isDestructible ? 1 : 0;
        countsByKind[kind] += 1;
        if (definition.isTraversable) traversableCells += 1;
      }
    }

    if (this.clearanceCells > 0) {
      traversableCells = this.applyClearanceMask();
    }

    this.applyWallAdjacencySurcharge();

    this.summary.traversableCells = traversableCells;
    this.summary.blockedCells = this.summary.totalCells - traversableCells;
    this.summary.countsByKind = countsByKind;
  }

  private copyTopologySummary(source: EnemyFlowFieldService): void {
    this.summary.traversableCells = source.summary.traversableCells;
    this.summary.blockedCells = source.summary.blockedCells;
    this.summary.countsByKind = { ...source.summary.countsByKind };
  }

  /** Aktualisiert bei einem Fels-/Bauplatzereignis nur die betroffene Zelle und Nachbarschaft. */
  private recomputeTopologyCells(indexes: ReadonlySet<number>): void {
    const activeSpecs = this.baseSpecs.filter((spec) => this.activeBaseIds.has(spec.id));
    const buildContext = this.createBuildContext(this.layout, activeSpecs);
    const adjacencyCandidates = new Set<number>();
    for (const index of indexes) {
      const oldKind = CELL_KINDS_BY_CODE[this.kindCodes[index]];
      const nextKind = this.resolveKind(index, buildContext);
      if (oldKind !== nextKind) {
        const definition = CELL_DEFINITIONS[nextKind];
        this.summary.countsByKind[oldKind] -= 1;
        this.summary.countsByKind[nextKind] += 1;
        const wasTraversable = this.traversable[index] === 1;
        this.kindCodes[index] = definition.code;
        this.traversable[index] = definition.isTraversable ? 1 : 0;
        this.destructible[index] = definition.isDestructible ? 1 : 0;
        if (wasTraversable !== definition.isTraversable) {
          this.summary.traversableCells += definition.isTraversable ? 1 : -1;
        }
      }
      adjacencyCandidates.add(index);
      const neighborBase = index * 8;
      for (let direction = 0; direction < 8; direction += 1) {
        const neighborIndex = this.neighborIndices[neighborBase + direction];
        if (neighborIndex >= 0) adjacencyCandidates.add(neighborIndex);
      }
    }
    for (const index of adjacencyCandidates) this.refreshWallAdjacencyAt(index);
    this.summary.blockedCells = this.summary.totalCells - this.summary.traversableCells;
  }

  private recomputeGoalAndVectorFields(): void {
    if (this.goalMode !== 'bases') {
      this.dynamicGoalCells = this.normalizeGoalCells(this.dynamicGoalCells);
    }

    this.goalMask.fill(0);
    this.goalCells.length = 0;
    this.goalCells.push(...this.computeGoalCells());
    for (const goalCell of this.goalCells) {
      this.goalMask[this.toIndex(goalCell.gridX, goalCell.gridY)] = 1;
    }

    this.computeIntegrationField();
    this.computeVectorField();

    this.summary.goalCells = this.goalCells.length;

    if (this.debugOverlayCallback) {
      this.debugOverlayCallback(new EnemyFlowFieldDebugRendererImpl(this));
    }
  }

  private createBuildContext(
    layout: ArenaLayout,
    baseSpecs: readonly BaseSpec[],
  ): EnemyFlowFieldBuildContext {
    return {
      dirtCells: this.buildLookup(layout.dirt.map((cell) => ({ gridX: cell.gridX, gridY: cell.gridY }))),
      rockCells: this.buildLookup(this.getCurrentObstacleCells(layout)),
      trunkCells: this.buildLookup(layout.trees.map((cell) => ({ gridX: cell.gridX, gridY: cell.gridY }))),
      trackCells: this.buildTrackLookup(layout.tracks),
      pedestalCells: this.buildPedestalLookup(layout.powerUpPedestals),
      baseCells: this.buildBaseLookup(baseSpecs),
    };
  }

  private getCurrentObstacleCells(layout: ArenaLayout): ReadonlyArray<EnemyFlowFieldGridCell> {
    if (this.obstacleCellProvider) {
      return this.obstacleCellProvider();
    }
    return layout.rocks.map((cell) => ({ gridX: cell.gridX, gridY: cell.gridY }));
  }

  private buildLookup(cells: ReadonlyArray<{ gridX: number; gridY: number }>): SourceCellLookup {
    const lookup = new Set<number>();
    for (const cell of cells) {
      if (!this.isInBounds(cell.gridX, cell.gridY)) continue;
      lookup.add(this.toIndex(cell.gridX, cell.gridY));
    }
    return lookup;
  }

  private buildTrackLookup(tracks: ArenaLayout['tracks']): SourceCellLookup {
    const lookup = new Set<number>();
    for (const track of tracks) {
      if (this.isInBounds(track.gridX, track.gridY)) {
        lookup.add(this.toIndex(track.gridX, track.gridY));
      }
      const adjacentGridX = track.gridX + 1;
      if (this.isInBounds(adjacentGridX, track.gridY)) {
        lookup.add(this.toIndex(adjacentGridX, track.gridY));
      }
    }
    return lookup;
  }

  private buildPedestalLookup(pedestals: readonly PowerUpPedestalCell[]): SourceCellLookup {
    return this.buildLookup(pedestals.map((cell) => ({ gridX: cell.gridX, gridY: cell.gridY })));
  }

  private buildBaseLookup(baseSpecs: readonly BaseSpec[]): SourceCellLookup {
    const lookup = new Set<number>();
    for (const baseSpec of baseSpecs) {
      for (const cell of baseSpec.cells) {
        if (!this.isInBounds(cell.gridX, cell.gridY)) continue;
        lookup.add(this.toIndex(cell.gridX, cell.gridY));
      }
    }
    return lookup;
  }

  private createEmptyCounts(): Record<EnemyFlowFieldCellKind, number> {
    return {
      ground: 0,
      rock: 0,
      trunk: 0,
      dirt: 0,
      track: 0,
      pedestal: 0,
      base: 0,
      outOfBounds: 0,
    };
  }

  private resolveKind(cellKey: number, context: EnemyFlowFieldBuildContext): EnemyFlowFieldCellKind {
    for (const rule of CELL_RULES) {
      if (rule.matches(cellKey, context)) return rule.kind;
    }
    return 'ground';
  }

  private computeGoalCells(): EnemyFlowFieldGoalCell[] {
    if (this.goalMode === 'dynamic') return [...this.dynamicGoalCells];
    if (this.goalMode === 'dynamic-fallback-bases' && this.dynamicGoalCells.length > 0) {
      return [...this.dynamicGoalCells];
    }

    return this.computeBaseGoalCells();
  }

  private computeBaseGoalCells(): EnemyFlowFieldGoalCell[] {
    const goalSet = new Set<number>();
    const directions: ReadonlyArray<readonly [number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    const goalDistance = this.clearanceCells + 1;
    for (const baseSpec of this.baseSpecs) {
      if (!this.activeBaseIds.has(baseSpec.id)) continue;
      // Nur die Ziele werden gefiltert: feindliche Basiszellen bleiben Hindernisse und muessen
      // deshalb weiterhin im Kostenfeld (`buildBaseLookup`) stehen.
      if (baseSpec.faction === 'hostile' || baseSpec.role === 'spawn-point') continue;
      // Ein objective-gebundener Vorposten (Hold-Missionsziel) ist ein vollwertiges Belagerungsziel:
      // Das Mehrzielfeld startet an allen Zielzellen gleichzeitig, deshalb laeuft jeder Gegner
      // automatisch zur pfadnaechsten Struktur statt am naeher liegenden Missionsziel vorbei zur
      // Hauptbasis. Dekorative Vorposten ohne Objective bleiben ausgenommen, damit sie den Zug der
      // Angriffswellen auf die Hauptbasis nicht verwaessern.
      if (baseSpec.role === 'outpost' && baseSpec.dormantObjectiveId === undefined) continue;
      for (const cell of baseSpec.cells) {
        for (const [dx, dy] of directions) {
          const neighborX = cell.gridX + dx * goalDistance;
          const neighborY = cell.gridY + dy * goalDistance;
          if (!this.isGoalCandidateAt(neighborX, neighborY)) continue;
          goalSet.add(this.toIndex(neighborX, neighborY));
        }
      }
    }

    return [...goalSet]
      .sort((left, right) => left - right)
      .map((index) => ({
        gridX: index % this.metrics.cols,
        gridY: Math.floor(index / this.metrics.cols),
      }));
  }

  private normalizeGoalCells(cells: ReadonlyArray<EnemyFlowFieldGoalCell>): EnemyFlowFieldGoalCell[] {
    const uniqueGoalIndexes = new Set<number>();
    for (const cell of cells) {
      if (!this.isGoalCandidateAt(cell.gridX, cell.gridY)) continue;
      uniqueGoalIndexes.add(this.toIndex(cell.gridX, cell.gridY));
    }

    return [...uniqueGoalIndexes]
      .sort((left, right) => left - right)
      .map((index) => ({
        gridX: index % this.metrics.cols,
        gridY: Math.floor(index / this.metrics.cols),
      }));
  }

  private isInBounds(gridX: number, gridY: number): boolean {
    return gridX >= 0
      && gridX < this.metrics.cols
      && gridY >= 0
      && gridY < this.metrics.rows;
  }

  private toIndex(gridX: number, gridY: number): number {
    return gridY * this.metrics.cols + gridX;
  }

  private buildNeighborLookups(): void {
    this.neighborIndices.fill(-1);
    this.diagonalGuardA.fill(-1);
    this.diagonalGuardB.fill(-1);
    for (let gridY = 0; gridY < this.metrics.rows; gridY += 1) {
      for (let gridX = 0; gridX < this.metrics.cols; gridX += 1) {
        const index = this.toIndex(gridX, gridY);
        const base = index * 8;
        for (let direction = 0; direction < 8; direction += 1) {
          const [dx, dy] = EnemyFlowFieldService.NEIGHBOR_DIRECTIONS[direction];
          const neighborX = gridX + dx;
          const neighborY = gridY + dy;
          if (!this.isInBounds(neighborX, neighborY)) continue;
          this.neighborIndices[base + direction] = this.toIndex(neighborX, neighborY);
          if (direction < 4) continue;
          this.diagonalGuardA[base + direction] = this.toIndex(gridX + dx, gridY);
          this.diagonalGuardB[base + direction] = this.toIndex(gridX, gridY + dy);
        }
      }
    }
  }

  private isReachableNeighborIndex(currentIndex: number, direction: number): boolean {
    const lookupIndex = currentIndex * 8 + direction;
    const neighborIndex = this.neighborIndices[lookupIndex];
    if (neighborIndex < 0 || this.traversable[neighborIndex] !== 1) return false;
    if (direction < 4) return true;
    const guardA = this.diagonalGuardA[lookupIndex];
    const guardB = this.diagonalGuardB[lookupIndex];
    return guardA >= 0
      && guardB >= 0
      && this.traversable[guardA] === 1
      && this.traversable[guardB] === 1;
  }

  private isFlowPassableAt(gridX: number, gridY: number): boolean {
    if (!this.isInBounds(gridX, gridY)) return false;
    return this.traversable[this.toIndex(gridX, gridY)] === 1;
  }

  private isCircleClearAt(worldX: number, worldY: number, radius: number, requireReachable: boolean): boolean {
    if (!Number.isFinite(radius) || radius < 0) return false;
    const diagonal = radius * Math.SQRT1_2;
    return this.isCircleSampleClearAt(worldX, worldY, requireReachable)
      && this.isCircleSampleClearAt(worldX + radius, worldY, requireReachable)
      && this.isCircleSampleClearAt(worldX - radius, worldY, requireReachable)
      && this.isCircleSampleClearAt(worldX, worldY + radius, requireReachable)
      && this.isCircleSampleClearAt(worldX, worldY - radius, requireReachable)
      && this.isCircleSampleClearAt(worldX + diagonal, worldY + diagonal, requireReachable)
      && this.isCircleSampleClearAt(worldX - diagonal, worldY - diagonal, requireReachable)
      && this.isCircleSampleClearAt(worldX + diagonal, worldY - diagonal, requireReachable)
      && this.isCircleSampleClearAt(worldX - diagonal, worldY + diagonal, requireReachable);
  }

  private isCircleSampleClearAt(worldX: number, worldY: number, requireReachable: boolean): boolean {
    const gridX = Math.floor((worldX - this.metrics.arenaOffsetX) / this.metrics.cellSize);
    const gridY = Math.floor((worldY - this.metrics.arenaOffsetY) / this.metrics.cellSize);
    if (!this.isInBounds(gridX, gridY)) return false;
    const index = this.toIndex(gridX, gridY);
    if (this.traversable[index] !== 1) return false;
    return !requireReachable || this.integrationField[index] < EnemyFlowFieldService.INTEGRATION_INFINITY;
  }

  private findNearestPassableCell(
    gridX: number,
    gridY: number,
    maxRadiusCells: number,
  ): EnemyFlowFieldGridCell | null {
    let best: { gridX: number; gridY: number; distanceSq: number } | null = null;
    for (let offsetY = -maxRadiusCells; offsetY <= maxRadiusCells; offsetY += 1) {
      for (let offsetX = -maxRadiusCells; offsetX <= maxRadiusCells; offsetX += 1) {
        const candidateX = gridX + offsetX;
        const candidateY = gridY + offsetY;
        if (!this.isFlowPassableAt(candidateX, candidateY)) continue;
        const distanceSq = offsetX * offsetX + offsetY * offsetY;
        if (best && distanceSq >= best.distanceSq) continue;
        best = { gridX: candidateX, gridY: candidateY, distanceSq };
      }
    }
    return best ? { gridX: best.gridX, gridY: best.gridY } : null;
  }

  private applyClearanceMask(): number {
    const source = this.traversable.slice();
    let traversableCells = 0;

    for (let gridY = 0; gridY < this.metrics.rows; gridY += 1) {
      for (let gridX = 0; gridX < this.metrics.cols; gridX += 1) {
        const index = this.toIndex(gridX, gridY);
        if (source[index] !== 1) {
          this.traversable[index] = 0;
          continue;
        }

        let hasClearance = true;
        for (let offsetY = -this.clearanceCells; offsetY <= this.clearanceCells && hasClearance; offsetY += 1) {
          for (let offsetX = -this.clearanceCells; offsetX <= this.clearanceCells; offsetX += 1) {
            const neighborX = gridX + offsetX;
            const neighborY = gridY + offsetY;
            if (!this.isInBounds(neighborX, neighborY) || source[this.toIndex(neighborX, neighborY)] !== 1) {
              hasClearance = false;
              break;
            }
          }
        }

        this.traversable[index] = hasClearance ? 1 : 0;
        if (hasClearance) traversableCells += 1;
      }
    }

    return traversableCells;
  }

  /**
   * Markiert begehbare Zellen neben unzerstoerbaren Hindernissen und verteuert sie.
   *
   * Das Feld plant auf Zellmittelpunkten, normale Koerper sind dabei hoechstens 30 px breit bei
   * 32 px Zellgroesse. Eine Route direkt an einer Basiswand laesst den Koerper deshalb dauerhaft in der
   * Wand stecken: Die Kollisionsaufloesung schiebt ihn jeden Frame zurueck, waehrend der
   * Richtungsvektor weiter an der Wand entlang zeigt. Der Aufschlag ist absichtlich klein – enge
   * Korridore bleiben passierbar, offene Wege biegen sich aber um eine Zelle von der Wand weg.
   * Bosse verwenden weiterhin ihr eigenes Clearance-Profil.
   *
   * Felsen bleiben ausgenommen: Sie sind zerstoerbar, und das Anrempeln ist dort der gewollte
   * Ausloeser fuer {@link CoopDefenseEnemyAttackSystem}s Hindernis-Biss.
   */
  private applyWallAdjacencySurcharge(): void {
    this.wallAdjacent.fill(0);
    if (COOP_DEFENSE_FLOW_FIELD_WALL_ADJACENT_COST <= 0) return;

    for (let gridY = 0; gridY < this.metrics.rows; gridY += 1) {
      for (let gridX = 0; gridX < this.metrics.cols; gridX += 1) {
        const index = this.toIndex(gridX, gridY);
        if (this.traversable[index] !== 1) continue;
        if (!this.hasIndestructibleBlockerNeighbor(gridX, gridY)) continue;
        this.wallAdjacent[index] = 1;
        this.costs[index] += COOP_DEFENSE_FLOW_FIELD_WALL_ADJACENT_COST;
      }
    }
  }

  private refreshWallAdjacencyAt(index: number): void {
    const kind = CELL_KINDS_BY_CODE[this.kindCodes[index]];
    this.costs[index] = CELL_DEFINITIONS[kind].cost;
    this.wallAdjacent[index] = 0;
    if (
      COOP_DEFENSE_FLOW_FIELD_WALL_ADJACENT_COST <= 0
      || this.traversable[index] !== 1
    ) return;
    const gridX = index % this.metrics.cols;
    const gridY = Math.floor(index / this.metrics.cols);
    if (!this.hasIndestructibleBlockerNeighbor(gridX, gridY)) return;
    this.wallAdjacent[index] = 1;
    this.costs[index] += COOP_DEFENSE_FLOW_FIELD_WALL_ADJACENT_COST;
  }

  private hasIndestructibleBlockerNeighbor(gridX: number, gridY: number): boolean {
    for (const [dx, dy] of EnemyFlowFieldService.NEIGHBOR_DIRECTIONS) {
      const neighborX = gridX + dx;
      const neighborY = gridY + dy;
      // Der Arenarand zaehlt nicht mit: Sonst waere jede Randspur teuer, obwohl dort weder
      // Basiswaende noch Baumstuempfe stehen und Gegner regulaer am Rand einbuddeln.
      if (!this.isInBounds(neighborX, neighborY)) continue;
      // Bewusst ueber die Zellart statt ueber `traversable`: Der Clearance-Mask sperrt zusaetzliche
      // Bodenzellen, die keine echten Waende sind und deshalb keinen Aufschlag ausloesen duerfen.
      if (WALL_KIND_CODES.has(this.kindCodes[this.toIndex(neighborX, neighborY)])) return true;
    }
    return false;
  }

  private isGoalCandidateAt(gridX: number, gridY: number): boolean {
    if (!this.isFlowPassableAt(gridX, gridY)) return false;
    return this.kindCodes[this.toIndex(gridX, gridY)] !== CELL_DEFINITIONS.base.code;
  }

  private beginTargetPathSearch(startIndex: number): number {
    this.targetPathOpen.clear();
    let generation = (this.targetPathGenerationId + 1) >>> 0;
    if (generation === 0) {
      this.targetPathGeneration.fill(0);
      generation = 1;
    }
    this.targetPathGenerationId = generation;
    this.targetPathSequence = 0;
    this.targetPathGeneration[startIndex] = generation;
    this.targetPathCosts[startIndex] = 0;
    this.targetPathParents[startIndex] = -1;
    this.targetPathOpen.push(startIndex, 0, this.targetPathSequence++);
    return generation;
  }

  private computeIntegrationField(): void {
    this.integrationField.fill(EnemyFlowFieldService.INTEGRATION_INFINITY);
    this.goalSourceField.fill(-1);

    const open = new FlowFieldMinHeap();
    for (const goalCell of this.goalCells) {
      const index = this.toIndex(goalCell.gridX, goalCell.gridY);
      this.integrationField[index] = 0;
      this.goalSourceField[index] = index;
      open.push(index, 0, index);
    }

    while (open.size > 0) {
      open.pop();
      const currentIndex = open.poppedIndex;
      const currentValue = open.poppedPriority;
      const sourceIndex = open.poppedSource;
      // Eine Zelle darf mehrfach im Heap liegen. Veraltete Eintraege kosten nur diesen Test.
      if (
        currentValue !== this.integrationField[currentIndex]
        || sourceIndex !== this.goalSourceField[currentIndex]
      ) continue;

      const neighborBase = currentIndex * 8;
      for (let direction = 0; direction < 8; direction += 1) {
        if (!this.isReachableNeighborIndex(currentIndex, direction)) continue;
        const neighborIndex = this.neighborIndices[neighborBase + direction];
        const neighborCost = this.costs[neighborIndex];
        const newValue = Math.fround(currentValue + neighborCost * NEIGHBOR_MOVE_FACTORS[direction]);

        if (
          newValue < this.integrationField[neighborIndex]
          || (newValue === this.integrationField[neighborIndex]
            && sourceIndex >= 0
            && (this.goalSourceField[neighborIndex] < 0 || sourceIndex < this.goalSourceField[neighborIndex]))
        ) {
          this.integrationField[neighborIndex] = newValue;
          this.goalSourceField[neighborIndex] = sourceIndex;
          open.push(neighborIndex, newValue, sourceIndex);
        }
      }
    }
  }

  private computeVectorField(): void {
    for (let gridY = 0; gridY < this.metrics.rows; gridY++) {
      for (let gridX = 0; gridX < this.metrics.cols; gridX++) {
        const index = this.toIndex(gridX, gridY);
        const vIndex = index * 2;

        if (!this.isFlowPassableAt(gridX, gridY)) {
          this.vectorField[vIndex] = 0;
          this.vectorField[vIndex + 1] = 0;
          continue;
        }

        let bestDirection = -1;
        let bestValue = this.integrationField[index];

        const neighborBase = index * 8;
        for (let direction = 0; direction < 8; direction += 1) {
          if (!this.isReachableNeighborIndex(index, direction)) continue;
          const neighborValue = this.integrationField[this.neighborIndices[neighborBase + direction]];
          if (neighborValue < bestValue) {
            bestValue = neighborValue;
            bestDirection = direction;
          }
        }

        if (bestDirection >= 0) {
          const [dirX, dirY] = EnemyFlowFieldService.NEIGHBOR_DIRECTIONS[bestDirection];
          const invLength = bestDirection < 4 ? 1 : Math.SQRT1_2;
          this.vectorField[vIndex] = dirX * invLength;
          this.vectorField[vIndex + 1] = dirY * invLength;
        } else {
          this.vectorField[vIndex] = 0;
          this.vectorField[vIndex + 1] = 0;
        }
      }
    }
  }
}

export interface EnemyFlowFieldDebugRenderer {
  getService(): EnemyFlowFieldService;
}

export class EnemyFlowFieldDebugRendererImpl implements EnemyFlowFieldDebugRenderer {
  constructor(private readonly service: EnemyFlowFieldService) {}

  getService(): EnemyFlowFieldService {
    return this.service;
  }
}
