import * as Phaser from 'phaser';
import {
  ARENA_RENDER_CHUNK_ACQUIRE_MARGIN_PX,
  ARENA_RENDER_CHUNK_RELEASE_MARGIN_PX,
  ArenaChunkGrid,
  worldRectToLocalRect,
} from './ArenaChunkGrid';
import type { ArenaChunkCoord, ChunkWorldFrame, ChunkWorldRect } from './ArenaChunkGrid';

/**
 * Residenzverwaltung der gestreamten Weltschichten.
 *
 * Ein `ChunkedRenderSurface` ersetzt einen Satz arenagrosser RenderTextures durch dasselbe
 * Schichtenbild in Render-Chunks: Nur Chunks im bzw. mit begrenztem Sicherheitsrand um den
 * lokalen Kameraausschnitt existieren als GPU-Renderziel, alle uebrigen werden recycelt und bei
 * erneutem Sichtbarwerden deterministisch neu gebacken.
 *
 * Die Klasse kennt bewusst kein einziges Fachdetail der Schichten. Sie liefert nur:
 *
 * 1. **Wann** ein Quadrat gebacken werden muss (Residenzwechsel oder Dirty-Region), und
 * 2. **wohin** das Ergebnis geht ({@link ChunkBakeSink.blit}).
 *
 * Alles, was in einem Quadrat sichtbar wird, entsteht in der uebergebenen Bake-Funktion – und
 * zwar strikt chunklokal in einem Scratch-Ziel der Kantenlaenge `region.size`. Das ist dieselbe
 * Koordinatengrenze, die der bisherige Rock-Overlay-Regional-Rebuild schon eingehalten hat
 * (siehe `docs/ai/rendering.md`): Weltkoordinaten duerfen weder in das Scratch-Ziel noch in die
 * Zielkamera gelangen.
 *
 * ## Sampling-Gutter
 *
 * Ein Renderziel ist je Seite um {@link CHUNK_SAMPLING_GUTTER_PX} groesser als der logische Chunk
 * und traegt dort echte angrenzende Weltinformation. Sichtbar bleibt trotzdem ausschliesslich der
 * logische Bereich – dafuer sorgt ein eigenes Texturframe. Warum das noetig ist, steht bei
 * {@link ChunkedRenderSurface.applyVisibleFrame}.
 *
 * ## Determinismus
 *
 * Ein verworfener und spaeter neu gebackener Chunk muss sichtbar identisch sein. Das leistet
 * diese Klasse nicht selbst, sondern setzt es voraus: Die Bake-Funktion darf ausschliesslich aus
 * Seed, Rasterkoordinaten und aktuellem Weltzustand zeichnen, nie aus einem Zufallsgenerator und
 * nie aus dem Bestand der gerade lebenden Objekte, wenn die Platzierung am vollstaendigen
 * Rundenbestand haengt (siehe `RockOverlayRegions`).
 */

export interface ChunkedSurfaceLayerSpec {
  readonly id: string;
  readonly depth: number;
  /** Phaser-Blendmode des Renderziels; Standard ist NORMAL. */
  readonly blend?: number;
}

export interface ChunkBakeRegion {
  /** Render-Chunk, in dem die Region liegt. */
  readonly chunk: ArenaChunkCoord;
  /**
   * Linke obere Ecke der zu zeichnenden Flaeche in rahmenlokalen Pixeln.
   *
   * Sie liegt um {@link gutterPx} ausserhalb der logischen Region: Der Gutter muss mit echter
   * Nachbarschaft gefuellt werden, nicht mit Leere. Fuer die Bake-Funktion aendert das nichts –
   * sie zeichnet wie bisher alles, was `[localX, localX + size)` beruehrt.
   */
  readonly localX: number;
  readonly localY: number;
  /**
   * Kantenlaenge der zu zeichnenden Flaeche: logische Regionsgroesse plus zweimal
   * {@link gutterPx}. Das ist zugleich die geforderte Kantenlaenge des Scratch-Ziels.
   */
  readonly size: number;
  /** Weltposition der linken oberen Ecke – fuer Scratch-Kameras, die Weltobjekte einlesen. */
  readonly worldX: number;
  readonly worldY: number;
  /** Ueberstand je Seite, der spaeter nur noch gesampelt und nie composited wird. */
  readonly gutterPx: number;
}

