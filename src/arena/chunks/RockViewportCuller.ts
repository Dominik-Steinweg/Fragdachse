import type * as Phaser from 'phaser';
import { ArenaCellBucketIndex } from './ArenaCellBucketIndex';
import { ARENA_RENDER_CHUNK_ACQUIRE_MARGIN_PX, worldRectToLocalRect } from './ArenaChunkGrid';
import type { ChunkLocalRect, ChunkWorldFrame, ChunkWorldRect } from './ArenaChunkGrid';
import type { RockLayerGrid } from './RockLayerGrid';

/**
 * Zweistufiges Culling des Felsbestands.
 *
 * Phaser 4 kennt keine Kamera-Bounds-Cullung auf Objektebene: `GameObject.willRender()` prueft nur
 * Renderflags und Kamerafilter. Ohne Cullung laeuft jedes Fels-Image pro Frame durch den kompletten
 * Renderpfad – Transform, Tint, Quad, Batch.
 *
 * Deshalb zwei Stufen, die dasselbe Rechteck benutzen:
 *
 * 1. **Grob, je 512-px-Ebene.** Eine Ebene ausserhalb des Ausschnitts wird unsichtbar geschaltet;
 *    der Renderer betritt sie dann gar nicht und ihre Kinder kosten nichts – nicht einmal den
 *    `willRender()`-Aufruf. Das ist der Unterschied zu einer einzigen grossen Ebene, deren Kinder
 *    Phaser trotz `visible = false` weiterhin einzeln durchlaeuft.
 * 2. **Fein, je 128-px-Bucket.** Innerhalb der kameranahen Ebenen entscheidet weiterhin
 *    `visible` je Fels, damit der Rand einer gerade noch sichtbaren Ebene keine ganze Chunkbreite
 *    an Quads mitschleppt.
 *
 * Beide Stufen lesen dasselbe erweiterte Rechteck, und das Quadrat eines Buckets liegt immer
 * vollstaendig in dem seiner Ebene. Ein Bucket verlaesst den Ausschnitt damit nie spaeter als seine
 * Ebene – die beiden Stufen koennen nicht auseinanderlaufen.
 *
 * Umgeschaltet wird nur, was sich tatsaechlich aendert: Beide Stufen halten ihre aktuelle Menge und
 * fassen ausschliesslich Zu- und Abgaenge an. Steht die Kamera still, macht ein Update gar nichts;
 * einen Vollscan ueber alle Felsen gibt es in keinem Frame.
 */
export class RockViewportCuller {
  private readonly index: ArenaCellBucketIndex;
  private visibleBuckets = new Set<number>();
  private visibleLayers = new Set<number>();
  private readonly bucketKeyBuffer: number[] = [];

  constructor(
    private readonly frame: ChunkWorldFrame,
    private readonly rocks: readonly ({ readonly gridX: number; readonly gridY: number } | undefined)[],
    private readonly rockObjects: readonly (Phaser.GameObjects.Image | null)[],
    private readonly layerGrid: RockLayerGrid,
  ) {
    this.index = new ArenaCellBucketIndex(frame.width);
    this.index.sync(this.rocks);
    // Ausgangszustand: alles versteckt. Beide Stufen schalten danach nur noch Deltas um und
    // liessen sonst jeden Fels ausserhalb des ersten Ausschnitts sichtbar stehen.
    for (const key of this.layerGrid.keys()) this.layerGrid.setLayerVisible(key, false);
    for (const image of this.rockObjects) image?.setVisible(false);
  }

