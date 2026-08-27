import * as Phaser from 'phaser';
import { CELL_SIZE, TRUNK_RADIUS } from '../config';
import type { ArenaLayout } from '../types';
import type { RockWorldFrame } from '../arena/ArenaBuilder';
import { isLobbyUiReservedCell } from '../arena/MenuArenaPreviewConfig';
import {
  ArenaObstacleIndex,
  type ObstacleCircleBody,
  type ObstacleRectBody,
} from '../systems/ArenaObstacleIndex';
import { CombatGeometry } from '../systems/CombatGeometry';

/**
 * Fels-Hindernis der Lobby: eine volle Gitterzelle.
 *
 * Bewusst kein Display-Objekt. Die Felsen der Vorschau liegen als gebackene Layer vor, nicht
 * als hunderte Einzel-Images; ihre Kollisionsform muss trotzdem existieren. Der Proxy trägt
 * nur Rechteck und Aktivzustand.
 */
class LobbyRockProxy implements ObstacleRectBody {
  active = true;

  constructor(
    private readonly left: number,
    private readonly top: number,
  ) {}

  /**
   * Schreibt immer in `output` und legt sonst ein frisches Rechteck an.
   *
   * Wichtig: Niemals das eigene Rechteck zurückgeben. Der Hindernis-Index merkt sich das
   * Ergebnis des ersten Aufrufs als gemeinsamen Scratch und würde damit später die Bounds
   * aller anderen Hindernisse in genau dieses Objekt schreiben.
   */
  getBounds(output?: Phaser.Geom.Rectangle): Phaser.Geom.Rectangle {
    const target = output ?? new Phaser.Geom.Rectangle();
    return target.setTo(this.left, this.top, CELL_SIZE, CELL_SIZE);
  }
}

/** Baumstamm-Hindernis der Lobby – derselbe Kreisradius wie im Gameplay. */
class LobbyTrunkProxy implements ObstacleCircleBody {
  readonly active = true;

  constructor(
    readonly x: number,
    readonly y: number,
    readonly radius: number,
  ) {}
}

/**
 * Hindernisbestand der Lobby-Inszenierung.
 *
 * Speist denselben {@link ArenaObstacleIndex} wie das Gameplay und stellt damit Sichtlinie,
 * Hitscan, Projektilpfad und Navigation auf dieselbe Grundlage. Es entsteht kein zweiter
 * Spatial Hash und keine zweite Trefferrechnung.
 *
 * Der Bestand ist veränderlich: Ambient-Felsen werden zerstört und vom Inspector wieder
 * aufgebaut. Jede Änderung zählt {@link getTopologyVersion} hoch, damit laufende Pfade
 * erkennen, dass sie neu geplant werden müssen.
 */
export class LobbyObstacleWorld {
  private readonly rockProxies: (LobbyRockProxy | null)[] = [];
  private readonly trunkProxies: LobbyTrunkProxy[] = [];
  /** Belegte Zellen als flaches Gitter: -1 frei, sonst Fels-Index. */
  private readonly rockCellIndex: Int32Array;
  /** Von einem Baumstamm berührte Zellen. Stämme werden nie zerstört. */
  private readonly trunkBlockedCells = new Set<number>();

  readonly gridCols: number;
  readonly gridRows: number;
  readonly obstacleIndex: ArenaObstacleIndex;
  readonly geometry: CombatGeometry;

  private topologyVersion = 0;

  constructor(
    private readonly layout: ArenaLayout,
    private readonly worldFrame: RockWorldFrame,
  ) {
    this.gridCols = Math.floor(worldFrame.width / CELL_SIZE);
    this.gridRows = Math.floor(worldFrame.height / CELL_SIZE);
    this.rockCellIndex = new Int32Array(this.gridCols * this.gridRows).fill(-1);

    for (let id = 0; id < layout.rocks.length; id += 1) {
      const { gridX, gridY } = layout.rocks[id];
      const world = this.cellToWorld(gridX, gridY);
      this.rockProxies.push(new LobbyRockProxy(world.x - CELL_SIZE / 2, world.y - CELL_SIZE / 2));
      const cell = this.cellKey(gridX, gridY);
      if (cell >= 0) this.rockCellIndex[cell] = id;
    }

    for (const tree of layout.trees ?? []) {
      const world = this.cellToWorld(tree.gridX, tree.gridY);
      this.trunkProxies.push(new LobbyTrunkProxy(world.x, world.y, TRUNK_RADIUS));
      // Der Stammradius ist kleiner als eine Zelle; für die Navigation genügt seine eigene.
      const cell = this.cellKey(tree.gridX, tree.gridY);
      if (cell >= 0) this.trunkBlockedCells.add(cell);
    }

    this.obstacleIndex = new ArenaObstacleIndex({
      bounds: () => this.worldFrame,
      rocks:  () => this.rockProxies,
      trunks: () => this.trunkProxies,
      bases:  () => null,
    });
    this.geometry = new CombatGeometry(this.obstacleIndex);
  }

  /** Zählt bei jeder Topologieänderung hoch; Grundlage für Pfad-Neuplanung. */
  getTopologyVersion(): number {
    return this.topologyVersion;
  }

  isRockAlive(id: number): boolean {
    return this.rockProxies[id]?.active === true;
  }

