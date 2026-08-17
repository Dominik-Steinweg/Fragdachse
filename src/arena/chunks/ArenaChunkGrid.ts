import { ROCK_OVERLAY_CHUNK_SIZE } from '../RockOverlayRegions';

/**
 * Rastergeometrie der gestreamten Weltschichten.
 *
 * Die sichtbaren Bodenb&auml;nder und felsgebundenen Overlays liegen nicht mehr in je einer
 * arenagrossen RenderTexture, sondern in quadratischen Render-Chunks, von denen nur die
 * kameranahen als GPU-Renderziel existieren. Diese Datei enth&auml;lt davon ausschliesslich die
 * Geometrie – bewusst ohne Phaser-Abh&auml;ngigkeit und damit direkt testbar, wie
 * {@link ../RockOverlayRegions}.
 *
 * Zwei Groessen sind zu unterscheiden und duerfen nicht vermischt werden:
 *
 * - **Render-Chunk** ({@link ARENA_RENDER_CHUNK_SIZE}): die Kantenlaenge eines residenten
 *   Renderziels. Sie ist ein reines Implementierungsdetail des Streamings.
 * - **Dirty-Chunk** ({@link ROCK_OVERLAY_CHUNK_SIZE}): die unveraenderte Update-Granularitaet
 *   einer Felsaenderung. Ein Render-Chunk ist ein ganzzahliges Vielfaches davon, damit ein
 *   Dirty-Chunk immer vollstaendig in genau einem Render-Chunk liegt.
 */

/**
 * Kantenlaenge eines residenten Renderziels.
 *
 * 512 px sind vier Dirty-Chunks je Achse. Kleiner hiesse hunderte Renderziele und Draw Calls
 * fuer denselben Bildausschnitt, groesser hiesse mehr gebackene Flaeche ausserhalb des Bildes
 * und groebere Streaming-Spruenge.
 */
export const ARENA_RENDER_CHUNK_SIZE = 512;

/**
 * Sicherheitsrand um den sichtbaren Ausschnitt, ab dem ein Chunk resident wird. Er deckt die
 * Strecke ab, die die Kamera zwischen zwei Residenz-Updates zuruecklegen kann.
 */
export const ARENA_RENDER_CHUNK_ACQUIRE_MARGIN_PX = 128;

/**
 * Rand, ab dem ein Chunk wieder freigegeben wird. Bewusst um eine Chunkbreite groesser als der
 * Erwerbsrand: Ohne diese Hysterese wechselte ein Chunk direkt an der Grenze bei jeder kleinen
 * Kamerabewegung zwischen "gebacken" und "verworfen".
 */
export const ARENA_RENDER_CHUNK_RELEASE_MARGIN_PX =
  ARENA_RENDER_CHUNK_ACQUIRE_MARGIN_PX + ARENA_RENDER_CHUNK_SIZE;

export interface ChunkLocalRect {
  localX: number;
  localY: number;
  width: number;
  height: number;
}

export interface ArenaChunkCoord {
  /** Spalten-/Zeilenindex im Chunkraster. */
  readonly cx: number;
  readonly cy: number;
  /** Linke obere Ecke des Chunks in rahmenlokalen Pixeln. */
  readonly localX: number;
  readonly localY: number;
}

/** Weltrechteck, wie es `getVisibleWorldView()` liefert. */
export interface ChunkWorldRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Weltversatz und Ausdehnung des Bestands, zu dem ein Chunkraster gehoert. */
export interface ChunkWorldFrame {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
}

export class ArenaChunkGrid {
  readonly cols: number;
  readonly rows: number;

  constructor(
    readonly frameWidth: number,
    readonly frameHeight: number,
    readonly chunkSize: number = ARENA_RENDER_CHUNK_SIZE,
  ) {
    if (chunkSize <= 0 || chunkSize % ROCK_OVERLAY_CHUNK_SIZE !== 0) {
      // Ein Dirty-Chunk muss vollstaendig in genau einem Render-Chunk liegen, sonst braeuchte
      // ein einzelner Dirty-Blit mehrere Ziele und die 128er-Granularitaet waere verloren.
      throw new Error(
        `[ArenaChunkGrid] chunkSize ${chunkSize} must be a positive multiple of ${ROCK_OVERLAY_CHUNK_SIZE}`,
      );
    }
    this.cols = Math.max(1, Math.ceil(frameWidth / chunkSize));
    this.rows = Math.max(1, Math.ceil(frameHeight / chunkSize));
  }

