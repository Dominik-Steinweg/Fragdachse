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
export type EnemyFlowFieldGoalMode = 'bases' | 'dynamic-fallback-bases';

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
    this.dynamicGoalCells = this.normalizeGoalCells(options.dynamicGoalCells ?? []);
    this.metrics = { ...metrics };
    this.eventBus = options.eventBus ?? null;
    this.obstacleCellProvider = options.obstacleCellProvider ?? null;

    const totalCells = this.metrics.cols * this.metrics.rows;
    this.costs = new Uint32Array(totalCells);
    this.kindCodes = new Uint8Array(totalCells);
    this.traversable = new Uint8Array(totalCells);
    this.destructible = new Uint8Array(totalCells);
    this.goalMask = new Uint8Array(totalCells);
    this.integrationField = new Float32Array(totalCells);
    this.vectorField = new Float32Array(totalCells * 2);
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

    const queue: number[] = [];
    for (const goalCell of this.goalCells) {
      const index = this.toIndex(goalCell.gridX, goalCell.gridY);
      this.integrationField[index] = 0;
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

        if (newValue < this.integrationField[neighborIndex]) {
          this.integrationField[neighborIndex] = newValue;
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