export interface ChunkBakeSink {
  /**
   * Schreibt ein chunklokales Scratch-Ziel (Kantenlaenge `region.size`) in eine Ebene.
   *
   * Der Blit laeuft ausschliesslich ueber den Texturschluessel und mit neutraler Zielkamera –
   * ein weltpositioniertes Hilfs-Image wuerde den Inhalt um den Arena-Offset verschieben.
   */
  blit(layerId: string, scratch: Phaser.GameObjects.RenderTexture): void;
  /** Leert die Region einer Ebene; fuer Schichten, die in diesem Quadrat nichts zeichnen. */
  clearRegion(layerId: string): void;
  /** Fuellt die Region einer Ebene mit einer Volltonfarbe (neutrale Basis fuer MULTIPLY). */
  fillRegion(layerId: string, color: number, alpha?: number): void;
}

export type ChunkBakeFn = (region: ChunkBakeRegion, sink: ChunkBakeSink) => void;

export interface ChunkedRenderSurfaceOptions {
  readonly frame: ChunkWorldFrame;
  readonly layers: readonly ChunkedSurfaceLayerSpec[];
  readonly bake: ChunkBakeFn;
  readonly chunkSize?: number;
  /** Ueberschreibt {@link CHUNK_SAMPLING_GUTTER_PX}; `0` schaltet den Gutter ab. */
  readonly gutterPx?: number;
  /** Wird einmal je neu erzeugtem Renderziel aufgerufen – z. B. fuer die Arena-Maske. */
  readonly onChunkTextureCreated?: (texture: Phaser.GameObjects.RenderTexture, layerId: string) => void;
}

/**
 * Ueberstand je Chunkseite, der gebacken und gesampelt, aber nie composited wird.
 *
 * Zwei Pixel reichen: Gebraucht wird der Gutter allein von der bilinearen Filterung, die beim
 * Zeichnen des Chunks hoechstens ein halbes Zieltexel ueber die Kante hinausgreift. Er bleibt
 * bewusst klein, weil er in *jedes* Renderziel und in *jede* gebackene Region eingeht: Bei 512 px
 * Chunkgroesse kosten zwei Pixel je Seite rund 1,6 % Flaeche.
 */
export const CHUNK_SAMPLING_GUTTER_PX = 2;

/**
 * Name des Frames, das aus einem Renderziel den logischen Chunk ausschneidet.
 *
 * Der Name ist je Textur eindeutig; jedes Chunk-Renderziel hat seine eigene DynamicTexture.
 */
const CHUNK_VISIBLE_FRAME_NAME = 'chunkVisible';

/** Sampling override for the visible chunk render textures. */
export type ChunkSamplingMode = 'default' | 'nearest';

interface ResidentChunk {
  readonly coord: ArenaChunkCoord;
  readonly textures: Map<string, Phaser.GameObjects.RenderTexture>;
}

interface NeighbourGutterTarget {
  readonly chunk: ResidentChunk;
  readonly dx: number;
  readonly dy: number;
}

export interface ChunkedRenderSurfaceStats {
  readonly residentChunks: number;
  readonly pooledTextures: number;
  readonly layers: number;
  readonly chunkSize: number;
  /** Summe der residenten Renderziel-Pixel – die Groesse, die *nicht* mit der Welt skalieren darf. */
  readonly residentPixels: number;
}

/**
 * Wieviele freigegebene Renderziele je Ebene vorgehalten werden, bevor sie wirklich zerstoert
 * werden. Der Pool faengt das Hin- und Herlaufen ueber eine Chunkgrenze ab, ohne dass ein
 * Dauerlauf ueber die Karte unbegrenzt Speicher haelt.
 */
