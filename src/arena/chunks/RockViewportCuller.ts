import type * as Phaser from 'phaser';
import type { RockCell } from '../../types';
import { ArenaCellBucketIndex } from './ArenaCellBucketIndex';
import { ARENA_RENDER_CHUNK_ACQUIRE_MARGIN_PX, worldRectToLocalRect } from './ArenaChunkGrid';
import type { ChunkWorldFrame, ChunkWorldRect } from './ArenaChunkGrid';

/**
 * Blendet Felsen ausserhalb des Kameraausschnitts aus.
 *
 * Phaser 4 kennt keine Kamera-Bounds-Cullung auf Objektebene: `GameObject.willRender()` prueft nur
 * Renderflags und Kamerafilter. Jedes Fels-Image der Anzeigeliste laeuft damit pro Frame durch den
 * kompletten Renderpfad – Transform, Tint, Quad, Batch. Auf einer 400 x 80-Karte sind das rund
 * 24 000 Quads je Frame, im Trace 16,7 ms `renderSubmit` bei nur 1 600 tatsaechlich sichtbaren
 * Objekten.
 *
 * `visible = false` setzt genau das Renderflag, das `willRender()` prueft: Der Renderer steigt
 * danach sofort aus, ohne Transform oder Batch. Bewusst **kein** Entfernen aus der Anzeigeliste –
 * das kostet je Objekt eine lineare Suche, zwei Events und eine erneute Tiefensortierung, und der
 * verbleibende Listendurchlauf ist gegenueber dem eingesparten Quad-Aufbau klein.
 *
 * Umgeschaltet wird nur, was sich tatsaechlich aendert: Der Ausschnitt wird auf Buckets abgebildet,
 * und nur Buckets, die neu hinzukommen oder herausfallen, fassen ihre Felsen an. Steht die Kamera
 * still, macht ein Update gar nichts.
 */
export class RockViewportCuller {
  private readonly index: ArenaCellBucketIndex;
  private visibleBuckets = new Set<number>();
  private readonly bucketKeyBuffer: number[] = [];

  constructor(
    private readonly frame: ChunkWorldFrame,
    private readonly rocks: readonly (RockCell | undefined)[],
    private readonly rockObjects: readonly (Phaser.GameObjects.Image | null)[],
  ) {
    this.index = new ArenaCellBucketIndex(frame.width);
    this.index.sync(this.rocks);
    // Ausgangszustand: alles versteckt. Das erste `update()` schaltet nur Deltas um und wuerde
    // sonst jeden Fels ausserhalb des ersten Ausschnitts sichtbar stehen lassen.
    for (const image of this.rockObjects) image?.setVisible(false);
  }

  /** Gleicht die Sichtbarkeit an den Kameraausschnitt an. */
  update(view: ChunkWorldRect): void {
    this.index.sync(this.rocks);
    const local = worldRectToLocalRect(view, this.frame);
    const margin = ARENA_RENDER_CHUNK_ACQUIRE_MARGIN_PX;
    const keys = this.index.collectBucketKeys(
      local.localX - margin,
      local.localY - margin,
      local.localX + local.width + margin,
      local.localY + local.height + margin,
      this.bucketKeyBuffer,
    );

    const wanted = new Set(keys);
    for (const key of this.visibleBuckets) {
      if (!wanted.has(key)) this.setBucketVisible(key, false);
    }
    for (const key of wanted) {
      if (!this.visibleBuckets.has(key)) this.setBucketVisible(key, true);
    }
    this.visibleBuckets = wanted;
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
