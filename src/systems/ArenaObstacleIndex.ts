// Nur Typ-Import: dieses Modul soll ohne Phaser-Laufzeit (und damit ohne DOM) nutzbar
// und testbar bleiben. Alle Phaser-Aufrufe laufen über die übergebenen Objekte.
import type * as Phaser from 'phaser';
import { ARENA_HEIGHT, ARENA_OFFSET_X, ARENA_OFFSET_Y, ARENA_WIDTH } from '../config';

const BUCKET_SIZE = 128;

export const OBSTACLE_ROCK = 1;
export const OBSTACLE_BASE = 2;

export interface ArenaObstacleSources {
  /** Paralleles Array zu `layout.rocks` – `null` bedeutet zerstört. */
  readonly rocks: () => readonly (Phaser.GameObjects.Image | null)[] | null;
  /** Baumstämme als Kreis-Hindernisse. */
  readonly trunks: () => readonly Phaser.GameObjects.Arc[] | null;
  /** Zell-Rechtecke der Coop-Defense-Basen. */
  readonly bases: () => readonly Phaser.GameObjects.Rectangle[] | null;
}

/**
 * Besucher für ein Rechteck-Hindernis auf dem Segment.
 * Rückgabe `true` bricht die Traversierung ab (Frühausstieg für reine Ja/Nein-Prüfungen).
 */
export type ObstacleRectVisitor = (
  kind: typeof OBSTACLE_ROCK | typeof OBSTACLE_BASE,
  /** Index in `rockObjects` bei Felsen, sonst -1. */
  rockIndex: number,
  left: number, top: number, right: number, bottom: number,
) => boolean;

/** Wie `ObstacleRectVisitor`, für Baumstämme. */
export type ObstacleCircleVisitor = (
  centerX: number, centerY: number, radius: number,
) => boolean;

// Slab-Zwischenergebnis des zuletzt geprüften Segment/Box-Paares. Modulweit statt als
// Rückgabeobjekt, damit die Bucket-Vorauswahl ohne Allokation läuft. Wird ausschließlich
// unmittelbar nach `overlapsBox()` gelesen, nie über einen Besucheraufruf hinweg.
let slabEnter = 0;
let slabExit = 0;

/**
 * Prüft per Slab-Test, ob das Segment die Box berührt, und legt Ein-/Austritts-Parameter
 * in `slabEnter`/`slabExit` ab. Ein Segment, das vollständig innerhalb der Box liegt,
 * gilt als Berührung (wichtig für die Bucket-Vorauswahl).
 */
function overlapsBox(
  x1: number, y1: number, dx: number, dy: number,
  left: number, top: number, right: number, bottom: number,
): boolean {
  let enter = 0;
  let exit = 1;

  if (dx === 0) {
    if (x1 < left || x1 > right) return false;
  } else {
    const inv = 1 / dx;
    let t0 = (left - x1) * inv;
    let t1 = (right - x1) * inv;
    if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
    if (t0 > enter) enter = t0;
    if (t1 < exit) exit = t1;
    if (enter > exit) return false;
  }

  if (dy === 0) {
    if (y1 < top || y1 > bottom) return false;
  } else {
    const inv = 1 / dy;
    let t0 = (top - y1) * inv;
    let t1 = (bottom - y1) * inv;
    if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
    if (t0 > enter) enter = t0;
    if (t1 < exit) exit = t1;
    if (enter > exit) return false;
  }

  slabEnter = enter;
  slabExit = exit;
  return true;
}