const CHUNK_TEXTURE_POOL_LIMIT_PER_LAYER = 12;

export class ChunkedRenderSurface {
  readonly grid: ArenaChunkGrid;
  /** Ueberstand je Seite; siehe {@link CHUNK_SAMPLING_GUTTER_PX}. */
  readonly gutterPx: number;
  /** Kantenlaenge eines Renderziels: logischer Chunk plus beidseitiger Gutter. */
  readonly chunkTextureSize: number;
  private readonly frame: ChunkWorldFrame;
  private readonly layers: readonly ChunkedSurfaceLayerSpec[];
  private readonly bakeFn: ChunkBakeFn;
  private readonly onChunkTextureCreated?: (texture: Phaser.GameObjects.RenderTexture, layerId: string) => void;
  private readonly resident = new Map<number, ResidentChunk>();
  private readonly pool = new Map<string, Phaser.GameObjects.RenderTexture[]>();
  private readonly defaultFilterModes = new WeakMap<Phaser.GameObjects.RenderTexture, Phaser.Textures.FilterMode>();
  private readonly layerVisibility = new Map<string, boolean>();
  private readonly transientBakeTextures = new Map<string, Phaser.GameObjects.RenderTexture>();
  private visible = true;
  private samplingMode: ChunkSamplingMode = 'default';
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    options: ChunkedRenderSurfaceOptions,
  ) {
    this.frame = options.frame;
    this.layers = options.layers;
    this.bakeFn = options.bake;
    this.onChunkTextureCreated = options.onChunkTextureCreated;
    this.grid = new ArenaChunkGrid(options.frame.width, options.frame.height, options.chunkSize);
    this.gutterPx = Math.max(0, Math.trunc(options.gutterPx ?? CHUNK_SAMPLING_GUTTER_PX));
    this.chunkTextureSize = this.grid.chunkSize + this.gutterPx * 2;
    for (const layer of this.layers) this.layerVisibility.set(layer.id, true);
  }

  /**
   * Gleicht die residenten Chunks an den sichtbaren Weltausschnitt an.
   *
   * Erwerb und Freigabe benutzen absichtlich verschiedene Raender: Ein Chunk wird knapp vor dem
   * Sichtbarwerden gebacken und erst eine Chunkbreite hinter dem Bild wieder verworfen.
   */
  updateResidency(view: ChunkWorldRect): void {
    if (this.destroyed) return;
    const local = worldRectToLocalRect(view, this.frame);
    const wanted = this.grid.chunksInLocalRect(local, ARENA_RENDER_CHUNK_ACQUIRE_MARGIN_PX);
    const keep = new Set<number>();
    for (const coord of this.grid.chunksInLocalRect(local, ARENA_RENDER_CHUNK_RELEASE_MARGIN_PX)) {
      keep.add(this.grid.key(coord.cx, coord.cy));
    }

    for (const coord of wanted) {
      const key = this.grid.key(coord.cx, coord.cy);
      if (!this.resident.has(key)) this.acquireChunk(coord);
    }

    for (const key of [...this.resident.keys()]) {
      if (!keep.has(key)) this.releaseChunk(key);
    }
  }

  /** Backt alle residenten Chunks komplett neu – fuer Aenderungen ohne lokale Dirty-Region. */
  refreshAll(): void {
    if (this.destroyed) return;
    for (const chunk of this.resident.values()) this.bakeChunk(chunk);
  }

  /**
   * Backt eine Dirty-Region neu.
   *
   * Nicht residente Chunks werden bewusst nicht als sichtbare Ziele aktualisiert: Ihr Inhalt
   * entsteht beim naechsten Sichtbarwerden ohnehin aus dem dann aktuellen Weltzustand. Falls ein
   * residenter Nachbar den Rand trotzdem als Sampling-Gutter braucht, entsteht dafuer einmalig
   * ein verstecktes, chunklokales Bake-Ziel.
   *
   * Liegt die Region an einer Chunkgrenze, traegt der Nachbar dieselbe Weltinformation in seinem
   * Gutter. Sie wird hier mitgezogen – sonst zeigte der Sampler an genau dieser Kante noch den
   * Weltzustand vor der Aenderung.
   */
  refreshRegion(localX: number, localY: number, size: number): void {
    if (this.destroyed) return;
    const coord = this.grid.chunkAt(localX, localY);
    if (!coord) return;
    const neighbours = this.collectNeighbourGutterTargets(coord, localX, localY, size);
    const chunk = this.resident.get(this.grid.key(coord.cx, coord.cy));
    if (chunk) {
      // The semantic dirty region is baked exactly once. Its already composed edge pixels are
      // copied into resident neighbours below; no second region bake is needed there.
      this.runBake(chunk, localX, localY, size);
      this.refreshNeighbourGutters(chunk, localX, localY, size, neighbours);
      return;
    }

    // A source chunk can be outside the release margin while a neighbour is still resident.
    // Bake once into a hidden chunk-local target so that the neighbour receives only sampling
    // data, without turning the neighbour gutter refresh into a visible dirty-region rebuild.
    if (neighbours.length > 0) {
      const transient = this.getTransientBakeChunk(coord);
      this.runBake(transient, localX, localY, size);
      this.refreshNeighbourGutters(transient, localX, localY, size, neighbours);
    }
  }

  /** Ob dieser Chunk gerade ein Renderziel besitzt. */
  isResident(cx: number, cy: number): boolean {
    return this.resident.has(this.grid.key(cx, cy));
  }

  getChunkTexture(layerId: string, cx: number, cy: number): Phaser.GameObjects.RenderTexture | null {
    return this.resident.get(this.grid.key(cx, cy))?.textures.get(layerId) ?? null;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.syncVisibility();
  }

  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Changes only the sampling of this surface's chunk render textures.
   *
   * The original filter mode is captured per texture so DEFAULT restores the exact mode that
   * Phaser assigned when the render target was created. No renderer-wide or smoothPixelArt
   * setting is touched.
   */
  setSamplingMode(mode: ChunkSamplingMode): void {
    this.samplingMode = mode;
    for (const chunk of this.resident.values()) {
      for (const texture of chunk.textures.values()) this.applySamplingMode(texture);
    }
  }

  getSamplingMode(): ChunkSamplingMode {
    return this.samplingMode;
  }

  getStats(): ChunkedRenderSurfaceStats {
    let pooled = 0;
    for (const bucket of this.pool.values()) pooled += bucket.length;
    // Gezaehlt wird die belegte Kantenlaenge samt Gutter, nicht die sichtbare: Speicher kostet
    // das Renderziel, nicht der Ausschnitt.
    const chunkPixels = this.chunkTextureSize * this.chunkTextureSize;
    return {
      residentChunks: this.resident.size,
      pooledTextures: pooled,
      layers: this.layers.length,
      chunkSize: this.grid.chunkSize,
      residentPixels: this.resident.size * this.layers.length * chunkPixels,
    };
  }

  destroy(): void {
    this.destroyed = true;
    for (const chunk of this.resident.values()) {
      for (const texture of chunk.textures.values()) {
        if (texture.active) texture.destroy();
      }
    }
    this.resident.clear();
    for (const bucket of this.pool.values()) {
      for (const texture of bucket) {
        if (texture.active) texture.destroy();
      }
    }
    this.pool.clear();
    for (const texture of this.transientBakeTextures.values()) {
      if (texture.active) texture.destroy();
    }
    this.transientBakeTextures.clear();
  }

  // ── Interna ────────────────────────────────────────────────────────────────

  /**
   * Ermittelt die residenten Nachbarchunks, deren physische Gutter-Zone die Dirty-Region beruehrt.
   *
   * Die semantische Dirty-Auswahl bleibt ausserhalb dieser Klasse. Dieser zweite Satz ist nur die
   * Sampling-Abhaengigkeit des bereits gebackenen Randes: sichtbarer Inhalt des Nachbarchunks wird
   * hier niemals aktualisiert.
   */
  private collectNeighbourGutterTargets(
    coord: ArenaChunkCoord,
    localX: number,
    localY: number,
    size: number,
  ): NeighbourGutterTarget[] {
    if (this.gutterPx <= 0) return [];
    const chunkSize = this.grid.chunkSize;
    const touchesLeft = localX <= coord.localX;
    const touchesRight = localX + size >= coord.localX + chunkSize;
    const touchesTop = localY <= coord.localY;
    const touchesBottom = localY + size >= coord.localY + chunkSize;
    if (!touchesLeft && !touchesRight && !touchesTop && !touchesBottom) return [];

    const targets: NeighbourGutterTarget[] = [];

    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        if (dx < 0 && !touchesLeft) continue;
        if (dx > 0 && !touchesRight) continue;
        if (dy < 0 && !touchesTop) continue;
        if (dy > 0 && !touchesBottom) continue;

        const cx = coord.cx + dx;
        const cy = coord.cy + dy;
        // Erst klemmen, dann nachschlagen: `key()` rechnet zeilenweise und traefe fuer `cx = -1`
        // sonst den letzten Chunk der Vorzeile.
        if (!this.grid.contains(cx, cy)) continue;
        const neighbour = this.resident.get(this.grid.key(cx, cy));
        if (!neighbour) continue;
        targets.push({ chunk: neighbour, dx, dy });
      }
    }
    return targets;
  }

  /**
   * Synchronisiert ausschliesslich die schmalen physischen Gutter-Streifen eines Nachbarn.
   *
   * `source` enthaelt den fachlich gebackenen Zustand. Die Kopierquelle liegt an dessen
   * logischer Kante; die Zielkoordinaten liegen ausschliesslich in der unsichtbaren Gutter-Zone
   * des Nachbarn. Dadurch bleibt die sichtbare Chunkflaeche unangetastet, auch bei MULTIPLY-
   * Ebenen.
   */
  private refreshNeighbourGutters(
    source: ResidentChunk,
    localX: number,
    localY: number,
    size: number,
    targets: readonly NeighbourGutterTarget[],
  ): void {
    if (this.gutterPx <= 0) return;
    const gutter = this.gutterPx;
    const chunkSize = this.grid.chunkSize;
    const sourceLocalX = localX - source.coord.localX;
    const sourceLocalY = localY - source.coord.localY;

    for (const { chunk: neighbour, dx, dy } of targets) {
      const sourceX = dx < 0 ? gutter : dx > 0 ? chunkSize : sourceLocalX + gutter;
      const sourceY = dy < 0 ? gutter : dy > 0 ? chunkSize : sourceLocalY + gutter;
      const width = dx === 0 ? size : gutter;
      const height = dy === 0 ? size : gutter;
      const destinationX = dx < 0
        ? chunkSize + gutter
        : dx > 0
          ? 0
          : localX - neighbour.coord.localX + gutter;
      const destinationY = dy < 0
        ? chunkSize + gutter
        : dy > 0
          ? 0
          : localY - neighbour.coord.localY + gutter;

      for (const layer of this.layers) {
        const sourceTexture = source.textures.get(layer.id);
        const targetTexture = neighbour.textures.get(layer.id);
        if (!sourceTexture || !targetTexture) continue;
        this.copyTextureRegion(
          sourceTexture,
          targetTexture,
          sourceX,
          sourceY,
          destinationX,
          destinationY,
          width,
          height,
        );
      }
    }
  }

  private copyTextureRegion(
    source: Phaser.GameObjects.RenderTexture,
    target: Phaser.GameObjects.RenderTexture,
    sourceX: number,
    sourceY: number,
    destinationX: number,
    destinationY: number,
    width: number,
    height: number,
  ): void {
    const frameName = `chunkGutter:${sourceX}:${sourceY}:${width}:${height}`;
    if (!source.texture.has(frameName)) {
      source.texture.add(frameName, 0, sourceX, sourceY, width, height);
      // `Texture.add()` otherwise promotes the first copied gutter frame to the default frame.
      // RenderTexture drawing commands use the physical base texture, so keep the explicit base
      // frame contract established by `applyVisibleFrame()` intact.
      source.texture.firstFrame = '__BASE';
    }
    target.clear(destinationX, destinationY, width, height);
    target.stamp(source.texture.key, frameName, destinationX, destinationY, { originX: 0, originY: 0 });
    target.render();
  }

  private acquireChunk(coord: ArenaChunkCoord): void {
    const textures = new Map<string, Phaser.GameObjects.RenderTexture>();
    for (const layer of this.layers) {
      const texture = this.obtainTexture(layer);
      texture.setPosition(this.frame.offsetX + coord.localX, this.frame.offsetY + coord.localY);
      texture.setVisible(this.visible && (this.layerVisibility.get(layer.id) ?? true));
      texture.clear();
      texture.render();
      textures.set(layer.id, texture);
    }
    const chunk: ResidentChunk = { coord, textures };
    this.resident.set(this.grid.key(coord.cx, coord.cy), chunk);
    this.bakeChunk(chunk);
  }

  private releaseChunk(key: number): void {
    const chunk = this.resident.get(key);
    if (!chunk) return;
    this.resident.delete(key);
    for (const [layerId, texture] of chunk.textures) {
      texture.clear();
      texture.render();
      texture.setVisible(false);
      const bucket = this.pool.get(layerId) ?? [];
      if (bucket.length >= CHUNK_TEXTURE_POOL_LIMIT_PER_LAYER) {
        texture.destroy();
        continue;
      }
      bucket.push(texture);
      this.pool.set(layerId, bucket);
    }
  }

  private obtainTexture(layer: ChunkedSurfaceLayerSpec): Phaser.GameObjects.RenderTexture {
    const bucket = this.pool.get(layer.id);
    const pooled = bucket?.pop();
    if (pooled) {
      this.applySamplingMode(pooled);
      return pooled;
    }

    const texture = this.scene.add.renderTexture(0, 0, this.chunkTextureSize, this.chunkTextureSize);
    texture.setOrigin(0, 0);
    this.applyVisibleFrame(texture);
    texture.setDepth(layer.depth);
    if (layer.blend !== undefined) texture.setBlendMode(layer.blend);
    // Der Inhalt eines Chunks ist dauerhaft chunklokal. Die Weltposition traegt allein das
    // GameObject; eine gescrollte interne Kamera wuerde jeden Blit um den Arena-Offset verschieben.
    texture.camera.setScroll(0, 0);
    const defaultFilterMode = texture.texture.source?.[0]?.scaleMode;
    if (defaultFilterMode !== undefined) {
      this.defaultFilterModes.set(texture, defaultFilterMode as Phaser.Textures.FilterMode);
    }
    this.applySamplingMode(texture);
    this.onChunkTextureCreated?.(texture, layer.id);
    return texture;
  }

  /**
   * Beschraenkt Geometrie und UV-Fenster eines Renderziels auf den logischen Chunk.
   *
   * Ohne diesen Schnitt entsteht die sichtbare Naht: Die Chunks liegen zwar exakt aneinander,
   * aber beim Zeichnen mit Kamerazoom faellt ihre Kante zwischen zwei Bildschirmpixel. Die
   * bilineare Filterung greift dort ein halbes Texel ueber den Texturrand hinaus, findet nichts
   * und klemmt (`CLAMP_TO_EDGE`) auf das Randtexel. Beide Nachbarn wiederholen so ihr eigenes
   * Randtexel statt ineinander zu blenden – ein regelmaessiger Sprung entlang jeder Chunkgrenze,
   * bei MULTIPLY-Ebenen als helle oder dunkle Linie besonders auffaellig.
   *
   * Mit Frame bleibt das Quad exakt `chunkSize` gross und an derselben Weltposition; die
   * Filterung darf aber ueber `u1`/`v1` hinaus in den Gutter greifen, wo echte Nachbarschaft
   * liegt. Composited wird weiterhin nur der logische Bereich – benachbarte Chunks ueberlappen
   * sich nicht um ein einziges Pixel.
   */
  private applyVisibleFrame(texture: Phaser.GameObjects.RenderTexture): void {
    if (this.gutterPx <= 0) return;
    const source = texture.texture;
    if (!source.has(CHUNK_VISIBLE_FRAME_NAME)) {
      source.add(CHUNK_VISIBLE_FRAME_NAME, 0, this.gutterPx, this.gutterPx, this.grid.chunkSize, this.grid.chunkSize);
      // `Texture.add()` macht das erste eigene Frame zum Standardframe. Die Zeichenbefehle der
      // DynamicTexture rechnen aber weiter in vollen Texturkoordinaten – inklusive Gutter.
      source.firstFrame = '__BASE';
    }
    texture.setFrame(CHUNK_VISIBLE_FRAME_NAME);
  }

  private applySamplingMode(texture: Phaser.GameObjects.RenderTexture): void {
    const filterMode = this.samplingMode === 'nearest'
      ? Phaser.Textures.FilterMode.NEAREST
      : this.defaultFilterModes.get(texture);
    if (filterMode !== undefined) texture.texture.setFilter(filterMode);
  }

  private bakeChunk(chunk: ResidentChunk): void {
    this.runBake(chunk, chunk.coord.localX, chunk.coord.localY, this.grid.chunkSize);
  }

  private getTransientBakeChunk(coord: ArenaChunkCoord): ResidentChunk {
    for (const texture of this.transientBakeTextures.values()) {
      texture.clear();
      texture.render();
    }
    if (this.transientBakeTextures.size === 0) {
      for (const layer of this.layers) {
        const texture = this.scene.add.renderTexture(0, 0, this.chunkTextureSize, this.chunkTextureSize);
        texture.setOrigin(0, 0);
        texture.setVisible(false);
        texture.camera.setScroll(0, 0);
        if (layer.blend !== undefined) texture.setBlendMode(layer.blend);
        this.transientBakeTextures.set(layer.id, texture);
      }
    }
    return { coord, textures: this.transientBakeTextures };
  }

  /**
   * Backt eine logische Region samt Gutter.
   *
   * `localX`/`localY`/`size` beschreiben die **logische** Region – die Chunkflaeche oder einen
   * Dirty-Chunk. Gebacken und geblittet wird das um den Gutter erweiterte Quadrat. Beides ist
   * derselbe Vorgang, weil der Gutter des Renderziels und die Erweiterung der Region sich exakt
   * aufheben: Das Blit-Ziel bleibt der Versatz der logischen Region im Chunk.
   *
   * Der fachliche Dirty-Blit schreibt die erweiterte Region einmal in sein Quellziel. Die
   * anschliessende Gutter-Synchronisierung kopiert daraus nur die betroffenen Rand-/Eckpixel in
   * benachbarte Ziele; sie ruft diesen Bake-Pfad nicht erneut auf.
   */
  private runBake(chunk: ResidentChunk, localX: number, localY: number, size: number): void {
    const gutter = this.gutterPx;
    const bakeX = localX - gutter;
    const bakeY = localY - gutter;
    const bakeSize = size + gutter * 2;
    const region: ChunkBakeRegion = {
      chunk: chunk.coord,
      localX: bakeX,
      localY: bakeY,
      size: bakeSize,
      worldX: this.frame.offsetX + bakeX,
      worldY: this.frame.offsetY + bakeY,
      gutterPx: gutter,
    };
    const destX = localX - chunk.coord.localX;
    const destY = localY - chunk.coord.localY;
    const sink: ChunkBakeSink = {
      blit: (layerId, scratch) => {
        const target = chunk.textures.get(layerId);
        if (!target) return;
        target.clear(destX, destY, bakeSize, bakeSize);
        target.stamp(scratch.texture.key, undefined, destX, destY, { originX: 0, originY: 0 });
        target.render();
      },
      clearRegion: (layerId) => {
        const target = chunk.textures.get(layerId);
        if (!target) return;
        target.clear(destX, destY, bakeSize, bakeSize);
        target.render();
      },
      fillRegion: (layerId, color, alpha = 1) => {
        const target = chunk.textures.get(layerId);
        if (!target) return;
        target.clear(destX, destY, bakeSize, bakeSize);
        target.fill(color, alpha, destX, destY, bakeSize, bakeSize);
        target.render();
      },
    };
    this.bakeFn(region, sink);
  }

  private syncVisibility(): void {
    for (const chunk of this.resident.values()) {
      for (const [layerId, texture] of chunk.textures) {
        texture.setVisible(this.visible && (this.layerVisibility.get(layerId) ?? true));
      }
    }
  }
}