  key(cx: number, cy: number): number {
    return cy * this.cols + cx;
  }

  contains(cx: number, cy: number): boolean {
    return cx >= 0 && cx < this.cols && cy >= 0 && cy < this.rows;
  }

  coord(cx: number, cy: number): ArenaChunkCoord {
    return { cx, cy, localX: cx * this.chunkSize, localY: cy * this.chunkSize };
  }

  coordFromKey(key: number): ArenaChunkCoord {
    const cy = Math.floor(key / this.cols);
    return this.coord(key - cy * this.cols, cy);
  }

  /** Chunk, in dem ein rahmenlokaler Punkt liegt; `null` ausserhalb des Rasters. */
  chunkAt(localX: number, localY: number): ArenaChunkCoord | null {
    const cx = Math.floor(localX / this.chunkSize);
    const cy = Math.floor(localY / this.chunkSize);
    return this.contains(cx, cy) ? this.coord(cx, cy) : null;
  }

  /**
   * Alle Chunks, die das rahmenlokale Rechteck samt Rand beruehren – am Rasterrand geklemmt.
   *
   * Das Klemmen ist der Grund, warum diese Rechnung nicht an der Aufrufstelle stehen darf: Eine
   * Kamera an der Westkante liefert negative lokale Koordinaten, eine an der Ostkante Werte
   * jenseits der Arenabreite. Beides muss auf das vorhandene Raster fallen, statt Chunks ausserhalb
   * der Welt anzufordern.
   */
  chunksInLocalRect(rect: ChunkLocalRect, marginPx = 0): ArenaChunkCoord[] {
    const minX = rect.localX - marginPx;
    const minY = rect.localY - marginPx;
    const maxX = rect.localX + rect.width + marginPx;
    const maxY = rect.localY + rect.height + marginPx;
    if (maxX <= 0 || maxY <= 0 || minX >= this.frameWidth || minY >= this.frameHeight) return [];

    const firstX = Math.max(0, Math.floor(minX / this.chunkSize));
    const firstY = Math.max(0, Math.floor(minY / this.chunkSize));
    // `maxX` ist exklusiv: Ein Rechteck, das exakt an einer Chunkgrenze endet, darf den
    // dahinterliegenden Chunk nicht mehr anfordern.
    const lastX = Math.min(this.cols - 1, Math.ceil(maxX / this.chunkSize) - 1);
    const lastY = Math.min(this.rows - 1, Math.ceil(maxY / this.chunkSize) - 1);

    const result: ArenaChunkCoord[] = [];
    for (let cy = firstY; cy <= lastY; cy += 1) {
      for (let cx = firstX; cx <= lastX; cx += 1) result.push(this.coord(cx, cy));
    }
    return result;
  }

  /**
   * Die Dirty-Chunk-Regionen eines Render-Chunks in Zeichenreihenfolge.
   *
   * Wird nicht fuer den Vollbake gebraucht – der backt den Chunk in einem Zug – sondern von
   * Tests und Diagnose, die die Verschachtelung beider Granularitaeten pruefen.
   */
  dirtyRegionsOf(chunk: ArenaChunkCoord, dirtySize = ROCK_OVERLAY_CHUNK_SIZE): ChunkLocalRect[] {
    const regions: ChunkLocalRect[] = [];
    for (let y = chunk.localY; y < chunk.localY + this.chunkSize; y += dirtySize) {
      for (let x = chunk.localX; x < chunk.localX + this.chunkSize; x += dirtySize) {
        regions.push({ localX: x, localY: y, width: dirtySize, height: dirtySize });
      }
    }
    return regions;
  }
}

/** Rechnet einen sichtbaren Weltausschnitt in das rahmenlokale Koordinatensystem um. */
export function worldRectToLocalRect(view: ChunkWorldRect, frame: ChunkWorldFrame): ChunkLocalRect {
  return {
    localX: view.x - frame.offsetX,
    localY: view.y - frame.offsetY,
    width: view.width,
    height: view.height,
  };
}
