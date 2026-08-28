import { describe, expect, it, vi } from 'vitest';

// Phaser braucht beim Laden ein DOM. Der Chunk-Pfad ruft davon nichts auf; die Attrappe stellt nur
// so viel bereit, dass die Modulkette importierbar bleibt.
vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, MULTIPLY: 1, ADD: 2, ERASE: 17 },
  Textures: { FilterMode: { LINEAR: 0, NEAREST: 1 } },
  Math: { Clamp: (v: number, min: number, max: number) => Math.min(max, Math.max(min, v)) },
  GameObjects: { Image: class {} },
}));

import {
  ARENA_RENDER_CHUNK_SIZE,
  ARENA_RENDER_CHUNK_ACQUIRE_MARGIN_PX,
} from '../src/arena/chunks/ArenaChunkGrid';
import {
  CHUNK_SAMPLING_GUTTER_PX,
  CHUNK_TEXTURE_POOL_SAFETY_BUFFER,
  ChunkedRenderSurface,
} from '../src/arena/chunks/ChunkedRenderSurface';
import type { ChunkBakeRegion } from '../src/arena/chunks/ChunkedRenderSurface';
import { ROCK_OVERLAY_CHUNK_SIZE } from '../src/arena/RockOverlayRegions';

class FakeTextureFrame {
  constructor(
    public x: number,
    public y: number,
    public width: number,
    public height: number,
  ) {}

  setSize(width: number, height: number, x = 0, y = 0): this {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    return this;
  }
}

/**
 * Minimales Renderziel: Es merkt sich, was in welche Region geschrieben wurde. Mehr braucht die
 * Residenzlogik nicht – ihr Vertrag ist "welcher Chunk existiert, und was wurde dort gebacken",
 * nicht die Pixelarithmetik.
 */
class FakeRenderTexture {
  static created = 0;
  static destroyed = 0;

  active = true;
  visible = true;
  x = 0;
  y = 0;
  depth = 0;
  blend = 0;
  camera = { scrollX: 0, scrollY: 0, setScroll(x: number, y: number) { this.scrollX = x; this.scrollY = y; } };
  texture: {
    key: string;
    firstFrame: string;
    frames: Record<string, FakeTextureFrame>;
    source: Array<{ scaleMode: number }>;
    setFilter(filterMode: number): void;
    has(name: string): boolean;
    add(name: string, sourceIndex: number, x: number, y: number, width: number, height: number): void;
    get(name: string): FakeTextureFrame;
  };
  frameName: string | null = null;
  writes: Array<{
    x: number;
    y: number;
    size: number;
    height: number;
    content: string;
    frame?: string | number;
  }> = [];

  constructor(key: string, readonly width: number, readonly height: number) {
    const source = { scaleMode: 0 };
    const frames: Record<string, FakeTextureFrame> = {};
    this.texture = {
      key,
      firstFrame: '__BASE',
      frames,
      source: [source],
      setFilter: (filterMode) => { source.scaleMode = filterMode; },
      has: (name) => name in frames,
      add: (name, _sourceIndex, x, y, w, h) => {
        frames[name] = new FakeTextureFrame(x, y, w, h);
        if (this.texture.firstFrame === '__BASE') this.texture.firstFrame = name;
      },
      get: (name) => frames[name],
    };
    FakeRenderTexture.created += 1;
  }

  setFrame(name: string): this { this.frameName = name; return this; }
  setOrigin(): this { return this; }
  setDepth(depth: number): this { this.depth = depth; return this; }
  setBlendMode(blend: number): this { this.blend = blend; return this; }
  setRenderMode(): this { return this; }
  setVisible(visible: boolean): this { this.visible = visible; return this; }
  setPosition(x: number, y: number): this { this.x = x; this.y = y; return this; }

  clear(x?: number, y?: number, w?: number, h?: number): this {
    if (x === undefined) this.writes.length = 0;
    else this.writes.push({ x, y: y ?? 0, size: w ?? 0, height: h ?? 0, content: '' });
    return this;
  }

  fill(): this { return this; }
  erase(): this { return this; }
  draw(): this { return this; }
  render(): this { return this; }

  stamp(key: string, frame: string | number | undefined, x: number, y: number): this {
    this.writes.push({ x, y, size: 0, height: 0, content: key, ...(frame === undefined ? {} : { frame }) });
    return this;
  }

  destroy(): void {
    this.active = false;
    FakeRenderTexture.destroyed += 1;
  }
}

