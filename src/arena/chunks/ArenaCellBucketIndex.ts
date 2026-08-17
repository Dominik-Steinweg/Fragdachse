import { CELL_SIZE } from '../../config';
import { ROCK_OVERLAY_CHUNK_SIZE } from '../RockOverlayRegions';

/**
 * Raeumlicher Bucket-Index ueber eine wachsende Zellliste.
 *
 * Die Bake-Pfade der gestreamten Weltschichten stellen immer dieselbe Frage: "Welche Zellen
 * koennen in dieses Quadrat hineinwirken?" Ohne Index beantwortet man sie mit einem Durchlauf
 * ueber den gesamten Bestand – auf einer 400 x 80-Karte sind das rund 29 000 Zellen **je Region**.
 * Bei einer Flaechenzerstoerung mit dutzenden Dirty-Chunks summiert sich das zu Millionen von
 * Vergleichen und war im Trace als mehrere hundert Millisekunden im `POST_UPDATE` sichtbar.
 *
 * Der Index ist bewusst minimal:
 *
 * - **Additiv.** {@link sync} nimmt nur die seit dem letzten Aufruf hinzugekommenen Eintraege auf.
 *   Zerstoerte Felsen bleiben drin; die Bake-Pfade filtern ohnehin selbst, und die Materialquelle
 *   darf gar nicht schrumpfen (siehe {@link ../RockOverlayRegions}).
 * - **Konservativ.** {@link collect} liefert eine Obermenge: Jede Zelle, deren Quadrat das
 *   erweiterte Rechteck beruehren *koennte*. Den genauen Test macht der Aufrufer, der ihn ohnehin
 *   schon hatte – so kann der Index keine Auswahlregel verschieben.
 * - **Ohne Phaser.** Damit direkt testbar, wie {@link ../RockOverlayRegions}.
 */

const EMPTY_BUCKET: readonly number[] = [];

export interface IndexedCell {
  readonly gridX: number;
  readonly gridY: number;
}

export class ArenaCellBucketIndex {
  private readonly buckets = new Map<number, number[]>();
  /** Wieviele Eintraege der Quellliste bereits indiziert sind. */
  private indexedCount = 0;
  private readonly cols: number;

  constructor(
    frameWidthPx: number,
    private readonly bucketSizePx: number = ROCK_OVERLAY_CHUNK_SIZE,
  ) {
    if (bucketSizePx % CELL_SIZE !== 0) {
      // Sonst koennte eine Zelle ueber zwei Buckets liegen und die Suche muesste beide Faelle
      // kennen. Mit einem Vielfachen der Zellgroesse liegt jede Zelle in genau einem Bucket.
      throw new Error(`[ArenaCellBucketIndex] bucketSizePx ${bucketSizePx} must be a multiple of ${CELL_SIZE}`);
    }
    this.cols = Math.max(1, Math.ceil(frameWidthPx / bucketSizePx));
  }

  get size(): number {
    return this.indexedCount;
  }

  /** Nimmt alle noch nicht indizierten Eintraege auf. Idempotent und im Normalfall ein No-op. */
  sync(cells: readonly (IndexedCell | undefined)[]): void {
    for (let index = this.indexedCount; index < cells.length; index += 1) {
      const cell = cells[index];
      if (!cell) continue;
      const key = this.bucketKey(cell.gridX, cell.gridY);
      const bucket = this.buckets.get(key);
      if (bucket) bucket.push(index);
      else this.buckets.set(key, [index]);
    }
    this.indexedCount = cells.length;
  }

  clear(): void {
    this.buckets.clear();
    this.indexedCount = 0;
  }

  /**
   * Alle Indizes, deren Zelle das um `reachPx` erweiterte Rechteck beruehren koennte.
   *
   * `out` wird geleert und zurueckgegeben; der Aufrufer kann denselben Puffer wiederverwenden und
   * spart damit eine Allokation je Region.
   */
  collect(
    localX: number,
    localY: number,
    size: number,
    reachPx: number,
    out: number[] = [],
  ): number[] {
    return this.collectRect(
      localX - reachPx,
      localY - reachPx,
      localX + size + reachPx,
      localY + size + reachPx,
      out,
    );
  }

  /** Wie {@link collect}, aber fuer ein beliebiges rahmenlokales Rechteck. */
  collectRect(minX: number, minY: number, maxX: number, maxY: number, out: number[] = []): number[] {
    out.length = 0;
    this.forEachBucketInRect(minX, minY, maxX, maxY, (_key, entries) => {
      for (const index of entries) out.push(index);
    });
    return out;
  }

  /** Die Schluessel aller Buckets, die das Rechteck beruehren – Grundlage einer Delta-Auswertung. */
  collectBucketKeys(minX: number, minY: number, maxX: number, maxY: number, out: number[] = []): number[] {
    out.length = 0;
    this.forEachBucketInRect(minX, minY, maxX, maxY, (key) => out.push(key), true);
    return out;
  }

  getBucket(key: number): readonly number[] | undefined {
    return this.buckets.get(key);
  }

  /** Der Bucket, in dem eine einzelne Zelle liegt. */
  bucketOf(gridX: number, gridY: number): number {
    return this.bucketKey(gridX, gridY);
  }

  private forEachBucketInRect(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    visit: (key: number, entries: readonly number[]) => void,
    includeEmpty = false,
  ): void {
    const minBucketX = Math.max(0, Math.floor(minX / this.bucketSizePx));
    const minBucketY = Math.max(0, Math.floor(minY / this.bucketSizePx));
    // Geklemmt, weil die Zeilenbreite `cols` in den Schluessel eingeht: Eine Spalte jenseits des
    // Rasters traefe sonst den Schluessel der naechsten Zeile.
    const maxBucketX = Math.min(this.cols - 1, Math.floor(maxX / this.bucketSizePx));
    const maxBucketY = Math.floor(maxY / this.bucketSizePx);
    if (minBucketX > maxBucketX || minBucketY > maxBucketY) return;

    for (let bucketY = minBucketY; bucketY <= maxBucketY; bucketY += 1) {
      for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX += 1) {
        const key = bucketY * this.cols + bucketX;
        const entries = this.buckets.get(key);
        if (entries) visit(key, entries);
        else if (includeEmpty) visit(key, EMPTY_BUCKET);
      }
    }
  }

  private bucketKey(gridX: number, gridY: number): number {
    const bucketX = Math.max(0, Math.min(this.cols - 1, Math.floor((gridX * CELL_SIZE) / this.bucketSizePx)));
    const bucketY = Math.max(0, Math.floor((gridY * CELL_SIZE) / this.bucketSizePx));
    return bucketY * this.cols + bucketX;
  }
}