/**
 * Räumlicher Index der schussblockierenden Hindernisse einer Runde.
 *
 * Zweck: Sichtlinien-, Hitscan- und Melee-Prüfungen testeten bisher jedes Segment gegen
 * *alle* Felsen der Karte und holten deren Bounding-Box über `getBounds()`. Dieser Aufruf
 * allokiert ein `Rectangle` und rechnet vier Eckpunkte über die Transform-Komponente neu
 * aus – bei mehreren hundert Felsen und zielsuchenden Projektilen war das der mit Abstand
 * teuerste Posten des Host-Frames. Felsen, Basen und Baumstämme bewegen sich nie, ihre
 * Geometrie ist also über die Runde konstant und gehört gecacht.
 *
 * Bewusst ein reiner Cache und kein zweiter Bestand – gebaut wird ausschließlich aus
 * denselben Referenzen, die `CombatSystem` ohnehin hält. Der `active`-Zustand wird
 * **live** beim Query gelesen, nicht gecacht: ein zerstörter Fels blockiert damit sofort
 * nicht mehr, ohne dass irgendwer invalidieren müsste. Neu gebaut wird nur, wenn sich die
 * Geometrie ändert – also bei `markDirty()` (Fels gesetzt/entfernt) oder wenn eines der
 * Quell-Arrays ausgetauscht wird oder seine Länge ändert.
 */
export class ArenaObstacleIndex {
  /** Rechteck-Hindernisse als flaches [l,t,r,b]. */
  private rectData = new Float64Array(0);
  /** Live-Referenz je Rechteck, um `active` beim Query zu prüfen. */
  private rectSource: (Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle)[] = [];
  private rectKind = new Uint8Array(0);
  private rectRockIndex = new Int32Array(0);
  private rectCount = 0;

  /** Kreis-Hindernisse als flaches [cx,cy,r]. */
  private circleData = new Float64Array(0);
  private circleSource: Phaser.GameObjects.Arc[] = [];
  private circleCount = 0;

  // Bucket-Grid im CSR-Layout: bucketStart[i]..bucketStart[i+1] indiziert `bucketEntries`.
  private bucketStart = new Int32Array(1);
  private bucketEntries = new Int32Array(0);
  private bucketCols = 0;
  private bucketRows = 0;
  private originX = 0;
  private originY = 0;

  // Ein Hindernis liegt oft in mehreren Buckets. `queryStamp` zählt monoton hoch, damit
  // dieselbe Query dasselbe Hindernis nur einmal besucht – ohne Set und ohne Clear-Pass.
  private queryStamp = 0;
  private entryStamp = new Int32Array(0);

  private dirty = true;
  // Identität und Länge der Quell-Arrays beim letzten Bau. Fängt ausgetauschte Arrays
  // (Rundenwechsel) und nachträglich angehängte Felsen (Platzierbare) ohne Invalidierung ab.
  private builtRocks: readonly (Phaser.GameObjects.Image | null)[] | null = null;
  private builtTrunks: readonly Phaser.GameObjects.Arc[] | null = null;
  private builtBases: readonly Phaser.GameObjects.Rectangle[] | null = null;
  private builtRockLength = -1;
  private builtTrunkLength = -1;
  private builtBaseLength = -1;
  /** Lazy vom ersten Hindernis erzeugt, danach wiederverwendet (siehe `writeRect`). */
  private scratchBounds: Phaser.Geom.Rectangle | null = null;

  constructor(private readonly sources: ArenaObstacleSources) {}

  /** Nach jeder Änderung der Hindernis-*Geometrie* aufrufen (Fels gesetzt oder entfernt). */
  markDirty(): void {
    this.dirty = true;
  }

