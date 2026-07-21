// Nur Typ-Import: dieses Modul soll ohne Phaser-Laufzeit (und damit ohne DOM) nutzbar
// und testbar bleiben. Alle Phaser-Aufrufe laufen über die übergebenen Objekte.
import type * as Phaser from 'phaser';
import {
  ARENA_HEIGHT,
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  ARENA_WIDTH,
} from '../config';

const BUCKET_SIZE = 128;

export interface LightOccluderSources {
  /** Paralleles Array zu `layout.rocks` – `null`/inaktiv bedeutet zerstört. */
  readonly rocks: () => readonly (Phaser.GameObjects.Image | null)[] | null;
  /** Baumstämme als Kreis-Occluder. */
  readonly trunks: () => readonly Phaser.GameObjects.Arc[] | null;
  /** Zell-Rechtecke lebender Basen; zerstörte Basen liefern bereits nichts mehr. */
  readonly baseCells: () => readonly Phaser.GameObjects.Rectangle[] | null;
  /**
   * Zähler, der sich ändert, sobald eine Basis zerstört wird. Felsen und Turrets melden
   * sich über `markDirty()` am gemeinsamen Trichter
   * (`RockVisualHelper.refreshObstacleVisuals()`); Basen haben keinen solchen Trichter,
   * deshalb erkennt der Index deren Wegfall über diesen Zähler.
   */
  readonly baseGeneration: () => number;
}

export type RectOccluderVisitor = (
  left: number, top: number, right: number, bottom: number,
) => void;

export type CircleOccluderVisitor = (
  centerX: number, centerY: number, radius: number,
) => void;

/**
 * Räumlicher Index der lichtblockierenden Hindernisse einer Runde.
 *
 * Bewusst ein reiner Cache und kein zweiter Bestand: gebaut wird ausschließlich aus
 * denselben Referenzen, die `CombatSystem` für Hitscan und Line-of-Sight nutzt
 * (`arenaResult.rockObjects`, `arenaResult.trunkObjects`,
 * `BaseManager.getObstacleRectangles()`). Ein zerstörter Fels verschwindet damit
 * zwangsläufig auch aus der Lichtverdeckung – es gibt keine eigene Liste, die
 * auseinanderlaufen könnte.
 *
 * Neu gebaut wird nur nach `markDirty()`, also an denselben Ereignissen, die auch die
 * statischen Sonnenschatten neu zeichnen (`RockVisualHelper.refreshObstacleVisuals()`).
 */
export class LightOccluderIndex {
  /** Rechteck-Occluder als flaches [l,t,r,b]. */
  private rectData = new Float64Array(0);
  private rectCount = 0;
  /** Kreis-Occluder als flaches [cx,cy,r]. */
  private circleData = new Float64Array(0);
  private circleCount = 0;

  // Bucket-Grid im CSR-Layout: bucketStart[i]..bucketStart[i+1] indiziert `bucketEntries`.
  private bucketStart = new Int32Array(1);
  private bucketEntries = new Int32Array(0);
  private bucketCols = 0;
  private bucketRows = 0;
  private originX = 0;
  private originY = 0;

  // Ein Occluder liegt oft in mehreren Buckets. `queryStamp` zählt monoton hoch, damit
  // dieselbe Query denselben Occluder nur einmal besucht – ohne Set und ohne Clear-Pass.
  private queryStamp = 0;
  private entryStamp = new Int32Array(0);

  private dirty = true;
  private builtBaseGeneration = -1;
  /** Lazy vom ersten Occluder erzeugt, danach wiederverwendet (siehe `writeRect`). */
  private scratchBounds: Phaser.Geom.Rectangle | null = null;

  constructor(private readonly sources: LightOccluderSources) {}

  markDirty(): void {
    this.dirty = true;
  }

