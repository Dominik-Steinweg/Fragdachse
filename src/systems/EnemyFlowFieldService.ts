import type { ArenaLayout, PowerUpPedestalCell } from '../types';
import type { BaseSpec } from '../arena/BaseRegistry';
import {
  COOP_DEFENSE_FLOW_FIELD_BASE_COST,
  COOP_DEFENSE_FLOW_FIELD_GROUND_COST,
  COOP_DEFENSE_FLOW_FIELD_ROCK_COST,
  COOP_DEFENSE_FLOW_FIELD_TRUNK_COST,
} from '../config';

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

const CELL_DEFINITIONS = {
  ground: { code: 0, cost: COOP_DEFENSE_FLOW_FIELD_GROUND_COST, isTraversable: true, isDestructible: false },
  rock: { code: 1, cost: COOP_DEFENSE_FLOW_FIELD_ROCK_COST, isTraversable: false, isDestructible: true },
  trunk: { code: 2, cost: COOP_DEFENSE_FLOW_FIELD_TRUNK_COST, isTraversable: false, isDestructible: false },
  track: { code: 3, cost: COOP_DEFENSE_FLOW_FIELD_GROUND_COST, isTraversable: true, isDestructible: false },
  pedestal: { code: 4, cost: COOP_DEFENSE_FLOW_FIELD_GROUND_COST, isTraversable: true, isDestructible: false },
  base: { code: 5, cost: COOP_DEFENSE_FLOW_FIELD_BASE_COST, isTraversable: false, isDestructible: false },
  outOfBounds: { code: 6, cost: COOP_DEFENSE_FLOW_FIELD_TRUNK_COST, isTraversable: false, isDestructible: false },
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
  { kind: 'ground', matches: () => true },
] as const;

export type EnemyFlowFieldCellKind = keyof typeof CELL_DEFINITIONS;

export class EnemyFlowFieldService {
  private readonly metrics: EnemyFlowFieldMetrics;
  private readonly layout: ArenaLayout;
  private readonly baseSpecs: readonly BaseSpec[];
  private readonly costs: Uint32Array;
  private readonly kindCodes: Uint8Array;
  private readonly traversable: Uint8Array;
  private readonly destructible: Uint8Array;
  private readonly goalMask: Uint8Array;
  private readonly goalCells: EnemyFlowFieldGoalCell[];
  private readonly summary: EnemyFlowFieldSummary;
  private readonly integrationField: Float32Array;
  private readonly vectorField: Float32Array; // 2 floats (x, y) per cell
  private debugOverlayCallback: ((renderer: EnemyFlowFieldDebugRenderer) => void) | null = null;

  static readonly INTEGRATION_INFINITY = 999999;
  static readonly NEIGHBOR_DIRECTIONS = [
    [1, 0], [-1, 0], [0, 1], [0, -1],      // cardinal
    [1, 1], [-1, -1], [1, -1], [-1, 1],    // diagonal
  ] as const;