  /**
   * Nimmt einen Fels aus dem Bestand oder stellt ihn wieder her. Gibt `true` zurück, wenn
   * sich dadurch etwas geändert hat.
   */
  setRockAlive(id: number, alive: boolean): boolean {
    const proxy = this.rockProxies[id];
    if (!proxy || proxy.active === alive) return false;

    proxy.active = alive;
    const { gridX, gridY } = this.layout.rocks[id];
    const cell = this.cellKey(gridX, gridY);
    if (cell >= 0) this.rockCellIndex[cell] = alive ? id : -1;

    // Nur der `active`-Zustand wechselt, die Geometrie bleibt – der Index liest `active`
    // live beim Query. `markDirty` ist trotzdem richtig, weil ein wieder aufgebauter Fels
    // sonst in einem Bucket fehlen könnte, das beim letzten Bau leer war.
    this.obstacleIndex.markDirty();
    this.topologyVersion += 1;
    return true;
  }

  /**
   * Originalzelle eines Felsens – auch wenn er gerade zerstört ist.
   *
   * Der Inspector baut genau dort wieder auf, wo der Fels stand; die Zelle stammt deshalb aus
   * dem Layout und nicht aus der aktuellen Belegung.
   */
  getWorkCell(rockId: number): { gridX: number; gridY: number } | null {
    const cell = this.layout.rocks[rockId];
    return cell ? { gridX: cell.gridX, gridY: cell.gridY } : null;
  }

  /** Fels-Index an dieser Zelle oder -1. Zerstörte Felsen zählen als frei. */
  getRockIdAt(gridX: number, gridY: number): number {
    const cell = this.cellKey(gridX, gridY);
    return cell >= 0 ? this.rockCellIndex[cell] : -1;
  }

  /**
   * Steht auf dieser Zelle ein lebender Fels? Zellen außerhalb des Rahmens gelten als belegt,
   * damit die AutoTile-Kante am Rand geschlossen bleibt – dieselbe Regel wie
   * `RockGridIndex.isOccupiedWithBorder`. Baumstämme zählen bewusst nicht mit: sie gehören
   * nicht zur Fels-Silhouette.
   */
  isRockCellWithBorder(gridX: number, gridY: number): boolean {
    const cell = this.cellKey(gridX, gridY);
    if (cell < 0) return true;
    return this.rockCellIndex[cell] >= 0;
  }

  /**
   * Blockiert diese Zelle Bewegung? Außerhalb des Rahmens gilt als blockiert.
   *
   * Die Flächen der Lobby-Oberfläche zählen mit: Ein Actor darf auch mitten in einer Sequenz
   * nicht unter ein Seitenmenü laufen, nicht nur nicht dort starten.
   */
  isCellBlocked(gridX: number, gridY: number): boolean {
    const cell = this.cellKey(gridX, gridY);
    if (cell < 0) return true;
    if (isLobbyUiReservedCell(gridX, gridY)) return true;
    return this.rockCellIndex[cell] >= 0 || this.trunkBlockedCells.has(cell);
  }

  /**
   * Freie Randzelle der Arena, über die ein Actor die Bühne betritt oder verlässt.
   *
   * Gewählt wird die Seite, die dem Ziel am nächsten liegt; entlang dieser Kante die Zelle mit
   * dem geringsten Abstand. Ohne freie Randzelle liefert die Methode `null` – dann bleibt nur
   * der direkte Auftritt.
   */
  findStageEdgeCell(target: { gridX: number; gridY: number }): { gridX: number; gridY: number } | null {
    const distances = [
      { side: 'top' as const,    distance: target.gridY },
      { side: 'bottom' as const, distance: this.gridRows - 1 - target.gridY },
      { side: 'left' as const,   distance: target.gridX },
      { side: 'right' as const,  distance: this.gridCols - 1 - target.gridX },
    ].sort((left, right) => left.distance - right.distance);

    for (const { side } of distances) {
      const horizontal = side === 'top' || side === 'bottom';
      const fixed = side === 'top' ? 0
        : side === 'bottom' ? this.gridRows - 1
        : side === 'left' ? 0
        : this.gridCols - 1;
      const span = horizontal ? this.gridCols : this.gridRows;
      const anchor = horizontal ? target.gridX : target.gridY;

      for (let offset = 0; offset < span; offset += 1) {
        for (const candidate of [anchor - offset, anchor + offset]) {
          if (candidate < 0 || candidate >= span) continue;
          const gridX = horizontal ? candidate : fixed;
          const gridY = horizontal ? fixed : candidate;
          if (!this.isCellBlocked(gridX, gridY)) return { gridX, gridY };
        }
      }
    }
    return null;
  }

  /** Liegt der Weltpunkt innerhalb der bespielbaren Arenafläche? */
  containsWorldPoint(x: number, y: number): boolean {
    return x >= this.worldFrame.offsetX
      && x <= this.worldFrame.offsetX + this.worldFrame.width
      && y >= this.worldFrame.offsetY
      && y <= this.worldFrame.offsetY + this.worldFrame.height;
  }

  cellToWorld(gridX: number, gridY: number): { x: number; y: number } {
    return {
      x: this.worldFrame.offsetX + gridX * CELL_SIZE + CELL_SIZE / 2,
      y: this.worldFrame.offsetY + gridY * CELL_SIZE + CELL_SIZE / 2,
    };
  }

  worldToCell(x: number, y: number): { gridX: number; gridY: number } {
    return {
      gridX: Math.floor((x - this.worldFrame.offsetX) / CELL_SIZE),
      gridY: Math.floor((y - this.worldFrame.offsetY) / CELL_SIZE),
    };
  }

  /** Weltgrenzen des Bestands – Ambient-Actors und -Projektile bleiben darin. */
  getWorldFrame(): RockWorldFrame {
    return this.worldFrame;
  }

  private cellKey(gridX: number, gridY: number): number {
    if (gridX < 0 || gridY < 0 || gridX >= this.gridCols || gridY >= this.gridRows) return -1;
    return gridY * this.gridCols + gridX;
  }
}