  /**
   * Besucht alle Hindernisse, deren Bucket das Segment berührt.
   *
   * Die Vorauswahl ist konservativ: der Besucher bekommt Kandidaten, nicht Treffer, und
   * führt den exakten Schnitttest selbst aus. Inaktive Hindernisse werden bereits hier
   * übersprungen.
   */
  querySegment(
    x1: number, y1: number, x2: number, y2: number,
    visitRect: ObstacleRectVisitor,
    visitCircle: ObstacleCircleVisitor,
    // Include neighboring buckets when a collision shape is wider than the line.
    padding = 0,
  ): void {
    if (this.needsRebuild()) this.rebuild();
    if (this.bucketCols === 0 || this.bucketRows === 0) return;

    const queryPadding = Math.max(0, padding);
    const dx = x2 - x1;
    const dy = y2 - y1;

    const minX = (dx < 0 ? x2 : x1) - queryPadding;
    const maxX = (dx < 0 ? x1 : x2) + queryPadding;
    const minY = (dy < 0 ? y2 : y1) - queryPadding;
    const maxY = (dy < 0 ? y1 : y2) + queryPadding;

    const minCol = Math.max(0, Math.floor((minX - this.originX) / BUCKET_SIZE));
    const maxCol = Math.min(this.bucketCols - 1, Math.floor((maxX - this.originX) / BUCKET_SIZE));
    const minRow = Math.max(0, Math.floor((minY - this.originY) / BUCKET_SIZE));
    const maxRow = Math.min(this.bucketRows - 1, Math.floor((maxY - this.originY) / BUCKET_SIZE));
    if (minCol > maxCol || minRow > maxRow) return;

    // Ein Hindernis kann in mehreren Buckets liegen; ein Stempel pro Query genügt, damit
    // der Besucher es nur einmal sieht.
    const stamp = ++this.queryStamp;

    for (let row = minRow; row <= maxRow; row += 1) {
      const bucketTop = this.originY + row * BUCKET_SIZE;
      for (let col = minCol; col <= maxCol; col += 1) {
        const bucketLeft = this.originX + col * BUCKET_SIZE;
        // Die Bounding-Box des Segments deckt bei diagonalen Schüssen deutlich mehr
        // Buckets ab als das Segment wirklich kreuzt – der Slab-Test siebt sie aus.
        if (!overlapsBox(
          x1, y1, dx, dy,
          bucketLeft - queryPadding,
          bucketTop - queryPadding,
          bucketLeft + BUCKET_SIZE + queryPadding,
          bucketTop + BUCKET_SIZE + queryPadding,
        )) continue;

        const bucket = row * this.bucketCols + col;
        const start = this.bucketStart[bucket];
        const end = this.bucketStart[bucket + 1];
        for (let i = start; i < end; i += 1) {
          const entry = this.bucketEntries[i];
          if (this.entryStamp[entry] === stamp) continue;
          this.entryStamp[entry] = stamp;

          if (entry < this.rectCount) {
            if (!this.rectSource[entry]?.active) continue;
            const offset = entry * 4;
            const stop = visitRect(
              this.rectKind[entry] as typeof OBSTACLE_ROCK | typeof OBSTACLE_BASE,
              this.rectRockIndex[entry],
              this.rectData[offset],
              this.rectData[offset + 1],
              this.rectData[offset + 2],
              this.rectData[offset + 3],
            );
            if (stop) return;
          } else {
            const circle = entry - this.rectCount;
            if (!this.circleSource[circle]?.active) continue;
            const offset = circle * 3;
            const stop = visitCircle(
              this.circleData[offset],
              this.circleData[offset + 1],
              this.circleData[offset + 2],
            );
            if (stop) return;
          }
        }
      }
    }
  }

  private needsRebuild(): boolean {
    if (this.dirty) return true;
    const rocks = this.sources.rocks();
    const trunks = this.sources.trunks();
    const bases = this.sources.bases();
    return rocks !== this.builtRocks
      || trunks !== this.builtTrunks
      || bases !== this.builtBases
      || (rocks?.length ?? -1) !== this.builtRockLength
      || (trunks?.length ?? -1) !== this.builtTrunkLength
      || (bases?.length ?? -1) !== this.builtBaseLength;
  }

  private rebuild(): void {
    this.dirty = false;
    this.collectObstacles();
    this.buildBuckets();
  }