  constructor(
    layout: ArenaLayout,
    baseSpecs: readonly BaseSpec[],
    metrics: EnemyFlowFieldMetrics,
  ) {
    this.layout = layout;
    this.baseSpecs = [...baseSpecs];
    this.metrics = { ...metrics };

    const totalCells = this.metrics.cols * this.metrics.rows;
    this.costs = new Uint32Array(totalCells);
    this.kindCodes = new Uint8Array(totalCells);
    this.traversable = new Uint8Array(totalCells);
    this.destructible = new Uint8Array(totalCells);
    this.goalMask = new Uint8Array(totalCells);
    this.integrationField = new Float32Array(totalCells);
    this.vectorField = new Float32Array(totalCells * 2);

    const buildContext = this.createBuildContext(layout, this.baseSpecs);
    const countsByKind = this.createEmptyCounts();

    let traversableCells = 0;
    for (let gridY = 0; gridY < this.metrics.rows; gridY++) {
      for (let gridX = 0; gridX < this.metrics.cols; gridX++) {
        const index = this.toIndex(gridX, gridY);
        const cellKey = index;
        const kind = this.resolveKind(cellKey, buildContext);
        const definition = CELL_DEFINITIONS[kind];

        this.costs[index] = definition.cost;
        this.kindCodes[index] = definition.code;
        this.traversable[index] = definition.isTraversable ? 1 : 0;
        this.destructible[index] = definition.isDestructible ? 1 : 0;
        countsByKind[kind]++;
        if (definition.isTraversable) traversableCells++;
      }
    }

    this.goalCells = this.computeGoalCells();
    for (const goalCell of this.goalCells) {
      this.goalMask[this.toIndex(goalCell.gridX, goalCell.gridY)] = 1;
    }

    this.computeIntegrationField();
    this.computeVectorField();

    this.summary = {
      cols: this.metrics.cols,
      rows: this.metrics.rows,
      totalCells,
      traversableCells,
      blockedCells: totalCells - traversableCells,
      goalCells: this.goalCells.length,
      countsByKind,
    };
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

  rebuild(): EnemyFlowFieldService {
    return new EnemyFlowFieldService(this.layout, this.baseSpecs, this.metrics);
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

  registerDebugOverlayCallback(
    callback: ((renderer: EnemyFlowFieldDebugRenderer) => void) | null,
  ): void {
    this.debugOverlayCallback = callback;
    if (callback) {
      const renderer = new EnemyFlowFieldDebugRendererImpl(this);
      callback(renderer);
    }
  }

  private createBuildContext(
    layout: ArenaLayout,
    baseSpecs: readonly BaseSpec[],
  ): EnemyFlowFieldBuildContext {
    return {
      rockCells: this.buildLookup(layout.rocks.map((cell) => ({ gridX: cell.gridX, gridY: cell.gridY }))),
      trunkCells: this.buildLookup(layout.trees.map((cell) => ({ gridX: cell.gridX, gridY: cell.gridY }))),
      trackCells: this.buildTrackLookup(layout.tracks),
      pedestalCells: this.buildPedestalLookup(layout.powerUpPedestals),
      baseCells: this.buildBaseLookup(baseSpecs),
    };
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
      for (let gridY = baseSpec.region.minGridY; gridY <= baseSpec.region.maxGridY; gridY++) {
        for (let gridX = baseSpec.region.minGridX; gridX <= baseSpec.region.maxGridX; gridX++) {
          if (!this.isInBounds(gridX, gridY)) continue;
          lookup.add(this.toIndex(gridX, gridY));
        }
      }
    }
    return lookup;
  }

  private createEmptyCounts(): Record<EnemyFlowFieldCellKind, number> {
    return {
      ground: 0,
      rock: 0,
      trunk: 0,
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
    const goalSet = new Set<number>();
    const directions: ReadonlyArray<readonly [number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    for (const baseSpec of this.baseSpecs) {
      for (let gridY = baseSpec.region.minGridY; gridY <= baseSpec.region.maxGridY; gridY++) {
        for (let gridX = baseSpec.region.minGridX; gridX <= baseSpec.region.maxGridX; gridX++) {
          for (const [dx, dy] of directions) {
            const neighborX = gridX + dx;
            const neighborY = gridY + dy;
            if (!this.isTraversableAt(neighborX, neighborY)) continue;
            goalSet.add(this.toIndex(neighborX, neighborY));
          }
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

  private isInBounds(gridX: number, gridY: number): boolean {
    return gridX >= 0
      && gridX < this.metrics.cols
      && gridY >= 0
      && gridY < this.metrics.rows;
  }

  private toIndex(gridX: number, gridY: number): number {
    return gridY * this.metrics.cols + gridX;
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

        if (!this.isInBounds(neighborGx, neighborGy)) continue;
        if (!this.isTraversableAt(neighborGx, neighborGy)) continue;

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

        if (!this.isTraversableAt(gridX, gridY)) {
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

          if (!this.isInBounds(neighborGx, neighborGy)) continue;
          if (!this.isTraversableAt(neighborGx, neighborGy)) continue;

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