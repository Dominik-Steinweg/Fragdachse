import type { LobbyObstacleWorld } from './LobbyObstacleWorld';

export interface NavCell {
  gridX: number;
  gridY: number;
}

export interface NavWaypoint {
  x: number;
  y: number;
}

/** Ein Actor gilt als eingeschlossen, wenn ihm weniger als so viele Zellen bleiben. */
const TRAPPED_CELL_THRESHOLD = 10;

const DIRECTIONS: ReadonlyArray<{ dx: number; dy: number; cost: number }> = [
  { dx:  1, dy:  0, cost: 1 },
  { dx: -1, dy:  0, cost: 1 },
  { dx:  0, dy:  1, cost: 1 },
  { dx:  0, dy: -1, cost: 1 },
  { dx:  1, dy:  1, cost: Math.SQRT2 },
  { dx:  1, dy: -1, cost: Math.SQRT2 },
  { dx: -1, dy:  1, cost: Math.SQRT2 },
  { dx: -1, dy: -1, cost: Math.SQRT2 },
];

/**
 * Gitternavigation der Lobby-Inszenierung.
 *
 * Arbeitet direkt auf der Zellbelegung des {@link LobbyObstacleWorld} – derselben Belegung,
 * die auch Sichtlinie und Projektilkollision benutzen. Eine Felszerstörung öffnet damit im
 * selben Frame einen Weg, ein Neubau schließt ihn wieder.
 *
 * Diagonalschritte schneiden keine Ecken: Sie sind nur erlaubt, wenn beide angrenzenden
 * Kardinalzellen frei sind. Sonst liefe ein Actor sichtbar durch die Kante zweier Felsen.
 */
export class LobbyNavigation {
  constructor(private readonly world: LobbyObstacleWorld) {}

  isCellFree(gridX: number, gridY: number): boolean {
    return !this.world.isCellBlocked(gridX, gridY);
  }

  /**
   * Ist ein Diagonalschritt erlaubt? Nur wenn er nicht zwischen zwei Hindernissen
   * hindurchschneidet.
   */
  private canStep(fromX: number, fromY: number, dx: number, dy: number): boolean {
    if (!this.isCellFree(fromX + dx, fromY + dy)) return false;
    if (dx === 0 || dy === 0) return true;
    return this.isCellFree(fromX + dx, fromY) && this.isCellFree(fromX, fromY + dy);
  }