/**
 * Wiederverwendete chunklokale Renderziele.
 *
 * Ihre Kantenlaenge folgt der gerade gebackenen Region, nie der Arena – genau das ist die
 * Eigenschaft, die die Bake-Pfade von der Weltgroesse entkoppelt. Ein Satz je Groesse reicht,
 * weil immer nur eine Region gleichzeitig gebacken wird.
 *
 * Seit dem Sampling-Gutter ist `region.size` die um beide Gutter erweiterte Kantenlaenge; es
 * entstehen also zwei Groessen je Rolle (Chunk und Dirty-Chunk) wie zuvor, nur um `2 * gutterPx`
 * groesser. Beide bleiben gerade, solange die logischen Groessen es sind – wichtig, weil Phaser
 * ungerade Renderziele aufrundet und {@link eraseChunkScratch} den Mittelpunkt bei `size / 2`
 * erwartet.
 */
export class ChunkScratchPool {
  private readonly sets = new Map<string, Phaser.GameObjects.RenderTexture>();

  constructor(private readonly scene: Phaser.Scene) {}

  /** Liefert – und erzeugt bei Bedarf – ein Scratch-Ziel fuer eine Rolle und Kantenlaenge. */
  get(role: string, size: number, renderMode: 'render' | 'redraw' = 'render'): Phaser.GameObjects.RenderTexture {
    const key = `${role}:${size}`;
    const existing = this.sets.get(key);
    if (existing) return existing;

    const texture = this.scene.add.renderTexture(0, 0, size, size);
    texture.setOrigin(0, 0);
    texture.setVisible(false);
    texture.camera.setScroll(0, 0);
    if (renderMode === 'redraw') texture.setRenderMode('redraw');
    this.sets.set(key, texture);
    return texture;
  }

  destroy(): void {
    for (const texture of this.sets.values()) {
      if (texture.active) texture.destroy();
    }
    this.sets.clear();
  }
}

/**
 * Schneidet ein chunklokales Scratch-Ziel mit einer gleich grossen, kameraunabhaengigen Textur.
 *
 * `erase()` delegiert Strings an `stamp()`: anders als ein Image-GameObject ignoriert die Textur
 * damit die Kamera des Ziels. Der Default-Origin 0.5 legt die Stanzform bei (size/2, size/2)
 * exakt auf die Flaeche 0..size-1.
 */
export function eraseChunkScratch(
  target: Phaser.GameObjects.RenderTexture,
  cutout: Phaser.GameObjects.RenderTexture,
  size: number,
): void {
  const center = size * 0.5;
  target.erase(cutout.texture.key, center, center);
}