  private collectObstacles(): void {
    const rocks = this.sources.rocks();
    const trunks = this.sources.trunks();
    const bases = this.sources.bases();
    this.builtRocks = rocks;
    this.builtTrunks = trunks;
    this.builtBases = bases;
    this.builtRockLength = rocks?.length ?? -1;
    this.builtTrunkLength = trunks?.length ?? -1;
    this.builtBaseLength = bases?.length ?? -1;

    // Inaktive, aber noch vorhandene Objekte kommen mit in den Index: ihr `active` wird
    // beim Query gelesen, und ein wieder aktiviertes Objekt braucht so keinen Neubau.
    let rectCount = 0;
    for (const rock of rocks ?? []) if (rock) rectCount += 1;
    for (const base of bases ?? []) if (base) rectCount += 1;
    let circleCount = 0;
    for (const trunk of trunks ?? []) if (trunk) circleCount += 1;

    if (this.rectData.length < rectCount * 4) this.rectData = new Float64Array(rectCount * 4);
    if (this.rectKind.length < rectCount) this.rectKind = new Uint8Array(rectCount);
    if (this.rectRockIndex.length < rectCount) this.rectRockIndex = new Int32Array(rectCount);
    if (this.circleData.length < circleCount * 3) this.circleData = new Float64Array(circleCount * 3);
    this.rectCount = rectCount;
    this.circleCount = circleCount;
    this.rectSource.length = rectCount;
    this.circleSource.length = circleCount;

    let rectIndex = 0;
    const rockList = rocks ?? [];
    for (let i = 0; i < rockList.length; i += 1) {
      const rock = rockList[i];
      if (!rock) continue;
      this.rectKind[rectIndex] = OBSTACLE_ROCK;
      this.rectRockIndex[rectIndex] = i;
      this.rectSource[rectIndex] = rock;
      this.writeRect(rectIndex, rock);
      rectIndex += 1;
    }
    for (const base of bases ?? []) {
      if (!base) continue;
      this.rectKind[rectIndex] = OBSTACLE_BASE;
      this.rectRockIndex[rectIndex] = -1;
      this.rectSource[rectIndex] = base;
      this.writeRect(rectIndex, base);
      rectIndex += 1;
    }

    let circleIndex = 0;
    for (const trunk of trunks ?? []) {
      if (!trunk) continue;
      const offset = circleIndex * 3;
      this.circleData[offset] = trunk.x;
      this.circleData[offset + 1] = trunk.y;
      this.circleData[offset + 2] = trunk.radius;
      this.circleSource[circleIndex] = trunk;
      circleIndex += 1;
    }
  }

  private writeRect(
    rectIndex: number,
    source: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle,
  ): void {
    // Beim ersten Aufruf legt Phaser das Rechteck an, danach wird es wiederbefüllt.
    const bounds = this.scratchBounds
      ? source.getBounds(this.scratchBounds)
      : (this.scratchBounds = source.getBounds());
    const offset = rectIndex * 4;
    this.rectData[offset] = bounds.left;
    this.rectData[offset + 1] = bounds.top;
    this.rectData[offset + 2] = bounds.right;
    this.rectData[offset + 3] = bounds.bottom;
  }