  /** Nächstgelegene freie Zelle im Umkreis; `null`, wenn im Radius keine frei ist. */
  findNearestFreeCell(gridX: number, gridY: number, maxRadius = 6): NavCell | null {
    if (this.isCellFree(gridX, gridY)) return { gridX, gridY };
    for (let radius = 1; radius <= maxRadius; radius += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          if (this.isCellFree(gridX + dx, gridY + dy)) {
            return { gridX: gridX + dx, gridY: gridY + dy };
          }
        }
      }
    }
    return null;
  }

  /**
   * Kürzester Weg zwischen zwei Weltpunkten als Folge von Zellmittelpunkten.
   *
   * Gibt `null` zurück, wenn kein Weg existiert – der Aufrufer muss das behandeln, statt sich
   * auf einen Ersatzpfad zu verlassen. Ein zugebauter Weg ist in dieser Felslandschaft ein
   * normaler Zustand, kein Fehler.
   */
  findPath(fromX: number, fromY: number, toX: number, toY: number): NavWaypoint[] | null {
    const start = this.world.worldToCell(fromX, fromY);
    const goalRaw = this.world.worldToCell(toX, toY);
    const goal = this.findNearestFreeCell(goalRaw.gridX, goalRaw.gridY);
    const startCell = this.findNearestFreeCell(start.gridX, start.gridY);
    if (!goal || !startCell) return null;
    if (startCell.gridX === goal.gridX && startCell.gridY === goal.gridY) {
      return [this.world.cellToWorld(goal.gridX, goal.gridY)];
    }

    const cols = this.world.gridCols;
    const total = cols * this.world.gridRows;
    const cameFrom = new Int32Array(total).fill(-1);
    const gScore = new Float64Array(total).fill(Number.POSITIVE_INFINITY);
    const closed = new Uint8Array(total);

    const key = (cell: NavCell) => cell.gridY * cols + cell.gridX;
    const heuristic = (gridX: number, gridY: number) => {
      const dx = Math.abs(gridX - goal.gridX);
      const dy = Math.abs(gridY - goal.gridY);
      // Oktil-Distanz passend zu den erlaubten Schritten – nie überschätzend.
      return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
    };

    const startKey = key(startCell);
    const goalKey = key(goal);
    gScore[startKey] = 0;

    // Kleine, offene Menge: die Lobby hat ~2000 Zellen, ein lineares Minimum ist hier
    // billiger als eine eigene Heap-Struktur zu unterhalten.
    const open = new Set<number>([startKey]);
    const fScore = new Float64Array(total).fill(Number.POSITIVE_INFINITY);
    fScore[startKey] = heuristic(startCell.gridX, startCell.gridY);

    while (open.size > 0) {
      let current = -1;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const candidate of open) {
        if (fScore[candidate] < bestScore) {
          bestScore = fScore[candidate];
          current = candidate;
        }
      }
      if (current < 0) break;
      if (current === goalKey) return this.reconstruct(cameFrom, current, cols);

      open.delete(current);
      closed[current] = 1;

      const currentX = current % cols;
      const currentY = Math.floor(current / cols);
      for (const { dx, dy, cost } of DIRECTIONS) {
        if (!this.canStep(currentX, currentY, dx, dy)) continue;
        const neighbor = (currentY + dy) * cols + (currentX + dx);
        if (closed[neighbor]) continue;

        const tentative = gScore[current] + cost;
        if (tentative >= gScore[neighbor]) continue;

        cameFrom[neighbor] = current;
        gScore[neighbor] = tentative;
        fScore[neighbor] = tentative + heuristic(currentX + dx, currentY + dy);
        open.add(neighbor);
      }
    }

    return null;
  }

  /**
   * Darf diese Zelle wieder zugebaut werden, ohne einen Actor einzuschließen?
   *
   * Der Inspector baut zerstörte Felsen einzeln wieder auf. Sitzt ein Actor in einer Tasche,
   * deren einziger Ausgang gerade zugebaut würde, bliebe er dort für immer stehen. Geprüft
   * wird deshalb pro Actor, ob ihm mit blockierter Zelle noch genug Fläche bleibt.
   */
  isRebuildSafe(gridX: number, gridY: number, actorPositions: ReadonlyArray<NavWaypoint>): boolean {
    for (const actor of actorPositions) {
      const cell = this.world.worldToCell(actor.x, actor.y);
      // Direkt auf der Zelle stehen heißt: der Neubau würde in den Actor hineinbauen.
      if (cell.gridX === gridX && cell.gridY === gridY) return false;
      if (this.reachableCellCount(cell, gridX, gridY, TRAPPED_CELL_THRESHOLD) < TRAPPED_CELL_THRESHOLD) {
        return false;
      }
    }
    return true;
  }

  /**
   * Zählt erreichbare freie Zellen ab `start`, wobei `blockedX`/`blockedY` zusätzlich als
   * belegt gelten. Bricht ab, sobald `limit` erreicht ist – die genaue Größe interessiert
   * nicht, nur ob genug Platz bleibt.
   */
  private reachableCellCount(start: NavCell, blockedX: number, blockedY: number, limit: number): number {
    const cols = this.world.gridCols;
    const visited = new Set<number>();
    const queue: NavCell[] = [];

    const startFree = this.isCellFree(start.gridX, start.gridY)
      && !(start.gridX === blockedX && start.gridY === blockedY);
    if (!startFree) return 0;

    queue.push(start);
    visited.add(start.gridY * cols + start.gridX);

    for (let head = 0; head < queue.length && visited.size < limit; head += 1) {
      const cell = queue[head];
      for (const { dx, dy } of DIRECTIONS) {
        const nextX = cell.gridX + dx;
        const nextY = cell.gridY + dy;
        if (nextX === blockedX && nextY === blockedY) continue;
        if (!this.canStepAround(cell.gridX, cell.gridY, dx, dy, blockedX, blockedY)) continue;
        const nextKey = nextY * cols + nextX;
        if (visited.has(nextKey)) continue;
        visited.add(nextKey);
        queue.push({ gridX: nextX, gridY: nextY });
      }
    }

    return visited.size;
  }

  /** Wie {@link canStep}, aber mit einer zusätzlich als belegt geltenden Zelle. */
  private canStepAround(
    fromX: number, fromY: number, dx: number, dy: number,
    blockedX: number, blockedY: number,
  ): boolean {
    const free = (gridX: number, gridY: number) => this.isCellFree(gridX, gridY)
      && !(gridX === blockedX && gridY === blockedY);
    if (!free(fromX + dx, fromY + dy)) return false;
    if (dx === 0 || dy === 0) return true;
    return free(fromX + dx, fromY) && free(fromX, fromY + dy);
  }

  private reconstruct(cameFrom: Int32Array, goalKey: number, cols: number): NavWaypoint[] {
    const cells: number[] = [goalKey];
    let cursor = goalKey;
    while (cameFrom[cursor] >= 0) {
      cursor = cameFrom[cursor];
      cells.push(cursor);
    }
    cells.reverse();
    // Der Startpunkt ist die aktuelle Position; als Wegpunkt trägt er nichts bei.
    return cells.slice(1).map((cell) => this.world.cellToWorld(cell % cols, Math.floor(cell / cols)));
  }
}
