/**
 * Raeumlicher Bucket-Index fuer statische Weltpunkt-Platzierungen.
 *
 * Der Index speichert nur die Position der Eintraege in der Quellliste. Die Platzierungen selbst
 * bleiben damit unveraendert und koennen direkt an die bestehenden Stamp-/Image-Fabriken gereicht
 * werden. `collect` liefert bewusst eine Obermenge: Der Aufrufer fragt mit einem konservativen
 * Radius ab und prueft danach die tatsaechliche Ausdehnung der Platzierung exakt.
 *
 * Anders als `ArenaCellBucketIndex` arbeitet diese Variante mit Weltpunkten statt Rasterzellen.
 * Das ist fuer deterministische Ground-Cover-, Moos-, Vegetations- und Decal-Platzierungen
 * noetig, die absichtlich neben ihrer Ankerzelle liegen koennen.
 */

export interface ArenaWorldPoint {
  readonly x: number;
  readonly y: number;
}

export type ArenaPointAccessor<T> = (entry: T) => ArenaWorldPoint;

export class ArenaPointBucketIndex<T> {
  private readonly buckets = new Map<number, number[]>();
  /** Wieviele Eintraege der Quellliste bereits indiziert sind. */
  private indexedCount = 0;
  private readonly cols: number;
  private readonly rows: number;

  constructor(
    private readonly frame: ChunkWorldFrame,
    private readonly pointOf: ArenaPointAccessor<T>,
    private readonly bucketSizePx = ROCK_OVERLAY_CHUNK_SIZE,
  ) {
    if (bucketSizePx <= 0) {
      throw new Error(`[ArenaPointBucketIndex] bucketSizePx ${bucketSizePx} must be positive`);
    }
    this.cols = Math.max(1, Math.ceil(frame.width / bucketSizePx));
    this.rows = Math.max(1, Math.ceil(frame.height / bucketSizePx));
  }

  get size(): number {
    return this.indexedCount;
  }

  /** Nimmt alle noch nicht indizierten Eintraege auf. Idempotent und im Normalfall ein No-op. */
  sync(entries: readonly (T | undefined)[]): void {
    for (let index = this.indexedCount; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry === undefined) continue;
      const point = this.pointOf(entry);
      const key = this.bucketKey(point.x, point.y);
      const bucket = this.buckets.get(key);
      if (bucket) bucket.push(index);
      else this.buckets.set(key, [index]);
    }
    this.indexedCount = entries.length;
  }

  clear(): void {
    this.buckets.clear();
    this.indexedCount = 0;
  }

  /**
   * Alle Indizes, deren Mittelpunkt im um `reachPx` erweiterten lokalen Regionsquadrat liegt.
   *
   * Die lokale Region wird intern in Weltkoordinaten umgerechnet, damit der Arena-Offset nur an
   * dieser Grenze beruehrt wird. `out` wird geleert und kann je Streamer wiederverwendet werden.
   */
  collect(
    localX: number,
    localY: number,
    size: number,
    reachPx: number,
    out: number[] = [],
  ): number[] {
    return this.collectWorldRect(
      this.frame.offsetX + localX - reachPx,
      this.frame.offsetY + localY - reachPx,
      this.frame.offsetX + localX + size + reachPx,
      this.frame.offsetY + localY + size + reachPx,
      out,
    );
  }

  /** Wie {@link collect}, aber mit einem beliebigen Weltrechteck. */
  collectWorldRect(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    out: number[] = [],
  ): number[] {
    out.length = 0;
    this.forEachBucketInWorldRect(minX, minY, maxX, maxY, (_key, entries) => {
      for (const index of entries) out.push(index);
    });
    return out;
  }

  private forEachBucketInWorldRect(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    visit: (key: number, entries: readonly number[]) => void,
  ): void {
    const minBucketX = Math.max(0, Math.floor((minX - this.frame.offsetX) / this.bucketSizePx));
    const minBucketY = Math.max(0, Math.floor((minY - this.frame.offsetY) / this.bucketSizePx));
    // Die Grenzen werden geklemmt, weil der Query-Gutter bewusst ueber den Arenarahmen hinaus
    // ragen darf und Punkte knapp ausserhalb des Rahmens im Randbucket liegen.
    const maxBucketX = Math.min(
      this.cols - 1,
      Math.floor((maxX - this.frame.offsetX) / this.bucketSizePx),
    );
    const maxBucketY = Math.min(
      this.rows - 1,
      Math.floor((maxY - this.frame.offsetY) / this.bucketSizePx),
    );
    if (minBucketX > maxBucketX || minBucketY > maxBucketY) return;

    for (let bucketY = minBucketY; bucketY <= maxBucketY; bucketY += 1) {
      for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX += 1) {
        const key = bucketY * this.cols + bucketX;
        const entries = this.buckets.get(key);
        if (entries) visit(key, entries);
      }
    }
  }

  private bucketKey(worldX: number, worldY: number): number {
    const bucketX = Math.max(
      0,
      Math.min(this.cols - 1, Math.floor((worldX - this.frame.offsetX) / this.bucketSizePx)),
    );
    const bucketY = Math.max(
      0,
      Math.min(this.rows - 1, Math.floor((worldY - this.frame.offsetY) / this.bucketSizePx)),
    );
    return bucketY * this.cols + bucketX;
  }
}
import { ROCK_OVERLAY_CHUNK_SIZE } from '../RockOverlayRegions';
import type { ChunkWorldFrame } from './ArenaChunkGrid';
