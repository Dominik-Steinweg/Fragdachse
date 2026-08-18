import { GRID_COLS, GRID_ROWS } from '../config';
import type { RockCell } from '../types';

export interface RockGridIndexDimensions {
  cols: number;
  rows: number;
}

/**
 * RockGridIndex – Leichtgewichtiger Spatial Index für das Felsen-Grid.
 *
 * Brücke zwischen dem flachen `rocks[]`-Array (Index = Position in ArenaLayout)
 * und Grid-basiertem Nachbar-Lookup für Autotiling.
 * Wird sowohl auf Host als auch auf Clients identisch aufgebaut.
 */
export class RockGridIndex {
  /**
   * Flat Grid: grid[gy * GRID_COLS + gx] = Rock-Index oder -1.
   *
   * Bewusst `Int32Array` und nicht `Int16Array`: Der gespeicherte Wert ist ein Fels-*Index*,
   * kein Koordinatenwert. Auf grossen Karten liegt der Bestand deutlich ueber 32 767 Felsen,
   * und ein `Int16Array` haette daraus einen versteckten Groessendeckel gemacht – die Indizes
   * waeren stillschweigend uebergelaufen und haetten falsche Felsen adressiert.
   */
  private grid: Int32Array;
  private cols: number;
  private rows: number;
  /** Wiederverwendete Query-Arbeitsdaten; niemals Quelle des Felszustands. */
  private radiusQueryMarks: Uint32Array;
  private readonly radiusQueryIdBuffers: number[][] = [[]];
  private radiusQueryDepth = 0;
  private radiusQueryStamp = 0;

  constructor(rocks: readonly RockCell[], dimensions?: RockGridIndexDimensions) {
    this.cols = dimensions?.cols ?? GRID_COLS;
    this.rows = dimensions?.rows ?? GRID_ROWS;
    this.grid = new Int32Array(this.rows * this.cols).fill(-1);
    this.radiusQueryMarks = new Uint32Array(rocks.length);
    for (let i = 0; i < rocks.length; i++) {
      const { gridX, gridY } = rocks[i];
      if (gridX < 0 || gridX >= this.cols || gridY < 0 || gridY >= this.rows) continue;
      this.grid[gridY * this.cols + gridX] = i;
    }
  }

  /** Ist die Gitterzelle von einem Felsen belegt? */
  isOccupied(gx: number, gy: number): boolean {
    if (gx < 0 || gx >= this.cols || gy < 0 || gy >= this.rows) return false;
    return this.grid[gy * this.cols + gx] !== -1;
  }

  /**
   * Wie isOccupied, aber Zellen außerhalb der Arena-Grenzen gelten als belegt.
   * Für Autotiling: Rand-Tiles erhalten eine geschlossene Kante nach außen.
   */
  isOccupiedWithBorder(gx: number, gy: number): boolean {
    if (gx < 0 || gx >= this.cols || gy < 0 || gy >= this.rows) return true;
    return this.grid[gy * this.cols + gx] !== -1;
  }

  /** Rock-Index an Grid-Position, oder -1 wenn leer. */
  getIndex(gx: number, gy: number): number {
    if (gx < 0 || gx >= this.cols || gy < 0 || gy >= this.rows) return -1;
    return this.grid[gy * this.cols + gx];
  }

  /**
   * Besucht die Felsen in einer konservativen Welt-Radius-Range.
   *
   * Die Zellrange ist nur eine Obermenge: Der Aufrufer muss Mittelpunkt, Aktivitaet,
   * Schaden und Sichtlinie weiterhin exakt pruefen. Die Kandidaten werden gesammelt,
   * dedupliziert und in Rock-ID-Reihenfolge besucht, damit die bisherige Reihenfolge des
   * parallelen `rockObjects`-Arrays erhalten bleibt. Arbeitsbuffer und Visit-Marks werden
   * zwischen Queries wiederverwendet; der Grid bleibt die einzige Quelle der Belegung.
   */
  forEachRockInRadius(
    worldX: number,
    worldY: number,
    radius: number,
    offsetX: number,
    offsetY: number,
    cellSize: number,
    visit: (rockId: number) => void,
  ): void {
    if (radius < 0 || cellSize <= 0) return;

    const minGridX = Math.max(0, Math.floor((worldX - radius - offsetX) / cellSize));
    const maxGridX = Math.min(this.cols - 1, Math.floor((worldX + radius - offsetX) / cellSize));
    const minGridY = Math.max(0, Math.floor((worldY - radius - offsetY) / cellSize));
    const maxGridY = Math.min(this.rows - 1, Math.floor((worldY + radius - offsetY) / cellSize));
    if (minGridX > maxGridX || minGridY > maxGridY) return;

    let stamp = (this.radiusQueryStamp + 1) >>> 0;
    if (stamp === 0) {
      this.radiusQueryMarks.fill(0);
      stamp = 1;
    }
    this.radiusQueryStamp = stamp;

    const queryDepth = this.radiusQueryDepth;
    const queryIds = this.radiusQueryIdBuffers[queryDepth] ?? [];
    this.radiusQueryIdBuffers[queryDepth] = queryIds;
    this.radiusQueryDepth = queryDepth + 1;
    try {
      queryIds.length = 0;
      let isIdOrder = true;
      let previousId = -1;

      for (let gridY = minGridY; gridY <= maxGridY; gridY += 1) {
        for (let gridX = minGridX; gridX <= maxGridX; gridX += 1) {
          const rockId = this.getIndex(gridX, gridY);
          if (rockId < 0) continue;
          this.ensureRadiusQueryMarks(rockId);
          if (this.radiusQueryMarks[rockId] === stamp) continue;
          this.radiusQueryMarks[rockId] = stamp;
          queryIds.push(rockId);
          if (rockId < previousId) isIdOrder = false;
          previousId = rockId;
        }
      }

      if (!isIdOrder) queryIds.sort((left, right) => left - right);
      for (const rockId of queryIds) visit(rockId);
    } finally {
      this.radiusQueryDepth = queryDepth;
    }
  }

  /** Markiert eine Zelle als leer (nach Zerstörung). */
  remove(gx: number, gy: number): void {
    if (gx < 0 || gx >= this.cols || gy < 0 || gy >= this.rows) return;
    this.grid[gy * this.cols + gx] = -1;
  }

  /** Belegt oder überschreibt eine Zelle mit einem Rock-Index. */
  set(gx: number, gy: number, rockId: number): void {
    if (gx < 0 || gx >= this.cols || gy < 0 || gy >= this.rows) return;
    this.grid[gy * this.cols + gx] = rockId;
    if (rockId >= 0) this.ensureRadiusQueryMarks(rockId);
  }

  private ensureRadiusQueryMarks(rockId: number): void {
    if (rockId < this.radiusQueryMarks.length) return;
    const next = new Uint32Array(rockId + 1);
    next.set(this.radiusQueryMarks);
    this.radiusQueryMarks = next;
  }

  /** Gibt Rock-Indizes aller belegten Nachbarzellen zurück (bis zu 8). */
  getNeighborIndices(gx: number, gy: number): number[] {
    const result: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const idx = this.getIndex(gx + dx, gy + dy);
        if (idx !== -1) result.push(idx);
      }
    }
    return result;
  }
}
