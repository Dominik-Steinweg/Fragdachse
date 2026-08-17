import type * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH } from '../../config';
import { ARENA_RENDER_CHUNK_SIZE, ArenaChunkGrid } from './ArenaChunkGrid';
import type { ArenaChunkCoord, ChunkWorldFrame } from './ArenaChunkGrid';

/**
 * Raeumliche Aufteilung der Fels-Anzeigeliste in 512-px-Ebenen.
 *
 * Eine einzelne `Layer` mit dem gesamten Felsbestand loest das Problem nur halb: Sie macht die
 * *Szenenliste* kurz, aber Phaser laeuft weiterhin jeden Frame durch alle Kinder dieser einen
 * Ebene und ruft je Fels `willRender()`. Auf einer 400 x 80-Karte sind das rund 29 000 Aufrufe fuer
 * einen Bildausschnitt, in dem hoechstens ein paar hundert Felsen liegen – im Trace der groesste
 * dauerhafte Posten der Renderabgabe im Leerlauf.
 *
 * Mit einer Ebene je Rasterchunk faellt diese Schleife weg: Eine Ebene ausserhalb des Ausschnitts
 * ist selbst unsichtbar, und `LayerWebGLRenderer` wird fuer sie gar nicht erst aufgerufen. Der
 * Renderpfad sieht dann nur noch die Kinder der wenigen kameranahen Ebenen.
 *
 * Das Raster ist bewusst **dasselbe** wie beim Chunk-Streaming der Weltschichten
 * ({@link ArenaChunkGrid}): Ein zweites Raumraster daneben waere eine zweite Stelle, an der
 * Koordinaten, Randbreiten und Klemmung auseinanderlaufen koennen.
 *
 * Die Aufteilung betrifft ausschliesslich die Darstellung. `rockObjects`, `RockGridIndex`, die
 * Static-Physics-Gruppe und die gesamte HP-/Gameplay-Logik bleiben global und unveraendert.
 */
export class RockLayerGrid {
  readonly grid: ArenaChunkGrid;
  private readonly layers = new Map<number, Phaser.GameObjects.Layer>();

  constructor(
    private readonly scene: Phaser.Scene,
    frame: ChunkWorldFrame,
    chunkSize: number = ARENA_RENDER_CHUNK_SIZE,
  ) {
    this.grid = new ArenaChunkGrid(frame.width, frame.height, chunkSize);
  }

  /** Wieviele Ebenen bisher tatsaechlich gebraucht wurden – fuer Diagnose und Tests. */
  get layerCount(): number {
    return this.layers.size;
  }

  /**
   * Der Chunk, in den eine Rasterposition faellt.
   *
   * Geklemmt statt `null`: Ein zur Laufzeit gebauter Fels darf knapp ausserhalb des Rahmens
   * liegen, und ein Fels ohne Ebene waere unsichtbar statt nur falsch einsortiert.
   */
  chunkOf(gridX: number, gridY: number): ArenaChunkCoord {
    const cx = Math.max(0, Math.min(this.grid.cols - 1, Math.floor((gridX * CELL_SIZE) / this.grid.chunkSize)));
    const cy = Math.max(0, Math.min(this.grid.rows - 1, Math.floor((gridY * CELL_SIZE) / this.grid.chunkSize)));
    return this.grid.coord(cx, cy);
  }

  keyOf(gridX: number, gridY: number): number {
    const chunk = this.chunkOf(gridX, gridY);
    return this.grid.key(chunk.cx, chunk.cy);
  }

  /**
   * Die Ebene einer Rasterposition; sie entsteht beim ersten Fels darin.
   *
   * Bewusst traege: Eine Karte mit grossen leeren Flaechen soll dafuer keine leeren Ebenen in der
   * Szenenliste halten.
   */
  layerFor(gridX: number, gridY: number): Phaser.GameObjects.Layer {
    const key = this.keyOf(gridX, gridY);
    const existing = this.layers.get(key);
    if (existing) return existing;

    // Alle Ebenen teilen sich `DEPTH.ROCKS`. Ihre Reihenfolge untereinander ist gleichgueltig:
    // Ein Fels deckt exakt seine eigene Zelle, zwei Felsen verschiedener Chunks ueberlappen nie.
    const layer = this.scene.add.layer().setDepth(DEPTH.ROCKS);
    this.layers.set(key, layer);
    return layer;
  }

  getLayer(key: number): Phaser.GameObjects.Layer | undefined {
    return this.layers.get(key);
  }

  /**
   * Grobes Culling: Eine unsichtbare Ebene wird vom Renderer gar nicht erst betreten, ihre Kinder
   * kosten damit nichts – auch nicht den `willRender()`-Aufruf.
   */
  setLayerVisible(key: number, visible: boolean): void {
    this.layers.get(key)?.setVisible(visible);
  }

  /** Alle vorhandenen Ebenenschluessel – fuer Diagnose und Tests. */
  keys(): IterableIterator<number> {
    return this.layers.keys();
  }

  destroy(): void {
    for (const layer of this.layers.values()) {
      if (layer.active) layer.destroy();
    }
    this.layers.clear();
  }
}
