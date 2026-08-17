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
  /** Linke obere Ecke der Region in rahmenlokalen Pixeln. */
  readonly localX: number;
  readonly localY: number;
  /** Kantenlaenge der Region; entweder die Chunkgroesse oder eine Dirty-Chunk-Groesse. */
  readonly size: number;
  /** Weltposition der linken oberen Ecke – fuer Scratch-Kameras, die Weltobjekte einlesen. */
  readonly worldX: number;
  readonly worldY: number;
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
  /** Wird einmal je neu erzeugtem Renderziel aufgerufen – z. B. fuer die Arena-Maske. */
  readonly onChunkTextureCreated?: (texture: Phaser.GameObjects.RenderTexture, layerId: string) => void;
}

interface ResidentChunk {
  readonly coord: ArenaChunkCoord;
  readonly textures: Map<string, Phaser.GameObjects.RenderTexture>;
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
  private readonly frame: ChunkWorldFrame;
  private readonly layers: readonly ChunkedSurfaceLayerSpec[];
  private readonly bakeFn: ChunkBakeFn;
  private readonly onChunkTextureCreated?: (texture: Phaser.GameObjects.RenderTexture, layerId: string) => void;
  private readonly resident = new Map<number, ResidentChunk>();
  private readonly pool = new Map<string, Phaser.GameObjects.RenderTexture[]>();
  private readonly layerVisibility = new Map<string, boolean>();
  private visible = true;
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
   * Nicht residente Chunks werden bewusst uebersprungen: Ihr Inhalt existiert gerade nicht und
   * entsteht beim naechsten Sichtbarwerden ohnehin aus dem dann aktuellen Weltzustand.
   */
  refreshRegion(localX: number, localY: number, size: number): void {
    if (this.destroyed) return;
    const coord = this.grid.chunkAt(localX, localY);
    if (!coord) return;
    const chunk = this.resident.get(this.grid.key(coord.cx, coord.cy));
    if (!chunk) return;
    this.runBake(chunk, localX, localY, size);
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

  getStats(): ChunkedRenderSurfaceStats {
    let pooled = 0;
    for (const bucket of this.pool.values()) pooled += bucket.length;
    const chunkPixels = this.grid.chunkSize * this.grid.chunkSize;
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
  }

  // ── Interna ────────────────────────────────────────────────────────────────

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
    if (pooled) return pooled;

    const texture = this.scene.add.renderTexture(0, 0, this.grid.chunkSize, this.grid.chunkSize);
    texture.setOrigin(0, 0);
    texture.setDepth(layer.depth);
    if (layer.blend !== undefined) texture.setBlendMode(layer.blend);
    // Der Inhalt eines Chunks ist dauerhaft chunklokal. Die Weltposition traegt allein das
    // GameObject; eine gescrollte interne Kamera wuerde jeden Blit um den Arena-Offset verschieben.
    texture.camera.setScroll(0, 0);
    this.onChunkTextureCreated?.(texture, layer.id);
    return texture;
  }

  private bakeChunk(chunk: ResidentChunk): void {
    this.runBake(chunk, chunk.coord.localX, chunk.coord.localY, this.grid.chunkSize);
  }

  private runBake(chunk: ResidentChunk, localX: number, localY: number, size: number): void {
    const region: ChunkBakeRegion = {
      chunk: chunk.coord,
      localX,
      localY,
      size,
      worldX: this.frame.offsetX + localX,
      worldY: this.frame.offsetY + localY,
    };
    const destX = localX - chunk.coord.localX;
    const destY = localY - chunk.coord.localY;
    const sink: ChunkBakeSink = {
      blit: (layerId, scratch) => {
        const target = chunk.textures.get(layerId);
        if (!target) return;
        target.clear(destX, destY, size, size);
        target.stamp(scratch.texture.key, undefined, destX, destY, { originX: 0, originY: 0 });
        target.render();
      },
      clearRegion: (layerId) => {
        const target = chunk.textures.get(layerId);
        if (!target) return;
        target.clear(destX, destY, size, size);
        target.render();
      },
      fillRegion: (layerId, color, alpha = 1) => {
        const target = chunk.textures.get(layerId);
        if (!target) return;
        target.clear(destX, destY, size, size);
        target.fill(color, alpha, destX, destY, size, size);
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