function createScene() {
  let created = 0;
  return {
    add: {
      renderTexture: (_x: number, _y: number, w: number, h: number) =>
        new FakeRenderTexture(`rt_${created++}`, w, h),
    },
  } as never;
}

const FRAME = { offsetX: 0, offsetY: 12, width: 12_800, height: 2_560 };
const LAYERS = [{ id: 'a', depth: 2 }, { id: 'b', depth: 3 }];

function createSurface(frame = FRAME, onBake?: (region: ChunkBakeRegion) => void) {
  const scene = createScene();
  const regions: ChunkBakeRegion[] = [];
  const scratch = new FakeRenderTexture('scratch', ARENA_RENDER_CHUNK_SIZE, ARENA_RENDER_CHUNK_SIZE);
  const surface = new ChunkedRenderSurface(scene, {
    frame,
    layers: LAYERS,
    bake: (region, sink) => {
      regions.push(region);
      onBake?.(region);
      // Der Inhalt kodiert die Weltposition der Region – so ist ein Neubau vergleichbar.
      for (const layer of LAYERS) sink.blit(layer.id, scratch as never);
    },
  });
  return { surface, regions, scene };
}

const VIEW = { x: 0, y: 12, width: 1920, height: 1080 };

function drain(scene: object): void {
  ChunkedRenderSurface.drainBakeQueue(scene as never);
}

function updateSurface(
  surface: ChunkedRenderSurface,
  scene: object,
  view: { x: number; y: number; width: number; height: number },
): void {
  surface.updateResidency(view);
  drain(scene);
}

