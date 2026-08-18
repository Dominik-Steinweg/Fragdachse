import * as Phaser from 'phaser';
import {
  ARENA_RENDER_CHUNK_PREFETCH_MARGIN_PX,
  ARENA_RENDER_CHUNK_RELEASE_MARGIN_PX,
  ArenaChunkGrid,
  worldRectToLocalRect,
} from './ArenaChunkGrid';
import type { ArenaChunkCoord, ChunkWorldFrame, ChunkWorldRect } from './ArenaChunkGrid';
import {
  flushChunkBakeScheduler,
  getChunkBakeScheduler,
  type ChunkBakeScheduler,
} from './ChunkBakeScheduler';

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
  readonly pendingRegions: Map<string, { localX: number; localY: number; width: number; height: number }>;
  readonly dirtyRegions: Set<string>;
  readonly pendingTextureLayers: Set<string>;
  readonly gutterSyncRegions: Set<string>;
  ready: boolean;
  visibleDemand: boolean;
}

interface NeighbourGutterTarget {
  readonly chunk: ResidentChunk;
  readonly dx: number;
  readonly dy: number;
}

export interface ChunkedRenderSurfaceStats {
  readonly residentChunks: number;
  readonly pendingChunks: number;
  readonly pendingRegions: number;
  readonly pendingTextureAcquisitions: number;
  readonly pooledTextures: number;
  /** Maximale Chunk-Anzahl des konfigurierten Kamera-/Release-Fensters. */
  readonly maxResidentChunkDemand: number;
  /** Alle noch lebenden Renderziele dieser Surface, resident oder im Pool. */
  readonly allocatedTextures: number;
  /** Renderziele, die nach der ersten Residency-Synchronisierung neu erzeugt wurden. */
  readonly runtimeTextureCreations: number;
  readonly layers: number;
  readonly chunkSize: number;
  /** Summe der residenten Renderziel-Pixel – die Groesse, die *nicht* mit der Welt skalieren darf. */
  readonly residentPixels: number;
  /** Summe aller allozierten Renderziel-Pixel inklusive des Recycling-Pools. */
  readonly allocatedPixels: number;
}

/**
 * Kleine Reserve je Layer fuer den Uebergang zwischen zwei Residency-Fenstern und fuer einen
 * versteckten Gutter-Bake. Die eigentliche Kapazitaet wird aus dem maximalen Release-Fenster
 * berechnet; dieser Puffer ist bewusst unabhaengig von der Kartengroesse.
 */
