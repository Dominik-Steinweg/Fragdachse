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
}