  /** Gleicht beide Stufen an den Kameraausschnitt an. */
  update(view: ChunkWorldRect): void {
    this.index.sync(this.rocks);
    const local = worldRectToLocalRect(view, this.frame);
    const margin = ARENA_RENDER_CHUNK_ACQUIRE_MARGIN_PX;
    const rect: ChunkLocalRect = {
      localX: local.localX - margin,
      localY: local.localY - margin,
      width: local.width + margin * 2,
      height: local.height + margin * 2,
    };

    // Erst die Buckets bestimmen, dann die Ebenen **daraus** ableiten. Beide Stufen aus demselben
    // Rechteck getrennt zu berechnen hat genau eine Klasse stiller Fehler erzeugt: Rasterabfragen
    // koennen an der Kante unterschiedlich runden, und ein sichtbarer Fels in einer unsichtbaren
    // Ebene faellt erst auf, wenn die Ebene spaeter aufgeht und er dort ploetzlich auftaucht.
    const wantedBuckets = this.collectWantedBuckets(rect);
    this.syncLayers(this.layerKeysOf(wantedBuckets));
    this.syncBuckets(wantedBuckets);
  }

  /**
   * Uebernimmt den Sichtbarkeitszustand fuer einen zur Laufzeit gebauten Fels.
   *
   * Ohne diesen Aufruf bliebe ein neu gesetzter Fels ausserhalb des Ausschnitts sichtbar, bis sein
   * Bucket das naechste Mal umschaltet.
   */
  applyTo(image: Phaser.GameObjects.Image, gridX: number, gridY: number): void {
    image.setVisible(this.visibleBuckets.has(this.index.bucketOf(gridX, gridY)));
  }

  /** Wieviele Ebenen und Buckets gerade sichtbar sind – fuer Diagnose und Tests. */
  getStats(): { visibleLayers: number; visibleBuckets: number; totalLayers: number } {
    return {
      visibleLayers: this.visibleLayers.size,
      visibleBuckets: this.visibleBuckets.size,
      totalLayers: this.layerGrid.layerCount,
    };
  }

  private collectWantedBuckets(rect: ChunkLocalRect): Set<number> {
    return new Set(this.index.collectBucketKeys(
      rect.localX,
      rect.localY,
      rect.localX + rect.width,
      rect.localY + rect.height,
      this.bucketKeyBuffer,
    ));
  }

  /**
   * Die Ebenen der gewuenschten Buckets.
   *
   * Ein 128-px-Bucket liegt immer vollstaendig in genau einer 512-px-Ebene, der erste Fels des
   * Buckets nennt sie also eindeutig. Leere Buckets bleiben aussen vor: Eine Ebene ohne sichtbaren
   * Fels braucht der Renderer nicht zu betreten.
   */
  private layerKeysOf(wantedBuckets: ReadonlySet<number>): Set<number> {
    const keys = new Set<number>();
    for (const bucket of wantedBuckets) {
      const entries = this.index.getBucket(bucket);
      const cell = entries && entries.length > 0 ? this.rocks[entries[0]] : undefined;
      if (cell) keys.add(this.layerGrid.keyOf(cell.gridX, cell.gridY));
    }
    return keys;
  }

  private syncLayers(wanted: Set<number>): void {
    for (const key of this.visibleLayers) {
      if (!wanted.has(key)) this.layerGrid.setLayerVisible(key, false);
    }
    for (const key of wanted) {
      if (!this.visibleLayers.has(key)) this.layerGrid.setLayerVisible(key, true);
    }
    this.visibleLayers = wanted;
  }

  private syncBuckets(wanted: Set<number>): void {
    for (const key of this.visibleBuckets) {
      if (!wanted.has(key)) this.setBucketVisible(key, false);
    }
    for (const key of wanted) {
      if (!this.visibleBuckets.has(key)) this.setBucketVisible(key, true);
    }
    this.visibleBuckets = wanted;
  }

  private setBucketVisible(key: number, visible: boolean): void {
    const entries = this.index.getBucket(key);
    if (!entries) return;
    for (const id of entries) {
      const image = this.rockObjects[id];
      // `active` bleibt die Wahrheit ueber "steht dieser Fels noch"; Sichtbarkeit ist rein lokal.
      if (image?.active) image.setVisible(visible);
    }
  }
}