export const CHUNK_TEXTURE_POOL_SAFETY_BUFFER = 2;
let nextSurfaceId = 1;

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
  private readonly scheduler: ChunkBakeScheduler;
  private readonly surfaceId = nextSurfaceId++;
  private readonly resident = new Map<number, ResidentChunk>();
  private readonly pool = new Map<string, Phaser.GameObjects.RenderTexture[]>();
  private readonly defaultFilterModes = new WeakMap<Phaser.GameObjects.RenderTexture, Phaser.Textures.FilterMode>();
  private readonly layerVisibility = new Map<string, boolean>();
  private visible = true;
  private samplingMode: ChunkSamplingMode = 'default';
  private destroyed = false;
  private lastResidencyView: ChunkWorldRect | null = null;
  private movementX = 0;
  private movementY = 0;
  private maxResidentChunkDemand = 0;
  private textureCapacityPerLayer = 0;
  private hasPreparedInitialResidency = false;
  private runtimeTextureCreations = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    options: ChunkedRenderSurfaceOptions,
  ) {
    this.frame = options.frame;
    this.layers = options.layers;
    this.bakeFn = options.bake;
    this.onChunkTextureCreated = options.onChunkTextureCreated;
    this.scheduler = getChunkBakeScheduler(scene);
    this.grid = new ArenaChunkGrid(options.frame.width, options.frame.height, options.chunkSize);
    this.gutterPx = Math.max(0, Math.trunc(options.gutterPx ?? CHUNK_SAMPLING_GUTTER_PX));
    this.chunkTextureSize = this.grid.chunkSize + this.gutterPx * 2;
    for (const layer of this.layers) this.layerVisibility.set(layer.id, true);
  }

  /**
   * Gleicht die residenten Chunks an den sichtbaren Weltausschnitt an.
   *
   * Die Methode reserviert Renderziele und Arbeitsregionen nur. Der eigentliche Bake laeuft ueber
   * den gemeinsamen Scheduler am Frame-Ende, damit Acquisition nie wieder einen synchronen
   * Vollbake ausfuehrt. Der Prefetch-Rand ist groesser als der alte 128-px-Sicherheitsrand; die
   * Freigabe bleibt nochmals deutlich dahinter.
   */
  updateResidency(view: ChunkWorldRect): void {
    if (this.destroyed) return;
    if (this.lastResidencyView) {
      this.movementX = view.x - this.lastResidencyView.x;
      this.movementY = view.y - this.lastResidencyView.y;
    }
    this.lastResidencyView = { ...view };
    this.ensureTexturePoolCapacity(view);
    const local = worldRectToLocalRect(view, this.frame);
    const visible = new Set<number>();
    for (const coord of this.grid.chunksInLocalRect(local)) {
      visible.add(this.grid.key(coord.cx, coord.cy));
    }
    const wanted = this.grid.chunksInLocalRect(local, ARENA_RENDER_CHUNK_PREFETCH_MARGIN_PX);
    const keep = new Set<number>();
    for (const coord of this.grid.chunksInLocalRect(local, ARENA_RENDER_CHUNK_RELEASE_MARGIN_PX)) {
      keep.add(this.grid.key(coord.cx, coord.cy));
    }

    // Erst freigeben, dann neue Chunks uebernehmen: Die alten Renderziele stehen im selben
    // Update bereits fuer die neuen Acquisitions zur Verfuegung. So braucht eine Kamerafahrt
    // keinen zusaetzlichen WebGL-Framebuffer fuer den kurzzeitigen Vereinigungsbereich.
    for (const key of [...this.resident.keys()]) {
      if (!keep.has(key)) this.releaseChunk(key);
      else {
        const chunk = this.resident.get(key);
        if (chunk) {
          chunk.visibleDemand = visible.has(key);
          this.syncChunkVisibility(chunk);
        }
      }
    }

    for (const coord of wanted) {
      const key = this.grid.key(coord.cx, coord.cy);
      const chunk = this.resident.get(key) ?? this.acquireChunk(coord);
      chunk.visibleDemand = visible.has(key);
      this.syncChunkVisibility(chunk);
    }
    this.hasPreparedInitialResidency = true;
  }

  /**
   * Plant alle 128-px-Regionen residenter Chunks neu. Der Aufruf selbst bleibt billig; die
   * tatsaechlichen RenderTexture-Flushes teilen sich das Frame-Budget mit Acquisition.
   */
  refreshAll(): void {
    if (this.destroyed) return;
    for (const chunk of this.resident.values()) {
      // A full refresh is an atomic visual replacement per chunk. Keep the old frame hidden until
      // all 128-px regions have been rebuilt; otherwise a large update briefly shows a checkerboard
      // of old and new world state.
      chunk.ready = false;
      this.syncChunkVisibility(chunk);
      for (const region of this.grid.dirtyRegionsOf(chunk.coord)) this.scheduleRegion(chunk, region, true);
    }
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
      // Pending acquisition and dirty invalidation use precisely the same 128-px work units.
      // Re-adding a region here is intentional: a world change can arrive after that region was
      // already baked, but before the chunk became visible.
      for (const region of this.grid.dirtyRegionsOf(coord)) {
        if (regionsOverlap(region.localX, region.localY, region.width, region.height, localX, localY, size, size)) {
          this.scheduleRegion(chunk, region, true);
        }
      }
      return;
    }

    // A source chunk can be outside the release margin while a neighbour is still resident.
    // Bake once into a hidden chunk-local target so that the neighbour receives only sampling
    // data, without turning the neighbour gutter refresh into a visible dirty-region rebuild.
    if (neighbours.length > 0) {
      const transient = this.getTransientBakeChunk(coord);
      try {
        this.runBake(transient, localX, localY, size);
        this.refreshNeighbourGutters(transient, localX, localY, size, neighbours);
      } finally {
        // Transient gutter work borrows the same preallocated layer targets as residency. It
        // must never become a second lazy RenderTexture pool that allocates during a match.
        this.releaseTransientBakeChunk(transient);
      }
    }
  }

  /** Ob dieser Chunk gerade ein Renderziel besitzt. */
  isResident(cx: number, cy: number): boolean {
    return this.resident.has(this.grid.key(cx, cy));
  }

  /** Ob der sichtbare Inhalt des Chunks vollstaendig gebacken ist. */
  isReady(cx: number, cy: number): boolean {
    return this.resident.get(this.grid.key(cx, cy))?.ready ?? false;
  }

  /**
   * Ob alle Chunks im sichtbaren Ausschnitt (optional inklusive des Startup-Prefetch-Rands)
   * vollstaendig resident und gebacken sind. Die Methode prueft auch RenderTexture-Akquisitionen,
   * damit ein leerer Pending-Region-Satz nie versehentlich als Load-Ready gilt.
   */
  isReadyForView(view: ChunkWorldRect, includePrefetch = true): boolean {
    if (this.destroyed) return false;
    const local = worldRectToLocalRect(view, this.frame);
    const margin = includePrefetch ? ARENA_RENDER_CHUNK_PREFETCH_MARGIN_PX : 0;
    for (const coord of this.grid.chunksInLocalRect(local, margin)) {
      const chunk = this.resident.get(this.grid.key(coord.cx, coord.cy));
      if (!chunk || !chunk.ready || chunk.pendingTextureLayers.size > 0 || chunk.pendingRegions.size > 0) {
        return false;
      }
    }
    return true;
  }

  /** Frame-Ende-Punkt fuer alle ChunkedRenderSurfaces derselben Scene. */
  static flushBakeBudget(scene: Phaser.Scene, budgetMs?: number): number {
    return flushChunkBakeScheduler(scene, budgetMs);
  }

  /** Nur fuer deterministische Tests und kontrollierte Offline-Builds. */
  static drainBakeQueue(scene: Phaser.Scene): number {
    return getChunkBakeScheduler(scene).drain();
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
    let pendingChunks = 0;
    let pendingRegions = 0;
    let pendingTextureAcquisitions = 0;
    let residentTextures = 0;
    for (const bucket of this.pool.values()) pooled += bucket.length;
    for (const chunk of this.resident.values()) {
      if (!chunk.ready) pendingChunks += 1;
      pendingRegions += chunk.pendingRegions.size;
      pendingTextureAcquisitions += chunk.pendingTextureLayers.size;
      residentTextures += chunk.textures.size;
    }
    // Gezaehlt wird die belegte Kantenlaenge samt Gutter, nicht die sichtbare: Speicher kostet
    // das Renderziel, nicht der Ausschnitt.
    const chunkPixels = this.chunkTextureSize * this.chunkTextureSize;
    const allocatedTextures = residentTextures + pooled;
    return {
      residentChunks: this.resident.size,
      pendingChunks,
      pendingRegions,
      pendingTextureAcquisitions,
      pooledTextures: pooled,
      maxResidentChunkDemand: this.maxResidentChunkDemand,
      allocatedTextures,
      runtimeTextureCreations: this.runtimeTextureCreations,
      layers: this.layers.length,
      chunkSize: this.grid.chunkSize,
      residentPixels: residentTextures * chunkPixels,
      allocatedPixels: allocatedTextures * chunkPixels,
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.scheduler.cancelOwner(this);
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

  private acquireChunk(coord: ArenaChunkCoord): ResidentChunk {
    const textures = new Map<string, Phaser.GameObjects.RenderTexture>();
    const pendingTextureLayers = new Set<string>();
    const chunk: ResidentChunk = {
      coord,
      textures,
      pendingRegions: new Map(),
      dirtyRegions: new Set(),
      pendingTextureLayers,
      gutterSyncRegions: new Set(),
      ready: false,
      visibleDemand: false,
    };
    this.resident.set(this.grid.key(coord.cx, coord.cy), chunk);

    for (const layer of this.layers) {
      const pooled = this.takePooledTexture(layer);
      if (pooled) {
        this.prepareChunkTexture(pooled, chunk);
        textures.set(layer.id, pooled);
      } else {
        pendingTextureLayers.add(layer.id);
        this.enqueueTextureAcquisition(chunk, layer);
      }
    }

    // Ein neuer Chunk bleibt unsichtbar, bis alle 16 (bei 512 px) 128-px-Regionen fertig sind.
    // Die Unterteilung kommt aus derselben Geometrie wie die Dirty-Rebuilds.
    for (const region of this.grid.dirtyRegionsOf(coord)) this.scheduleRegion(chunk, region, false, false);
    return chunk;
  }

  private releaseChunk(key: number): void {
    const chunk = this.resident.get(key);
    if (!chunk) return;
    for (const region of chunk.pendingRegions.keys()) this.scheduler.cancel(this.jobKey(chunk, region));
    for (const layer of chunk.pendingTextureLayers) this.scheduler.cancel(this.textureJobKey(chunk, layer));
    this.resident.delete(key);
    for (const [layerId, texture] of chunk.textures) {
      this.returnPooledTexture(layerId, texture);
    }
  }

  private takePooledTexture(layer: ChunkedSurfaceLayerSpec): Phaser.GameObjects.RenderTexture | null {
    const bucket = this.pool.get(layer.id);
    while (bucket && bucket.length > 0) {
      const pooled = bucket.pop();
      if (pooled?.active) {
        this.applySamplingMode(pooled);
        return pooled;
      }
    }

    return null;
  }

  private returnPooledTexture(layerId: string, texture: Phaser.GameObjects.RenderTexture): void {
    if (!texture.active) return;
    texture.clear();
    texture.render();
    texture.setVisible(false);
    const bucket = this.pool.get(layerId) ?? [];
    bucket.push(texture);
    this.pool.set(layerId, bucket);
  }

  /**
   * Vorallokiert die gesamte Renderziel-Kapazitaet des Release-Fensters.
   *
   * Die Formel ist bewusst nur von Viewport, Prefetch-/Release-Rand und Chunkraster abhaengig.
   * Sie ist eine konservative obere Schranke fuer beliebige Rasterausrichtung; die Map-Grenzen
   * kuerzen sie fuer kleine Arenen. Damit werden grosse Karten nicht zu einem proportionalen
   * VRAM-Reservoir.
   */
  private ensureTexturePoolCapacity(view: ChunkWorldRect): void {
    const local = worldRectToLocalRect(view, this.frame);
    const maxColumns = Math.min(
      this.grid.cols,
      Math.max(1, Math.ceil((local.width + ARENA_RENDER_CHUNK_RELEASE_MARGIN_PX * 2) / this.grid.chunkSize) + 1),
    );
    const maxRows = Math.min(
      this.grid.rows,
      Math.max(1, Math.ceil((local.height + ARENA_RENDER_CHUNK_RELEASE_MARGIN_PX * 2) / this.grid.chunkSize) + 1),
    );
    const demand = maxColumns * maxRows;
    if (demand > this.maxResidentChunkDemand) {
      this.maxResidentChunkDemand = demand;
      this.textureCapacityPerLayer = demand + CHUNK_TEXTURE_POOL_SAFETY_BUFFER;
    }

    for (const layer of this.layers) {
      while (this.countOwnedTextures(layer.id) < this.textureCapacityPerLayer) {
        const texture = this.createTexture(layer);
        this.returnPooledTexture(layer.id, texture);
      }
    }
  }

  private countOwnedTextures(layerId: string): number {
    let count = this.pool.get(layerId)?.length ?? 0;
    for (const chunk of this.resident.values()) {
      if (chunk.textures.has(layerId)) count += 1;
    }
    return count;
  }

  /** Creates one genuinely new resident target. Callers must already be on the shared scheduler. */
  private createTexture(layer: ChunkedSurfaceLayerSpec): Phaser.GameObjects.RenderTexture {

    const texture = this.scene.add.renderTexture(0, 0, this.chunkTextureSize, this.chunkTextureSize);
    texture.setOrigin(0, 0);
    this.applyVisibleFrame(texture, null);
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
    if (this.hasPreparedInitialResidency) this.runtimeTextureCreations += 1;
    return texture;
  }

  private prepareChunkTexture(
    texture: Phaser.GameObjects.RenderTexture,
    chunk: ResidentChunk,
  ): void {
    texture.setPosition(this.frame.offsetX + chunk.coord.localX, this.frame.offsetY + chunk.coord.localY);
    this.applyVisibleFrame(texture, chunk.coord);
    texture.setVisible(false);
    texture.clear();
    texture.render();
  }

  private enqueueTextureAcquisition(
    chunk: ResidentChunk,
    layer: ChunkedSurfaceLayerSpec,
  ): void {
    this.scheduler.enqueue({
      key: this.textureJobKey(chunk, layer.id),
      owner: this,
      completionKey: chunk,
      priority: () => this.getChunkPriority(chunk),
      urgent: () => chunk.visibleDemand,
      run: () => this.runTextureAcquisition(chunk, layer),
    });
  }

  private runTextureAcquisition(
    chunk: ResidentChunk,
    layer: ChunkedSurfaceLayerSpec,
  ): void {
    if (this.destroyed || this.resident.get(this.grid.key(chunk.coord.cx, chunk.coord.cy)) !== chunk) return;
    const texture = this.createTexture(layer);
    this.prepareChunkTexture(texture, chunk);
    chunk.textures.set(layer.id, texture);
    chunk.pendingTextureLayers.delete(layer.id);

    if (chunk.pendingTextureLayers.size === 0) {
      for (const [regionKey, region] of chunk.pendingRegions) {
        this.enqueueRegionJob(chunk, regionKey, region);
      }
      this.markReadyIfComplete(chunk);
    }
  }

  /**
   * Beschraenkt Geometrie und UV-Fenster eines Renderziels auf die Schnittmenge aus logischem
   * Chunk und World-Frame.
   *
   * Ohne diesen Schnitt entsteht die sichtbare Naht: Die Chunks liegen zwar exakt aneinander,
   * aber beim Zeichnen mit Kamerazoom faellt ihre Kante zwischen zwei Bildschirmpixel. Die
   * bilineare Filterung greift dort ein halbes Texel ueber den Texturrand hinaus, findet nichts
   * und klemmt (`CLAMP_TO_EDGE`) auf das Randtexel. Beide Nachbarn wiederholen so ihr eigenes
   * Randtexel statt ineinander zu blenden – ein regelmaessiger Sprung entlang jeder Chunkgrenze,
   * bei MULTIPLY-Ebenen als helle oder dunkle Linie besonders auffaellig.
   *
   * Mit Frame bleibt das Quad exakt an derselben Weltposition; bei Rand-Chunks wird es auf die
   * verbleibende Frame-Breite/-Hoehe verkleinert. Die Filterung darf am inneren Rand ueber
   * `u1`/`v1` hinaus in den Gutter greifen, wo echte Nachbarschaft liegt. Bei jeder Zuweisung wird
   * das bestehende Frame aktualisiert, damit gepoolte Ziele nicht die Groesse ihres vorherigen
   * Chunks weiterverwenden.
   */
  private applyVisibleFrame(
    texture: Phaser.GameObjects.RenderTexture,
    coord: ArenaChunkCoord | null,
  ): void {
    const chunkLocalX = coord?.localX ?? 0;
    const chunkLocalY = coord?.localY ?? 0;
    const visibleWidth = Math.max(0, Math.min(this.grid.chunkSize, this.frame.width - chunkLocalX));
    const visibleHeight = Math.max(0, Math.min(this.grid.chunkSize, this.frame.height - chunkLocalY));
    const source = texture.texture;
    if (!source.has(CHUNK_VISIBLE_FRAME_NAME)) {
      source.add(
        CHUNK_VISIBLE_FRAME_NAME,
        0,
        this.gutterPx,
        this.gutterPx,
        visibleWidth,
        visibleHeight,
      );
      // `Texture.add()` macht das erste eigene Frame zum Standardframe. Die Zeichenbefehle der
      // DynamicTexture rechnen aber weiter in vollen Texturkoordinaten – inklusive Gutter.
      source.firstFrame = '__BASE';
    } else {
      source.get(CHUNK_VISIBLE_FRAME_NAME).setSize(
        visibleWidth,
        visibleHeight,
        this.gutterPx,
        this.gutterPx,
      );
    }
    texture.setFrame(CHUNK_VISIBLE_FRAME_NAME);
  }

  private applySamplingMode(texture: Phaser.GameObjects.RenderTexture): void {
    const filterMode = this.samplingMode === 'nearest'
      ? Phaser.Textures.FilterMode.NEAREST
      : this.defaultFilterModes.get(texture);
    if (filterMode !== undefined) texture.texture.setFilter(filterMode);
  }

  private getTransientBakeChunk(coord: ArenaChunkCoord): ResidentChunk {
    const textures = new Map<string, Phaser.GameObjects.RenderTexture>();
    for (const layer of this.layers) {
      const texture = this.takePooledTexture(layer) ?? this.createTexture(layer);
      texture.setOrigin(0, 0);
      texture.setVisible(false);
      texture.camera.setScroll(0, 0);
      texture.clear();
      texture.render();
      textures.set(layer.id, texture);
    }
    return {
      coord,
      textures,
      pendingRegions: new Map(),
      dirtyRegions: new Set(),
      pendingTextureLayers: new Set(),
      gutterSyncRegions: new Set(),
      ready: true,
      visibleDemand: false,
    };
  }

  private releaseTransientBakeChunk(chunk: ResidentChunk): void {
    for (const [layerId, texture] of chunk.textures) this.returnPooledTexture(layerId, texture);
  }

  private scheduleRegion(
    chunk: ResidentChunk,
    region: { localX: number; localY: number; width: number; height: number },
    syncNeighbourGutter = false,
    dirty = true,
  ): void {
    const regionKey = this.regionKey(region);
    chunk.pendingRegions.set(regionKey, region);
    if (dirty) chunk.dirtyRegions.add(regionKey);
    if (syncNeighbourGutter) chunk.gutterSyncRegions.add(regionKey);
    if (chunk.pendingTextureLayers.size === 0) this.enqueueRegionJob(chunk, regionKey, region);
    // A pending chunk must never leak a partly written target into the display list. A ready
    // chunk remains visible while a later dirty rebuild is queued; it still shows its last
    // complete state until the replacement region is ready.
    if (!chunk.ready) this.syncChunkVisibility(chunk);
  }

  private runScheduledRegion(
    chunk: ResidentChunk,
    regionKey: string,
    region: { localX: number; localY: number; width: number; height: number },
  ): void {
    if (this.destroyed || this.resident.get(this.grid.key(chunk.coord.cx, chunk.coord.cy)) !== chunk) return;
    this.runBake(chunk, region.localX, region.localY, region.width);
    if (chunk.gutterSyncRegions.delete(regionKey)) {
      const neighbours = this.collectNeighbourGutterTargets(
        chunk.coord,
        region.localX,
        region.localY,
        region.width,
      );
      this.refreshNeighbourGutters(chunk, region.localX, region.localY, region.width, neighbours);
    }
    chunk.pendingRegions.delete(regionKey);
    chunk.dirtyRegions.delete(regionKey);
    if (!chunk.ready && chunk.pendingRegions.size === 0) {
      this.markReadyIfComplete(chunk);
    }
  }

  private enqueueRegionJob(
    chunk: ResidentChunk,
    regionKey: string,
    region: { localX: number; localY: number; width: number; height: number },
  ): void {
    this.scheduler.enqueue({
      key: this.jobKey(chunk, regionKey),
      owner: this,
      completionKey: chunk,
      priority: () => this.getRegionPriority(chunk, region),
      urgent: () => chunk.visibleDemand,
      run: () => this.runScheduledRegion(chunk, regionKey, region),
    });
  }

  private markReadyIfComplete(chunk: ResidentChunk): void {
    if (chunk.pendingTextureLayers.size > 0 || chunk.pendingRegions.size > 0) return;
    if (!chunk.ready) {
      chunk.ready = true;
      this.syncChunkVisibility(chunk);
    }
  }

  private getChunkPriority(chunk: ResidentChunk): number {
    const view = this.lastResidencyView;
    if (!view) return chunk.visibleDemand ? 0 : 1_000;

    const centerX = this.frame.offsetX + chunk.coord.localX + this.grid.chunkSize * 0.5;
    const centerY = this.frame.offsetY + chunk.coord.localY + this.grid.chunkSize * 0.5;
    const viewCenterX = view.x + view.width * 0.5;
    const viewCenterY = view.y + view.height * 0.5;
    const dx = centerX - viewCenterX;
    const dy = centerY - viewCenterY;
    const distance = Math.hypot(dx, dy) / this.grid.chunkSize;
    const movementLength = Math.hypot(this.movementX, this.movementY);
    const directionBias = movementLength > 0
      ? (dx * this.movementX + dy * this.movementY) / movementLength / this.grid.chunkSize
      : 0;
    return (chunk.visibleDemand ? 0 : 1_000) + distance * 16 - directionBias * 24;
  }

  private getRegionPriority(chunk: ResidentChunk, region: { localX: number; localY: number }): number {
    const view = this.lastResidencyView;
    const dirtyBand = chunk.dirtyRegions.has(this.regionKey(region)) ? -600 : 0;
    if (!view) return (chunk.visibleDemand ? 0 : 1_000) + dirtyBand;

    const centerX = this.frame.offsetX + region.localX + 64;
    const centerY = this.frame.offsetY + region.localY + 64;
    const viewCenterX = view.x + view.width * 0.5;
    const viewCenterY = view.y + view.height * 0.5;
    const dx = centerX - viewCenterX;
    const dy = centerY - viewCenterY;
    const distance = Math.hypot(dx, dy) / this.grid.chunkSize;
    const movementLength = Math.hypot(this.movementX, this.movementY);
    const directionBias = movementLength > 0
      ? (dx * this.movementX + dy * this.movementY) / movementLength / this.grid.chunkSize
      : 0;
    // Visible chunks always beat pure prefetch, independent of the layer that owns the job.
    // Within a band, near regions and regions ahead of the camera win first.
    const visibilityBand = chunk.visibleDemand ? 0 : 1_000;
    // Dirty work must win over ordinary prefetch even when it belongs to a neighbouring chunk;
    // visible dirty work therefore also remains in the urgent budget band.
    return visibilityBand + dirtyBand + distance * 16 - directionBias * 24;
  }

  private syncChunkVisibility(chunk: ResidentChunk): void {
    const shouldShow = this.visible && chunk.ready && chunk.visibleDemand;
    for (const [layerId, texture] of chunk.textures) {
      texture.setVisible(shouldShow && (this.layerVisibility.get(layerId) ?? true));
    }
  }

  private regionKey(region: { localX: number; localY: number }): string {
    return `${region.localX}:${region.localY}`;
  }

  private jobKey(chunk: ResidentChunk, regionKey: string): string {
    return `${this.surfaceId}:${chunk.coord.cx}:${chunk.coord.cy}:${regionKey}`;
  }

  private textureJobKey(chunk: ResidentChunk, layerId: string): string {
    return `${this.surfaceId}:${chunk.coord.cx}:${chunk.coord.cy}:texture:${layerId}`;
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
      this.syncChunkVisibility(chunk);
    }
  }
}

function regionsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
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

  /** Erzeugt ein bekanntes Scratch-Ziel bereits im verdeckten Arena-Startup. */
  preallocate(role: string, size: number, renderMode: 'render' | 'redraw' = 'render'): void {
    this.get(role, size, renderMode);
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