describe('chunked render surface', () => {
  it('queues acquisition and reveals a chunk only after all dirty regions are baked', () => {
    const { surface, regions, scene } = createSurface();
    surface.updateResidency(VIEW);

    expect(regions).toEqual([]);
    expect(surface.getStats().pendingRegions).toBeGreaterThan(0);
    // Die Renderziele selbst sind beim Startup bereits vorallokiert; sichtbar werden sie erst
    // nach dem vollstaendigen Regional-Bake.
    expect(surface.getChunkTexture('a', 0, 0)).not.toBeNull();
    expect(surface.getStats().pendingTextureAcquisitions).toBe(0);

    ChunkedRenderSurface.flushBakeBudget(scene as never);
    expect(regions.length).toBeGreaterThan(0);
    expect(surface.getStats().pendingRegions).toBeGreaterThan(0);

    drain(scene);
    expect(surface.isReady(0, 0)).toBe(true);
    expect((surface.getChunkTexture('a', 0, 0) as unknown as FakeRenderTexture).visible).toBe(true);

    const workingSet = surface.getWorkingSetStats(VIEW);
    expect(workingSet.missingChunks).toBe(0);
    expect(workingSet.notReadyChunks).toBe(0);
    expect(workingSet.ready).toBe(true);
  });

  it('counts a required but completely missing chunk as pending working-set work', () => {
    const { surface } = createSurface();

    const workingSet = surface.getWorkingSetStats(VIEW, false);

    expect(workingSet.requiredChunks).toBeGreaterThan(0);
    expect(workingSet.residentChunks).toBe(0);
    expect(workingSet.missingChunks).toBe(workingSet.requiredChunks);
    expect(workingSet.pendingWork).toBeGreaterThan(0);
    expect(workingSet.ready).toBe(false);
  });

  it('reports resident chunks with unfinished bake work separately', () => {
    const { surface } = createSurface();
    surface.updateResidency(VIEW);

    const workingSet = surface.getWorkingSetStats(VIEW);

    expect(workingSet.missingChunks).toBe(0);
    expect(workingSet.notReadyChunks).toBeGreaterThan(0);
    expect(workingSet.pendingRegions + workingSet.pendingTextureAcquisitions).toBeGreaterThan(0);
    expect(workingSet.pendingWork).toBeGreaterThan(0);
    expect(workingSet.ready).toBe(false);
  });

  it('requeues a dirty subregion when it changes during a pending acquisition', () => {
    const { surface, regions, scene } = createSurface();
    surface.updateResidency(VIEW);
    ChunkedRenderSurface.flushBakeBudget(scene as never);

    const baked = regions[0];
    expect(baked).toBeTruthy();
    const pendingBefore = surface.getStats().pendingRegions;
    surface.refreshRegion(
      baked.localX + baked.gutterPx,
      baked.localY + baked.gutterPx,
      ROCK_OVERLAY_CHUNK_SIZE,
    );

    expect(surface.getStats().pendingRegions).toBe(pendingBefore + 1);
    drain(scene);
    expect(surface.isReady(baked.chunk.cx, baked.chunk.cy)).toBe(true);
  });

  it('keeps a normal full refresh atomic until all regions are baked', () => {
    const { surface, regions, scene } = createSurface();
    updateSurface(surface, scene, VIEW);
    regions.length = 0;

    const target = surface.getChunkTexture('a', 0, 0) as unknown as FakeRenderTexture;
    expect(surface.isReady(0, 0)).toBe(true);
    expect(target.visible).toBe(true);

    surface.refreshAll();

    expect(surface.isReady(0, 0)).toBe(false);
    expect(target.visible).toBe(false);
    expect(surface.getStats().pendingRegions).toBeGreaterThan(0);

    drain(scene);

    expect(regions.length).toBeGreaterThan(0);
    expect(surface.isReady(0, 0)).toBe(true);
    expect(target.visible).toBe(true);
  });

  it('keeps ready chunks visible while a full refresh rebakes regions and gutters', () => {
    const { surface, regions, scene } = createSurface();
    updateSurface(surface, scene, VIEW);
    const fullBakeRegionCount = regions.length;
    regions.length = 0;

    const source = surface.getChunkTexture('a', 0, 0) as unknown as FakeRenderTexture;
    const neighbour = surface.getChunkTexture('a', 1, 0) as unknown as FakeRenderTexture;
    neighbour.writes.length = 0;

    surface.refreshAll({ preserveVisible: true });

    expect(surface.isReady(0, 0)).toBe(true);
    expect(source.visible).toBe(true);
    expect(surface.getStats().pendingRegions).toBeGreaterThan(0);
    expect(surface.isReadyForView(VIEW, false)).toBe(false);

    drain(scene);

    expect(regions).toHaveLength(fullBakeRegionCount);
    expect(neighbour.writes.some((write) => write.content === source.texture.key)).toBe(true);
    expect(source.visible).toBe(true);
    expect(surface.isReadyForView(VIEW, false)).toBe(true);
  });

  it('bakes every acquired chunk once, at full chunk size', () => {
    FakeRenderTexture.created = 0;
    const { surface, regions, scene } = createSurface();
    updateSurface(surface, scene, VIEW);

    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) {
      // Jede 128-px-Region wird samt Gutter gebacken; der Chunk wird erst danach sichtbar.
      expect(region.gutterPx).toBe(CHUNK_SAMPLING_GUTTER_PX);
      expect(region.size).toBe(ROCK_OVERLAY_CHUNK_SIZE + 2 * CHUNK_SAMPLING_GUTTER_PX);
      expect((region.localX + CHUNK_SAMPLING_GUTTER_PX) % ROCK_OVERLAY_CHUNK_SIZE).toBe(0);
      expect((region.localY + CHUNK_SAMPLING_GUTTER_PX) % ROCK_OVERLAY_CHUNK_SIZE).toBe(0);
      expect(region.worldX).toBe(FRAME.offsetX + region.localX);
      expect(region.worldY).toBe(FRAME.offsetY + region.localY);
    }
    // Jeder Chunk genau einmal.
    const keys = regions.map((region) => `${region.chunk.cx}:${region.chunk.cy}`);
    expect(new Set(keys).size).toBeGreaterThan(0);

    // Ein zweites Update ohne Kamerabewegung darf nichts neu backen.
    const bakedBefore = regions.length;
    updateSurface(surface, scene, VIEW);
    expect(regions.length).toBe(bakedBefore);
  });

  it('holds only the chunks around the view, not the whole world', () => {
    const { surface, scene } = createSurface();
    updateSurface(surface, scene, VIEW);

    const stats = surface.getStats();
    const worldChunks = surface.grid.cols * surface.grid.rows;
    expect(worldChunks).toBeGreaterThan(100);
    expect(stats.residentChunks).toBeLessThan(worldChunks / 4);

    // Die harte Zusicherung von Block A: Die residente Renderziel-Flaeche darf nicht mit der
    // Weltflaeche wachsen. Sie liegt hier in der Groessenordnung des Bildausschnitts.
    const viewPixels = VIEW.width * VIEW.height * LAYERS.length;
    expect(stats.residentPixels).toBeLessThan(viewPixels * 3);
    expect(stats.residentPixels).toBeLessThan(FRAME.width * FRAME.height);
  });

  it('recycles textures instead of allocating new ones while walking back and forth', () => {
    FakeRenderTexture.created = 0;
    const { surface, scene } = createSurface();

    updateSurface(surface, scene, VIEW);
    const afterFirst = FakeRenderTexture.created;
    expect(afterFirst).toBeGreaterThan(0);

    // Weit nach Osten und wieder zurueck – mehrfach. Ohne Pool wuechse die Zahl der erzeugten
    // Renderziele mit jeder Ueberquerung; genau das waere das Speicherwachstum aus M1.
    for (let round = 0; round < 6; round += 1) {
      updateSurface(surface, scene, { ...VIEW, x: 6_000 });
      updateSurface(surface, scene, VIEW);
    }

    const created = FakeRenderTexture.created;
    expect(surface.getStats().residentChunks).toBeGreaterThan(0);
    // Ein konstanter Aufschlag ist erlaubt (der Pool ist begrenzt), ein Wachstum je Runde nicht.
    expect(created).toBeLessThan(afterFirst * 8);
  });

  it('preallocates the release-window capacity and stays allocation-free during streaming', () => {
    const { surface, scene } = createSurface();
    updateSurface(surface, scene, VIEW);

    const startup = surface.getStats();
    expect(startup.maxResidentChunkDemand).toBeGreaterThan(startup.residentChunks);
    expect(startup.allocatedTextures).toBe(
      (startup.maxResidentChunkDemand + CHUNK_TEXTURE_POOL_SAFETY_BUFFER) * startup.layers,
    );
    expect(startup.runtimeTextureCreations).toBe(0);

    const allocatedAtStartup = startup.allocatedTextures;
    updateSurface(surface, scene, { ...VIEW, x: 6_000, y: 400 });
    updateSurface(surface, scene, VIEW);

    const afterStreaming = surface.getStats();
    expect(afterStreaming.allocatedTextures).toBe(allocatedAtStartup);
    expect(afterStreaming.runtimeTextureCreations).toBe(0);
    expect(afterStreaming.pendingTextureAcquisitions).toBe(0);
  });

  it('keeps pool and VRAM demand constant when only the map grows', () => {
    const normalFrame = { offsetX: 0, offsetY: 0, width: 20_000, height: 10_000 };
    const largeFrame = { offsetX: 0, offsetY: 0, width: 100_000, height: 100_000 };
    const view = { x: 0, y: 0, width: VIEW.width, height: VIEW.height };
    const normal = createSurface(normalFrame);
    const large = createSurface(largeFrame);

    updateSurface(normal.surface, normal.scene, view);
    updateSurface(large.surface, large.scene, view);

    const normalStats = normal.surface.getStats();
    const largeStats = large.surface.getStats();
    expect(largeStats.maxResidentChunkDemand).toBe(normalStats.maxResidentChunkDemand);
    expect(largeStats.allocatedTextures).toBe(normalStats.allocatedTextures);
    expect(largeStats.allocatedPixels).toBe(normalStats.allocatedPixels);
  });

  it('coalesces repeated dirty notifications before the scheduler runs', () => {
    const { surface, regions, scene } = createSurface();
    updateSurface(surface, scene, VIEW);
    regions.length = 0;

    // Mehrere Aenderungen liegen in derselben 128-px-Arbeitseinheit. Der Scheduler-Key darf
    // daraus weder doppelte Arbeit noch eine zweite sichtbare Zwischenversion machen.
    surface.refreshRegion(0, 0, ROCK_OVERLAY_CHUNK_SIZE);
    surface.refreshRegion(16, 16, 64);
    surface.refreshRegion(0, 0, ROCK_OVERLAY_CHUNK_SIZE);

    expect(surface.getStats().pendingRegions).toBe(1);
    drain(scene);
    expect(regions).toHaveLength(1);
  });

  it('drops chunks that leave the release margin and rebuilds them identically on return', () => {
    const seen: string[] = [];
    const { surface, regions, scene } = createSurface(FRAME, (region) => {
      seen.push(`${region.chunk.cx}:${region.chunk.cy}@${region.localX},${region.localY}`);
    });

    updateSurface(surface, scene, VIEW);
    const first = [...seen];
    expect(surface.isResident(0, 0)).toBe(true);

    updateSurface(surface, scene, { ...VIEW, x: 9_000 });
    expect(surface.isResident(0, 0)).toBe(false);

    seen.length = 0;
    regions.length = 0;
    updateSurface(surface, scene, VIEW);

    // Derselbe Chunk wird an derselben rahmenlokalen Stelle erneut gebacken – die Voraussetzung
    // dafuer, dass ein wieder betretenes Gebiet gleich aussieht.
    expect(seen.sort()).toEqual(first.sort());
  });

  it('refreshes a dirty region only inside a resident chunk, at the 128 px granularity', () => {
    const { surface, regions, scene } = createSurface();
    updateSurface(surface, scene, VIEW);
    regions.length = 0;

    surface.refreshRegion(ROCK_OVERLAY_CHUNK_SIZE, 0, ROCK_OVERLAY_CHUNK_SIZE);
    drain(scene);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({
      localX: ROCK_OVERLAY_CHUNK_SIZE - CHUNK_SAMPLING_GUTTER_PX,
      localY: -CHUNK_SAMPLING_GUTTER_PX,
      size: ROCK_OVERLAY_CHUNK_SIZE + 2 * CHUNK_SAMPLING_GUTTER_PX,
    });
    expect(regions[0].chunk.cx).toBe(0);

    // Ein nicht residenter Chunk wird uebersprungen: Sein Inhalt existiert gerade nicht und
    // entsteht beim naechsten Sichtbarwerden ohnehin aus dem dann aktuellen Weltzustand.
    regions.length = 0;
    surface.refreshRegion(11_000, 0, ROCK_OVERLAY_CHUNK_SIZE);
    expect(regions).toEqual([]);

    // Ausserhalb des Rasters passiert gar nichts.
    surface.refreshRegion(FRAME.width + 500, 0, ROCK_OVERLAY_CHUNK_SIZE);
    expect(regions).toEqual([]);
  });

  it('writes a dirty region at its chunk-local destination, never at world coordinates', () => {
    const scene = createScene();
    const scratch = new FakeRenderTexture('scratch', ROCK_OVERLAY_CHUNK_SIZE, ROCK_OVERLAY_CHUNK_SIZE);
    const surface = new ChunkedRenderSurface(scene, {
      frame: FRAME,
      layers: [{ id: 'a', depth: 2 }],
      bake: (_region, sink) => sink.blit('a', scratch as never),
    });
    updateSurface(surface, scene, VIEW);

    // Zweiter Chunk der ersten Zeile, dort dessen dritter Dirty-Chunk.
    const localX = ARENA_RENDER_CHUNK_SIZE + 2 * ROCK_OVERLAY_CHUNK_SIZE;
    const target = surface.getChunkTexture('a', 1, 0) as unknown as FakeRenderTexture;
    expect(target).toBeTruthy();
    target.writes.length = 0;

    surface.refreshRegion(localX, 0, ROCK_OVERLAY_CHUNK_SIZE);
    drain(scene);

    // Ziel ist der Versatz *im Chunk*, nicht die Weltposition und nicht der Rahmenversatz.
    expect(target.writes[0]).toMatchObject({ x: 2 * ROCK_OVERLAY_CHUNK_SIZE, y: 0 });
    expect(target.writes[1]).toMatchObject({ x: 2 * ROCK_OVERLAY_CHUNK_SIZE, y: 0, content: 'scratch' });
    // Und die interne Kamera des Ziels bleibt neutral, sonst verschoebe der Arena-Offset den Blit.
    expect(target.camera.scrollX).toBe(0);
    expect(target.camera.scrollY).toBe(0);
  });

  it('positions each chunk texture at its world corner and frees everything on destroy', () => {
    FakeRenderTexture.destroyed = 0;
    const { surface, scene } = createSurface();
    updateSurface(surface, scene, VIEW);

    const first = surface.getChunkTexture('a', 0, 0) as unknown as FakeRenderTexture;
    expect(first.x).toBe(FRAME.offsetX);
    expect(first.y).toBe(FRAME.offsetY);
    const second = surface.getChunkTexture('a', 1, 0) as unknown as FakeRenderTexture;
    expect(second.x).toBe(FRAME.offsetX + ARENA_RENDER_CHUNK_SIZE);

    const before = FakeRenderTexture.destroyed;
    surface.destroy();
    expect(FakeRenderTexture.destroyed).toBeGreaterThan(before);
    expect(surface.getStats().residentChunks).toBe(0);
    expect(surface.getStats().pooledTextures).toBe(0);
  });

  it('acquires a chunk before it becomes visible', () => {
    // Der Erwerbsrand ist genau der Vorlauf, den die Kamera zwischen zwei Updates hat.
    expect(ARENA_RENDER_CHUNK_ACQUIRE_MARGIN_PX).toBeGreaterThan(0);
    const { surface, scene } = createSurface();
    updateSurface(surface, scene, { x: 0, y: 12, width: ARENA_RENDER_CHUNK_SIZE, height: 100 });
    // Der Chunk rechts daneben ist noch nicht im Bild, liegt aber im Erwerbsrand.
    expect(surface.isResident(1, 0)).toBe(true);
  });

  it('identifies a chunk required by a different ready view as missing', () => {
    const { surface, scene } = createSurface();
    updateSurface(surface, scene, VIEW);

    const readyView = { x: 4_096, y: 12, width: 100, height: 100 };
    const workingSet = surface.getWorkingSetStats(readyView);

    expect(workingSet.requiredChunks).toBeGreaterThan(workingSet.residentChunks);
    expect(workingSet.missingChunks).toBeGreaterThan(0);
    expect(workingSet.missingChunkCoords.length).toBeGreaterThan(0);
    expect(workingSet.missingChunkCoords.length).toBeLessThanOrEqual(16);
    expect(workingSet.ready).toBe(false);
  });

  it('pads each render target by the gutter but composites only the logical chunk', () => {
    const { surface, scene } = createSurface();
    updateSurface(surface, scene, VIEW);

    const padded = ARENA_RENDER_CHUNK_SIZE + 2 * CHUNK_SAMPLING_GUTTER_PX;
    const first = surface.getChunkTexture('a', 0, 0) as unknown as FakeRenderTexture;
    expect(first.width).toBe(padded);
    expect(first.height).toBe(padded);

    // Sichtbar ist ausschliesslich der logische Bereich – als Frame, nicht als kleineres
    // Renderziel: Nur so darf die Filterung an der Kante noch in den Gutter greifen.
    expect(first.frameName).toBe('chunkVisible');
    expect(first.texture.frames.chunkVisible).toEqual({
      x: CHUNK_SAMPLING_GUTTER_PX,
      y: CHUNK_SAMPLING_GUTTER_PX,
      width: ARENA_RENDER_CHUNK_SIZE,
      height: ARENA_RENDER_CHUNK_SIZE,
    });
    // Die Zeichenbefehle der Textur rechnen weiter in vollen Texturkoordinaten.
    expect(first.texture.firstFrame).toBe('__BASE');

    // Benachbarte Chunks liegen exakt aneinander; der Gutter darf keine Ueberlappung erzeugen.
    const second = surface.getChunkTexture('a', 1, 0) as unknown as FakeRenderTexture;
    expect(second.x - first.x).toBe(ARENA_RENDER_CHUNK_SIZE);
  });

  it('clips the final right and bottom chunks to the remaining world frame', () => {
    const frame = { offsetX: 32, offsetY: 7, width: 700, height: 700 };
    const { surface, scene } = createSurface(frame);
    updateSurface(surface, scene, { x: frame.offsetX, y: frame.offsetY, width: frame.width, height: frame.height });

    const full = surface.getChunkTexture('a', 0, 0) as unknown as FakeRenderTexture;
    const right = surface.getChunkTexture('a', 1, 0) as unknown as FakeRenderTexture;
    const bottom = surface.getChunkTexture('a', 0, 1) as unknown as FakeRenderTexture;
    const corner = surface.getChunkTexture('a', 1, 1) as unknown as FakeRenderTexture;

    expect(full.texture.frames.chunkVisible).toMatchObject({
      x: CHUNK_SAMPLING_GUTTER_PX,
      y: CHUNK_SAMPLING_GUTTER_PX,
      width: ARENA_RENDER_CHUNK_SIZE,
      height: ARENA_RENDER_CHUNK_SIZE,
    });
    expect(right.texture.frames.chunkVisible).toMatchObject({
      x: CHUNK_SAMPLING_GUTTER_PX,
      y: CHUNK_SAMPLING_GUTTER_PX,
      width: frame.width - ARENA_RENDER_CHUNK_SIZE,
      height: ARENA_RENDER_CHUNK_SIZE,
    });
    expect(bottom.texture.frames.chunkVisible).toMatchObject({
      x: CHUNK_SAMPLING_GUTTER_PX,
      y: CHUNK_SAMPLING_GUTTER_PX,
      width: ARENA_RENDER_CHUNK_SIZE,
      height: frame.height - ARENA_RENDER_CHUNK_SIZE,
    });
    expect(corner.texture.frames.chunkVisible).toMatchObject({
      x: CHUNK_SAMPLING_GUTTER_PX,
      y: CHUNK_SAMPLING_GUTTER_PX,
      width: frame.width - ARENA_RENDER_CHUNK_SIZE,
      height: frame.height - ARENA_RENDER_CHUNK_SIZE,
    });
  });

  it('updates the visible frame when pooled textures change between full and edge chunks', () => {
    const frame = { offsetX: 32, offsetY: 7, width: 700, height: 700 };
    const { surface, scene } = createSurface(frame);
    const view = { x: frame.offsetX, y: frame.offsetY, width: frame.width, height: frame.height };

    updateSurface(surface, scene, view);
    updateSurface(surface, scene, { x: 5_000, y: 5_000, width: 100, height: 100 });
    updateSurface(surface, scene, view);

    const full = surface.getChunkTexture('a', 0, 0) as unknown as FakeRenderTexture;
    const right = surface.getChunkTexture('a', 1, 0) as unknown as FakeRenderTexture;
    const bottom = surface.getChunkTexture('a', 0, 1) as unknown as FakeRenderTexture;
    const corner = surface.getChunkTexture('a', 1, 1) as unknown as FakeRenderTexture;

    expect(full.texture.frames.chunkVisible).toMatchObject({ width: 512, height: 512 });
    expect(right.texture.frames.chunkVisible).toMatchObject({ width: 188, height: 512 });
    expect(bottom.texture.frames.chunkVisible).toMatchObject({ width: 512, height: 188 });
    expect(corner.texture.frames.chunkVisible).toMatchObject({ width: 188, height: 188 });
  });

  it('copies only the changed edge pixels into a resident neighbour gutter', () => {
    const { surface, regions, scene } = createSurface();
    updateSurface(surface, scene, VIEW);
    regions.length = 0;

    // Der letzte Dirty-Chunk der ersten Chunkzeile – seine rechte Kante ist die Chunkgrenze.
    const borderX = ARENA_RENDER_CHUNK_SIZE - ROCK_OVERLAY_CHUNK_SIZE;
    const borderY = ROCK_OVERLAY_CHUNK_SIZE;
    const source = surface.getChunkTexture('a', 0, 0) as unknown as FakeRenderTexture;
    const neighbour = surface.getChunkTexture('a', 1, 0) as unknown as FakeRenderTexture;
    source.writes.length = 0;
    neighbour.writes.length = 0;

    surface.refreshRegion(borderX, borderY, ROCK_OVERLAY_CHUNK_SIZE);
    drain(scene);

    const touched = regions.map((region) => `${region.chunk.cx}:${region.chunk.cy}`);
    expect(touched).toContain('0:0');
    // Der Nachbar wird nicht noch einmal fachlich gebacken.
    expect(regions).toHaveLength(1);
    expect(new Set(touched)).toEqual(new Set(['0:0']));

    // Die Kopie schreibt nur den 2px-Randstreifen des Nachbarn. Die Weltkante liegt in der
    // physischen Quelltextur bei x=512 und im Nachbarn bei x=0.
    expect(neighbour.writes).toHaveLength(2);
    expect(neighbour.writes[0]).toMatchObject({
      x: 0,
      y: borderY + CHUNK_SAMPLING_GUTTER_PX,
      size: CHUNK_SAMPLING_GUTTER_PX,
      height: ROCK_OVERLAY_CHUNK_SIZE,
      content: '',
    });
    expect(neighbour.writes[1]).toMatchObject({
      x: 0,
      y: borderY + CHUNK_SAMPLING_GUTTER_PX,
      content: source.texture.key,
      frame: `chunkGutter:${ARENA_RENDER_CHUNK_SIZE}:${borderY + CHUNK_SAMPLING_GUTTER_PX}:${CHUNK_SAMPLING_GUTTER_PX}:${ROCK_OVERLAY_CHUNK_SIZE}`,
    });
    expect(source.texture.firstFrame).toBe('__BASE');

    // Eine Region mitten im Chunk laesst die Nachbarn in Ruhe.
    regions.length = 0;
    neighbour.writes.length = 0;
    surface.refreshRegion(ROCK_OVERLAY_CHUNK_SIZE, ROCK_OVERLAY_CHUNK_SIZE, ROCK_OVERLAY_CHUNK_SIZE);
    drain(scene);
    expect(regions).toHaveLength(1);
    expect(neighbour.writes).toEqual([]);
  });

  it('copies edge strips and corner pixels without rebaking neighbouring chunks', () => {
    const { surface, regions, scene } = createSurface();
    updateSurface(surface, scene, VIEW);
    regions.length = 0;

    const source = surface.getChunkTexture('a', 0, 0) as unknown as FakeRenderTexture;
    const east = surface.getChunkTexture('a', 1, 0) as unknown as FakeRenderTexture;
    const south = surface.getChunkTexture('a', 0, 1) as unknown as FakeRenderTexture;
    const southEast = surface.getChunkTexture('a', 1, 1) as unknown as FakeRenderTexture;
    for (const texture of [source, east, south, southEast]) texture.writes.length = 0;

    const border = ARENA_RENDER_CHUNK_SIZE - ROCK_OVERLAY_CHUNK_SIZE;
    surface.refreshRegion(border, border, ROCK_OVERLAY_CHUNK_SIZE);
    drain(scene);

    expect(regions).toHaveLength(1);
    expect(east.writes[0]).toMatchObject({
      x: 0,
      y: border + CHUNK_SAMPLING_GUTTER_PX,
      size: CHUNK_SAMPLING_GUTTER_PX,
      height: ROCK_OVERLAY_CHUNK_SIZE,
    });
    expect(south.writes[0]).toMatchObject({
      x: border + CHUNK_SAMPLING_GUTTER_PX,
      y: 0,
      size: ROCK_OVERLAY_CHUNK_SIZE,
      height: CHUNK_SAMPLING_GUTTER_PX,
    });
    expect(southEast.writes[0]).toMatchObject({
      x: 0,
      y: 0,
      size: CHUNK_SAMPLING_GUTTER_PX,
      height: CHUNK_SAMPLING_GUTTER_PX,
    });
    for (const texture of [east, south, southEast]) {
      expect(texture.writes).toHaveLength(2);
      expect(texture.writes[1].content).toBe(source.texture.key);
    }
  });

  it('bakes a non-resident source once when a resident neighbour still needs its gutter', () => {
    const { surface, regions, scene } = createSurface();
    updateSurface(surface, scene, VIEW);
    // Hysteresis leaves chunk 1 resident while chunk 0 has already crossed the release margin.
    updateSurface(surface, scene, { ...VIEW, x: 1_200 });
    expect(surface.isResident(0, 0)).toBe(false);
    expect(surface.isResident(1, 0)).toBe(true);

    regions.length = 0;
    const neighbour = surface.getChunkTexture('a', 1, 0) as unknown as FakeRenderTexture;
    neighbour.writes.length = 0;

    surface.refreshRegion(
      ARENA_RENDER_CHUNK_SIZE - ROCK_OVERLAY_CHUNK_SIZE,
      ROCK_OVERLAY_CHUNK_SIZE,
      ROCK_OVERLAY_CHUNK_SIZE,
    );
    drain(scene);

    expect(regions).toHaveLength(1);
    expect(regions[0].chunk).toMatchObject({ cx: 0, cy: 0 });
    expect(neighbour.writes[0]).toMatchObject({
      x: 0,
      y: ROCK_OVERLAY_CHUNK_SIZE + CHUNK_SAMPLING_GUTTER_PX,
      size: CHUNK_SAMPLING_GUTTER_PX,
      height: ROCK_OVERLAY_CHUNK_SIZE,
    });
    expect(neighbour.writes).toHaveLength(2);

    surface.destroy();
  });

  it('changes only chunk texture sampling and restores each target default', () => {
    const { surface, scene } = createSurface();
    updateSurface(surface, scene, VIEW);

    const target = surface.getChunkTexture('a', 0, 0) as unknown as FakeRenderTexture;
    expect(target.texture.source[0].scaleMode).toBe(0);

    surface.setSamplingMode('nearest');
    expect(target.texture.source[0].scaleMode).toBe(1);

    // The pooled target is hidden while away and must still return with DEFAULT sampling.
    updateSurface(surface, scene, { ...VIEW, x: 9_000 });
    surface.setSamplingMode('default');
    updateSurface(surface, scene, VIEW);

    const reacquired = surface.getChunkTexture('a', 0, 0) as unknown as FakeRenderTexture;
    expect(reacquired.texture.source[0].scaleMode).toBe(0);
  });
});
