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
}

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
  private debugOverlayCallback: ((renderer: EnemyFlowFieldDebugRenderer) => void) | null = null;
  private isGridDirty = false;
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
    this.costs = new Uint32Array(totalCells);
    this.kindCodes = new Uint8Array(totalCells);
    this.traversable = new Uint8Array(totalCells);
    this.destructible = new Uint8Array(totalCells);
    this.wallAdjacent = new Uint8Array(totalCells);
    this.goalMask = new Uint8Array(totalCells);
    this.integrationField = new Float32Array(totalCells);
    this.vectorField = new Float32Array(totalCells * 2);
    this.goalSourceField = new Int32Array(totalCells);
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

    this.recomputeFields();
    if (initialDynamicGoalCells.length > 0) {
      this.dynamicGoalCells = this.normalizeGoalCells(initialDynamicGoalCells);
      this.recomputeFields();
    }
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
    this.recomputeFields();
    this.isGridDirty = false;
  }

  rebuild(): EnemyFlowFieldService {
    return new EnemyFlowFieldService(this.layout, this.baseSpecs, this.metrics, {
      eventBus: this.eventBus ?? undefined,
      obstacleCellProvider: this.obstacleCellProvider ?? undefined,
      goalMode: this.goalMode,
      dynamicGoalCells: this.dynamicGoalCells,
      clearanceCells: this.clearanceCells,
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
    this.isGridDirty = true;
  }

  update(now: number): boolean {
    if (now - this.lastDirtyCheckAt < COOP_DEFENSE_FLOW_FIELD_REBUILD_INTERVAL_MS) {
      return false;
    }

    this.lastDirtyCheckAt = now;
    if (!this.isGridDirty) {
      return false;
    }

    this.recomputeFields();
    this.isGridDirty = false;
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

    const totalCells = this.metrics.cols * this.metrics.rows;
    const costs = new Float32Array(totalCells);
    costs.fill(EnemyFlowFieldService.INTEGRATION_INFINITY);
    const parents = new Int32Array(totalCells);
    parents.fill(-1);
    const open: number[] = [startIndex];
    costs[startIndex] = 0;

    while (open.length > 0) {
      let bestOpenIndex = 0;
      let bestScore = Number.POSITIVE_INFINITY;
      for (let index = 0; index < open.length; index += 1) {
        const cellIndex = open[index];
        const gx = cellIndex % this.metrics.cols;
        const gy = Math.floor(cellIndex / this.metrics.cols);
        const score = costs[cellIndex] + Math.hypot(target.gridX - gx, target.gridY - gy);
        if (score < bestScore) {
          bestScore = score;
          bestOpenIndex = index;
        }
      }
      const currentIndex = open.splice(bestOpenIndex, 1)[0];
      if (currentIndex === targetIndex) break;
      const currentX = currentIndex % this.metrics.cols;
      const currentY = Math.floor(currentIndex / this.metrics.cols);
      for (const [dx, dy] of EnemyFlowFieldService.NEIGHBOR_DIRECTIONS) {
        const nextX = currentX + dx;
        const nextY = currentY + dy;
        if (!this.isReachableNeighbor(currentX, currentY, nextX, nextY)) continue;
        const nextIndex = this.toIndex(nextX, nextY);
        const stepCost = this.costs[nextIndex] * (Math.abs(dx) + Math.abs(dy) === 2 ? Math.SQRT2 : 1);
        const candidate = costs[currentIndex] + stepCost;
        if (candidate >= costs[nextIndex]) continue;
        costs[nextIndex] = candidate;
        parents[nextIndex] = currentIndex;
        if (!open.includes(nextIndex)) open.push(nextIndex);
      }
    }

    if (parents[targetIndex] < 0) return null;
    let stepIndex = targetIndex;
    while (parents[stepIndex] >= 0 && parents[stepIndex] !== startIndex) stepIndex = parents[stepIndex];
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

  registerDebugOverlayCallback(
    callback: ((renderer: EnemyFlowFieldDebugRenderer) => void) | null,
  ): void {
    this.debugOverlayCallback = callback;
    if (callback) {
      const renderer = new EnemyFlowFieldDebugRendererImpl(this);
      callback(renderer);
    }
  }

  private handleArenaMapGridChanged(_event: ArenaMapGridChangedEvent): void {
    this.isGridDirty = true;
  }

  private recomputeFields(): void {
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

    this.goalMask.fill(0);
    this.goalCells.length = 0;
    this.goalCells.push(...this.computeGoalCells());
    for (const goalCell of this.goalCells) {
      this.goalMask[this.toIndex(goalCell.gridX, goalCell.gridY)] = 1;
    }

    this.computeIntegrationField();
    this.computeVectorField();

    this.summary.traversableCells = traversableCells;
    this.summary.blockedCells = this.summary.totalCells - traversableCells;
    this.summary.goalCells = this.goalCells.length;
    this.summary.countsByKind = countsByKind;

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
      if (baseSpec.faction === 'hostile' || baseSpec.role === 'outpost' || baseSpec.role === 'spawn-point') continue;
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

  private isFlowPassableAt(gridX: number, gridY: number): boolean {
    if (!this.isInBounds(gridX, gridY)) return false;
    return this.traversable[this.toIndex(gridX, gridY)] === 1;
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
   * Das Feld plant auf Zellmittelpunkten, die Koerper sind aber bis zu 68 px breit bei 32 px
   * Zellgroesse. Eine Route direkt an einer Basiswand laesst den Koerper deshalb dauerhaft in der
   * Wand stecken: Die Kollisionsaufloesung schiebt ihn jeden Frame zurueck, waehrend der
   * Richtungsvektor weiter an der Wand entlang zeigt. Der Aufschlag ist absichtlich klein – enge
   * Korridore bleiben passierbar, offene Wege biegen sich aber um eine Zelle von der Wand weg.
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

  private isReachableNeighbor(
    fromGridX: number,
    fromGridY: number,
    neighborGridX: number,
    neighborGridY: number,
  ): boolean {
    if (!this.isInBounds(neighborGridX, neighborGridY)) return false;
    if (!this.isFlowPassableAt(neighborGridX, neighborGridY)) return false;

    const deltaX = neighborGridX - fromGridX;
    const deltaY = neighborGridY - fromGridY;
    const isDiagonalMove = Math.abs(deltaX) === 1 && Math.abs(deltaY) === 1;

    if (!isDiagonalMove) {
      return true;
    }

    const horizontalNeighborX = fromGridX + deltaX;
    const horizontalNeighborY = fromGridY;
    const verticalNeighborX = fromGridX;
    const verticalNeighborY = fromGridY + deltaY;

    return this.isTraversableAt(horizontalNeighborX, horizontalNeighborY)
      && this.isTraversableAt(verticalNeighborX, verticalNeighborY);
  }

  private computeIntegrationField(): void {
    const totalCells = this.metrics.cols * this.metrics.rows;
    this.integrationField.fill(EnemyFlowFieldService.INTEGRATION_INFINITY);
    this.goalSourceField.fill(-1);

    const queue: number[] = [];
    for (const goalCell of this.goalCells) {
      const index = this.toIndex(goalCell.gridX, goalCell.gridY);
      this.integrationField[index] = 0;
      this.goalSourceField[index] = index;
      queue.push(index);
    }

    let queueIdx = 0;
    while (queueIdx < queue.length) {
      const currentIndex = queue[queueIdx++];
      const currentValue = this.integrationField[currentIndex];
      const currentGx = currentIndex % this.metrics.cols;
      const currentGy = Math.floor(currentIndex / this.metrics.cols);

      for (const [dx, dy] of EnemyFlowFieldService.NEIGHBOR_DIRECTIONS) {
        const neighborGx = currentGx + dx;
        const neighborGy = currentGy + dy;

        if (!this.isReachableNeighbor(currentGx, currentGy, neighborGx, neighborGy)) continue;

        const neighborIndex = this.toIndex(neighborGx, neighborGy);
        const neighborCost = this.costs[neighborIndex];
        const diagonalFactor = Math.abs(dx) + Math.abs(dy) === 2 ? Math.sqrt(2) : 1;
        const newValue = currentValue + neighborCost * diagonalFactor;

        const sourceIndex = this.goalSourceField[currentIndex];
        if (
          newValue < this.integrationField[neighborIndex]
          || (newValue === this.integrationField[neighborIndex]
            && sourceIndex >= 0
            && (this.goalSourceField[neighborIndex] < 0 || sourceIndex < this.goalSourceField[neighborIndex]))
        ) {
          this.integrationField[neighborIndex] = newValue;
          this.goalSourceField[neighborIndex] = sourceIndex;
          queue.push(neighborIndex);
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

        let bestNeighborGx = gridX;
        let bestNeighborGy = gridY;
        let bestValue = this.integrationField[index];

        for (const [dx, dy] of EnemyFlowFieldService.NEIGHBOR_DIRECTIONS) {
          const neighborGx = gridX + dx;
          const neighborGy = gridY + dy;

          if (!this.isReachableNeighbor(gridX, gridY, neighborGx, neighborGy)) continue;

          const neighborValue = this.integrationField[this.toIndex(neighborGx, neighborGy)];
          if (neighborValue < bestValue) {
            bestValue = neighborValue;
            bestNeighborGx = neighborGx;
            bestNeighborGy = neighborGy;
          }
        }

        const dirX = bestNeighborGx - gridX;
        const dirY = bestNeighborGy - gridY;
        const length = Math.sqrt(dirX * dirX + dirY * dirY);

        if (length > 0) {
          this.vectorField[vIndex] = dirX / length;
          this.vectorField[vIndex + 1] = dirY / length;
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