  /**
   * Besucht alle Occluder, die den Lichtkreis schneiden könnten.
   * Die Bucket-Vorauswahl ist konservativ; die exakte Verdeckung entsteht erst beim
   * Zeichnen der Schattenpolygone.
   */
  queryCircle(
    x: number, y: number, radius: number,
    visitRect: RectOccluderVisitor,
    visitCircle: CircleOccluderVisitor,
  ): void {
    if (this.dirty || this.sources.baseGeneration() !== this.builtBaseGeneration) this.rebuild();
    if (this.bucketCols === 0 || this.bucketRows === 0) return;

    const minCol = Math.max(0, Math.floor((x - radius - this.originX) / BUCKET_SIZE));
    const maxCol = Math.min(this.bucketCols - 1, Math.floor((x + radius - this.originX) / BUCKET_SIZE));
    const minRow = Math.max(0, Math.floor((y - radius - this.originY) / BUCKET_SIZE));
    const maxRow = Math.min(this.bucketRows - 1, Math.floor((y + radius - this.originY) / BUCKET_SIZE));
    if (minCol > maxCol || minRow > maxRow) return;

    // Ein Occluder kann in mehreren Buckets liegen; Mehrfachbesuche würden nur
    // identische Polygone doppelt zeichnen, deshalb reicht ein Stempel pro Query.
    const stamp = ++this.queryStamp;

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const bucket = row * this.bucketCols + col;
        const start = this.bucketStart[bucket];
        const end = this.bucketStart[bucket + 1];
        for (let i = start; i < end; i += 1) {
          const entry = this.bucketEntries[i];
          if (this.entryStamp[entry] === stamp) continue;
          this.entryStamp[entry] = stamp;

          if (entry < this.rectCount) {
            const offset = entry * 4;
            visitRect(
              this.rectData[offset],
              this.rectData[offset + 1],
              this.rectData[offset + 2],
              this.rectData[offset + 3],
            );
          } else {
            const offset = (entry - this.rectCount) * 3;
            visitCircle(
              this.circleData[offset],
              this.circleData[offset + 1],
              this.circleData[offset + 2],
            );
          }
        }
      }
    }
  }

  private rebuild(): void {
    this.dirty = false;
    this.builtBaseGeneration = this.sources.baseGeneration();
    this.collectOccluders();
    this.buildBuckets();
  }

  private collectOccluders(): void {
    const rocks = this.sources.rocks() ?? [];
    const trunks = this.sources.trunks() ?? [];
    const baseCells = this.sources.baseCells() ?? [];

    let rectCount = 0;
    for (const rock of rocks) if (rock?.active) rectCount += 1;
    for (const cell of baseCells) if (cell.active) rectCount += 1;
    let circleCount = 0;
    for (const trunk of trunks) if (trunk.active) circleCount += 1;

    if (this.rectData.length < rectCount * 4) this.rectData = new Float64Array(rectCount * 4);
    if (this.circleData.length < circleCount * 3) this.circleData = new Float64Array(circleCount * 3);
    this.rectCount = rectCount;
    this.circleCount = circleCount;

    let rectOffset = 0;
    for (const rock of rocks) {
      if (!rock?.active) continue;
      rectOffset = this.writeRect(rectOffset, rock);
    }
    for (const cell of baseCells) {
      if (!cell.active) continue;
      rectOffset = this.writeRect(rectOffset, cell);
    }

    let circleOffset = 0;
    for (const trunk of trunks) {
      if (!trunk.active) continue;
      this.circleData[circleOffset] = trunk.x;
      this.circleData[circleOffset + 1] = trunk.y;
      this.circleData[circleOffset + 2] = trunk.radius;
      circleOffset += 3;
    }
  }

  private writeRect(
    offset: number,
    source: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle,
  ): number {
    // Beim ersten Aufruf legt Phaser das Rechteck an, danach wird es wiederbefüllt.
    const bounds = this.scratchBounds
      ? source.getBounds(this.scratchBounds)
      : (this.scratchBounds = source.getBounds());
    this.rectData[offset] = bounds.left;
    this.rectData[offset + 1] = bounds.top;
    this.rectData[offset + 2] = bounds.right;
    this.rectData[offset + 3] = bounds.bottom;
    return offset + 4;
  }

  private buildBuckets(): void {
    // Der Zug und Placeables bleiben innerhalb der Arena; ein Rand von einem Bucket
    // fängt Hindernisse auf der Außenkante ab.
    this.originX = ARENA_OFFSET_X - BUCKET_SIZE;
    this.originY = ARENA_OFFSET_Y - BUCKET_SIZE;
    this.bucketCols = Math.ceil(ARENA_WIDTH / BUCKET_SIZE) + 2;
    this.bucketRows = Math.ceil(ARENA_HEIGHT / BUCKET_SIZE) + 2;

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

    if (this.bucketEntries.length < spanTotal) {
      this.bucketEntries = new Int32Array(spanTotal);
    }
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

  /** Ruft `visit` für jeden Bucket auf, den der Occluder überdeckt, und liefert deren Anzahl. */
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