  private buildBuckets(): void {
    // Das Raster spannt die Arena **und** jedes tatsächlich vorhandene Hindernis auf.
    // Nur die Arena zu nehmen wäre eine stille Falle: `ARENA_WIDTH` ist zur Laufzeit
    // veränderlich (breite Coop-Karten), und ein Hindernis außerhalb des Rasters würde
    // beim Einsortieren weggeklemmt – es verschwände lautlos aus jeder Kollisionsprüfung.
    let minX = ARENA_OFFSET_X;
    let minY = ARENA_OFFSET_Y;
    let maxX = ARENA_OFFSET_X + ARENA_WIDTH;
    let maxY = ARENA_OFFSET_Y + ARENA_HEIGHT;
    for (let rect = 0; rect < this.rectCount; rect += 1) {
      const offset = rect * 4;
      if (this.rectData[offset] < minX) minX = this.rectData[offset];
      if (this.rectData[offset + 1] < minY) minY = this.rectData[offset + 1];
      if (this.rectData[offset + 2] > maxX) maxX = this.rectData[offset + 2];
      if (this.rectData[offset + 3] > maxY) maxY = this.rectData[offset + 3];
    }
    for (let circle = 0; circle < this.circleCount; circle += 1) {
      const offset = circle * 3;
      const radius = this.circleData[offset + 2];
      if (this.circleData[offset] - radius < minX) minX = this.circleData[offset] - radius;
      if (this.circleData[offset + 1] - radius < minY) minY = this.circleData[offset + 1] - radius;
      if (this.circleData[offset] + radius > maxX) maxX = this.circleData[offset] + radius;
      if (this.circleData[offset + 1] + radius > maxY) maxY = this.circleData[offset + 1] + radius;
    }

    // Ein Bucket Rand fängt Hindernisse genau auf der Außenkante ab.
    this.originX = minX - BUCKET_SIZE;
    this.originY = minY - BUCKET_SIZE;
    this.bucketCols = Math.ceil((maxX - minX) / BUCKET_SIZE) + 3;
    this.bucketRows = Math.ceil((maxY - minY) / BUCKET_SIZE) + 3;

    const bucketTotal = this.bucketCols * this.bucketRows;
    const entryTotal = this.rectCount + this.circleCount;
    if (this.bucketStart.length < bucketTotal + 1) {
      this.bucketStart = new Int32Array(bucketTotal + 1);
    } else {
      this.bucketStart.fill(0, 0, bucketTotal + 1);
    }
    // Nie zurücksetzen: der Zähler wächst monoton, damit stehengebliebene Stempel aus
    // einem wiederverwendeten Puffer nie mit einem neuen Query kollidieren.
    if (this.entryStamp.length < entryTotal) this.entryStamp = new Int32Array(entryTotal);

    // Zählen, Prefix-Summe, Füllen – ein CSR-Aufbau ohne Arrays pro Bucket.
    const countVisitor = (bucket: number): void => { this.bucketStart[bucket + 1] += 1; };
    let spanTotal = 0;
    for (let entry = 0; entry < entryTotal; entry += 1) {
      spanTotal += this.visitEntryBuckets(entry, countVisitor);
    }
    for (let bucket = 0; bucket < bucketTotal; bucket += 1) {
      this.bucketStart[bucket + 1] += this.bucketStart[bucket];
    }

    if (this.bucketEntries.length < spanTotal) this.bucketEntries = new Int32Array(spanTotal);
    const cursor = new Int32Array(bucketTotal);
    let fillEntry = 0;
    const fillVisitor = (bucket: number): void => {
      this.bucketEntries[this.bucketStart[bucket] + cursor[bucket]] = fillEntry;
      cursor[bucket] += 1;
    };
    for (fillEntry = 0; fillEntry < entryTotal; fillEntry += 1) {
      this.visitEntryBuckets(fillEntry, fillVisitor);
    }
  }

  /** Ruft `visit` für jeden Bucket auf, den das Hindernis überdeckt, und liefert deren Anzahl. */
  private visitEntryBuckets(entry: number, visit: (bucket: number) => void): number {
    let left: number;
    let top: number;
    let right: number;
    let bottom: number;

    if (entry < this.rectCount) {
      const offset = entry * 4;
      left = this.rectData[offset];
      top = this.rectData[offset + 1];
      right = this.rectData[offset + 2];
      bottom = this.rectData[offset + 3];
    } else {
      const offset = (entry - this.rectCount) * 3;
      const radius = this.circleData[offset + 2];
      left = this.circleData[offset] - radius;
      top = this.circleData[offset + 1] - radius;
      right = this.circleData[offset] + radius;
      bottom = this.circleData[offset + 1] + radius;
    }

    const minCol = Math.max(0, Math.floor((left - this.originX) / BUCKET_SIZE));
    const maxCol = Math.min(this.bucketCols - 1, Math.floor((right - this.originX) / BUCKET_SIZE));
    const minRow = Math.max(0, Math.floor((top - this.originY) / BUCKET_SIZE));
    const maxRow = Math.min(this.bucketRows - 1, Math.floor((bottom - this.originY) / BUCKET_SIZE));
    if (minCol > maxCol || minRow > maxRow) return 0;

    let count = 0;
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        visit(row * this.bucketCols + col);
        count += 1;
      }
    }
    return count;
  }
}
