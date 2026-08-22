export interface FireObstacleBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface FireCellRange {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface FireObstacleIndexOptions {
  readonly width: number;
  readonly height: number;
  readonly fireCellSize: number;
  readonly worldOriginX: number;
  readonly worldOriginY: number;
  readonly worldCellSize: number;
}

/**
 * Persistent obstacle raster used by host ground-fire placement and its line-of-sight test.
 *
 * The arrays contain reference counts instead of booleans because runtime and static
 * obstacles may overlap the same fire cell. Geometry is written only when an obstacle changes;
 * lookups are a direct numeric array access and never inspect the map's obstacle collections.
 */
export class FireObstacleIndex {
  private readonly blockedFireCells: Uint16Array;
  private readonly fireLineOfSightCells: Uint16Array;
  private readonly staticRockFootprints = new Map<number, FireCellRange>();
  private readonly placeableFootprints = new Map<number, FireCellRange>();
  private readonly baseFootprints = new Map<string, FireCellRange[]>();
  private obstacleRevision = 0;

  constructor(private readonly options: FireObstacleIndexOptions) {
    const cellCount = Math.max(0, options.width * options.height);
    this.blockedFireCells = new Uint16Array(cellCount);
    this.fireLineOfSightCells = new Uint16Array(cellCount);
  }

  get revision(): number {
    return this.obstacleRevision;
  }

  /** Clears the round-scoped index during arena teardown. */
  reset(): void {
    this.blockedFireCells.fill(0);
    this.fireLineOfSightCells.fill(0);
    this.staticRockFootprints.clear();
    this.placeableFootprints.clear();
    this.baseFootprints.clear();
    this.obstacleRevision = 0;
  }

  isCellBlocked(gridX: number, gridY: number): boolean {
    const index = this.cellIndex(gridX, gridY);
    return index >= 0 && this.blockedFireCells[index] > 0;
  }

  hasLineOfSightObstacle(gridX: number, gridY: number): boolean {
    const index = this.cellIndex(gridX, gridY);
    return index >= 0 && this.fireLineOfSightCells[index] > 0;
  }

  addStaticRock(rockId: number, bounds: FireObstacleBounds): void {
    this.replaceFootprint(this.staticRockFootprints, rockId, bounds, true);
  }

  removeStaticRock(rockId: number): void {
    this.removeFootprint(this.staticRockFootprints, rockId, true);
  }

  addPlaceableRock(rockId: number, gridX: number, gridY: number): void {
    const left = this.options.worldOriginX + gridX * this.options.worldCellSize;
    const top = this.options.worldOriginY + gridY * this.options.worldCellSize;
    this.replaceFootprint(this.placeableFootprints, rockId, {
      left,
      top,
      right: left + this.options.worldCellSize,
      bottom: top + this.options.worldCellSize,
    }, true);
  }

  removePlaceableRock(rockId: number): void {
    this.removeFootprint(this.placeableFootprints, rockId, true);
  }

  /** Adds or replaces all per-cell geometry belonging to one base. */
  setBase(baseId: string, bounds: readonly FireObstacleBounds[]): void {
    this.removeBase(baseId);
    const ranges: FireCellRange[] = [];
    for (const bound of bounds) {
      const range = this.boundsToRange(bound);
      if (!range) continue;
      ranges.push(range);
      this.applyRange(range, false, 1);
    }
    if (ranges.length > 0) this.baseFootprints.set(baseId, ranges);
    this.obstacleRevision += 1;
  }

  removeBase(baseId: string): void {
    const ranges = this.baseFootprints.get(baseId);
    if (!ranges) return;
    for (const range of ranges) this.applyRange(range, false, -1);
    this.baseFootprints.delete(baseId);
    this.obstacleRevision += 1;
  }

  /** Adds immutable, non-cell-blocking geometry such as tree trunks. */
  addLineOfSightBounds(bounds: FireObstacleBounds): void {
    const range = this.boundsToRange(bounds);
    if (!range) return;
    this.applyRange(range, false, 1);
    this.obstacleRevision += 1;
  }

  private replaceFootprint(
    footprints: Map<number, FireCellRange>,
    id: number,
    bounds: FireObstacleBounds,
    blocksCell: boolean,
  ): void {
    this.removeFootprint(footprints, id, blocksCell);
    const range = this.boundsToRange(bounds);
    if (range) {
      footprints.set(id, range);
      this.applyRange(range, blocksCell, 1);
    }
    this.obstacleRevision += 1;
  }

  private removeFootprint(
    footprints: Map<number, FireCellRange>,
    id: number,
    blocksCell: boolean,
  ): void {
    const range = footprints.get(id);
    if (!range) return;
    this.applyRange(range, blocksCell, -1);
    footprints.delete(id);
    this.obstacleRevision += 1;
  }

  private boundsToRange(bounds: FireObstacleBounds): FireCellRange | null {
    const minX = Math.floor(bounds.left / this.options.fireCellSize);
    const maxX = Math.floor((bounds.right - 0.001) / this.options.fireCellSize);
    const minY = Math.floor(bounds.top / this.options.fireCellSize);
    const maxY = Math.floor((bounds.bottom - 0.001) / this.options.fireCellSize);
    if (minX > maxX || minY > maxY) return null;
    return { minX, maxX, minY, maxY };
  }

  private applyRange(range: FireCellRange, blocksCell: boolean, delta: 1 | -1): void {
    for (let gridY = range.minY; gridY <= range.maxY; gridY += 1) {
      for (let gridX = range.minX; gridX <= range.maxX; gridX += 1) {
        const index = this.cellIndex(gridX, gridY);
        if (index < 0) continue;
        const lineCount = this.fireLineOfSightCells[index];
        this.fireLineOfSightCells[index] = delta > 0
          ? lineCount + 1
          : Math.max(0, lineCount - 1);
        if (!blocksCell) continue;
        const blockedCount = this.blockedFireCells[index];
        this.blockedFireCells[index] = delta > 0
          ? blockedCount + 1
          : Math.max(0, blockedCount - 1);
      }
    }
  }

  private cellIndex(gridX: number, gridY: number): number {
    if (gridX < 0 || gridX >= this.options.width || gridY < 0 || gridY >= this.options.height) return -1;
    return gridY * this.options.width + gridX;
  }
}
