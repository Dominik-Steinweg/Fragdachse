import { describe, expect, it, vi } from 'vitest';

// Phaser braucht beim Laden ein DOM. Der Chunk-Pfad ruft davon nichts auf; die Attrappe stellt nur
// so viel bereit, dass die Modulkette importierbar bleibt.
vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, MULTIPLY: 1, ADD: 2, ERASE: 17 },
  Math: { Clamp: (v: number, min: number, max: number) => Math.min(max, Math.max(min, v)) },
  GameObjects: { Image: class {} },
}));

import {
  ARENA_RENDER_CHUNK_SIZE,
  ARENA_RENDER_CHUNK_ACQUIRE_MARGIN_PX,
} from '../src/arena/chunks/ArenaChunkGrid';
import { ChunkedRenderSurface } from '../src/arena/chunks/ChunkedRenderSurface';
import type { ChunkBakeRegion } from '../src/arena/chunks/ChunkedRenderSurface';
import { ROCK_OVERLAY_CHUNK_SIZE } from '../src/arena/RockOverlayRegions';

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
  texture: { key: string };
  writes: Array<{ x: number; y: number; size: number; content: string }> = [];

  constructor(key: string, readonly width: number, readonly height: number) {
    this.texture = { key };
    FakeRenderTexture.created += 1;
  }

  setOrigin(): this { return this; }
  setDepth(depth: number): this { this.depth = depth; return this; }
  setBlendMode(blend: number): this { this.blend = blend; return this; }
  setRenderMode(): this { return this; }
  setVisible(visible: boolean): this { this.visible = visible; return this; }
  setPosition(x: number, y: number): this { this.x = x; this.y = y; return this; }

  clear(x?: number, y?: number, w?: number): this {
    if (x === undefined) this.writes.length = 0;
    else this.writes.push({ x, y: y ?? 0, size: w ?? 0, content: '' });
    return this;
  }

  fill(): this { return this; }
  erase(): this { return this; }
  draw(): this { return this; }
  render(): this { return this; }

  stamp(key: string, _frame: unknown, x: number, y: number): this {
    this.writes.push({ x, y, size: 0, content: key });
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

function createSurface(onBake?: (region: ChunkBakeRegion) => void) {
  const scene = createScene();
  const regions: ChunkBakeRegion[] = [];
  const scratch = new FakeRenderTexture('scratch', ARENA_RENDER_CHUNK_SIZE, ARENA_RENDER_CHUNK_SIZE);
  const surface = new ChunkedRenderSurface(scene, {
    frame: FRAME,
    layers: LAYERS,
    bake: (region, sink) => {
      regions.push(region);
      onBake?.(region);
      // Der Inhalt kodiert die Weltposition der Region – so ist ein Neubau vergleichbar.
      for (const layer of LAYERS) sink.blit(layer.id, scratch as never);
    },
  });
  return { surface, regions };
}

const VIEW = { x: 0, y: 12, width: 1920, height: 1080 };

describe('chunked render surface', () => {
  it('bakes every acquired chunk once, at full chunk size', () => {
    FakeRenderTexture.created = 0;
    const { surface, regions } = createSurface();
    surface.updateResidency(VIEW);

    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) {
      expect(region.size).toBe(ARENA_RENDER_CHUNK_SIZE);
      expect(region.localX).toBe(region.chunk.localX);
      expect(region.worldX).toBe(FRAME.offsetX + region.localX);
      expect(region.worldY).toBe(FRAME.offsetY + region.localY);
    }
    // Jeder Chunk genau einmal.
    const keys = regions.map((region) => `${region.chunk.cx}:${region.chunk.cy}`);
    expect(new Set(keys).size).toBe(keys.length);

    // Ein zweites Update ohne Kamerabewegung darf nichts neu backen.
    const bakedBefore = regions.length;
    surface.updateResidency(VIEW);
    expect(regions.length).toBe(bakedBefore);
  });

  it('holds only the chunks around the view, not the whole world', () => {
    const { surface } = createSurface();
    surface.updateResidency(VIEW);

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
    const { surface } = createSurface();

    surface.updateResidency(VIEW);
    const afterFirst = FakeRenderTexture.created;
    expect(afterFirst).toBeGreaterThan(0);

    // Weit nach Osten und wieder zurueck – mehrfach. Ohne Pool wuechse die Zahl der erzeugten
    // Renderziele mit jeder Ueberquerung; genau das waere das Speicherwachstum aus M1.
    for (let round = 0; round < 6; round += 1) {
      surface.updateResidency({ ...VIEW, x: 6_000 });
      surface.updateResidency(VIEW);
    }

    const created = FakeRenderTexture.created;
    expect(surface.getStats().residentChunks).toBeGreaterThan(0);
    // Ein konstanter Aufschlag ist erlaubt (der Pool ist begrenzt), ein Wachstum je Runde nicht.
    expect(created).toBeLessThan(afterFirst * 4);
  });

  it('drops chunks that leave the release margin and rebuilds them identically on return', () => {
    const seen: string[] = [];
    const { surface, regions } = createSurface((region) => {
      seen.push(`${region.chunk.cx}:${region.chunk.cy}@${region.localX},${region.localY}`);
    });

    surface.updateResidency(VIEW);
    const first = [...seen];
    expect(surface.isResident(0, 0)).toBe(true);

    surface.updateResidency({ ...VIEW, x: 9_000 });
    expect(surface.isResident(0, 0)).toBe(false);

    seen.length = 0;
    regions.length = 0;
    surface.updateResidency(VIEW);

    // Derselbe Chunk wird an derselben rahmenlokalen Stelle erneut gebacken – die Voraussetzung
    // dafuer, dass ein wieder betretenes Gebiet gleich aussieht.
    expect(seen.sort()).toEqual(first.sort());
  });

  it('refreshes a dirty region only inside a resident chunk, at the 128 px granularity', () => {
    const { surface, regions } = createSurface();
    surface.updateResidency(VIEW);
    regions.length = 0;

    surface.refreshRegion(ROCK_OVERLAY_CHUNK_SIZE, 0, ROCK_OVERLAY_CHUNK_SIZE);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({
      localX: ROCK_OVERLAY_CHUNK_SIZE,
      localY: 0,
      size: ROCK_OVERLAY_CHUNK_SIZE,
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
    surface.updateResidency(VIEW);

    // Zweiter Chunk der ersten Zeile, dort dessen dritter Dirty-Chunk.
    const localX = ARENA_RENDER_CHUNK_SIZE + 2 * ROCK_OVERLAY_CHUNK_SIZE;
    const target = surface.getChunkTexture('a', 1, 0) as unknown as FakeRenderTexture;
    expect(target).toBeTruthy();
    target.writes.length = 0;

    surface.refreshRegion(localX, 0, ROCK_OVERLAY_CHUNK_SIZE);

    // Ziel ist der Versatz *im Chunk*, nicht die Weltposition und nicht der Rahmenversatz.
    expect(target.writes[0]).toMatchObject({ x: 2 * ROCK_OVERLAY_CHUNK_SIZE, y: 0 });
    expect(target.writes[1]).toMatchObject({ x: 2 * ROCK_OVERLAY_CHUNK_SIZE, y: 0, content: 'scratch' });
    // Und die interne Kamera des Ziels bleibt neutral, sonst verschoebe der Arena-Offset den Blit.
    expect(target.camera.scrollX).toBe(0);
    expect(target.camera.scrollY).toBe(0);
  });

  it('positions each chunk texture at its world corner and frees everything on destroy', () => {
    FakeRenderTexture.destroyed = 0;
    const { surface } = createSurface();
    surface.updateResidency(VIEW);

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
    const { surface } = createSurface();
    surface.updateResidency({ x: 0, y: 12, width: ARENA_RENDER_CHUNK_SIZE, height: 100 });
    // Der Chunk rechts daneben ist noch nicht im Bild, liegt aber im Erwerbsrand.
    expect(surface.isResident(1, 0)).toBe(true);
  });
});
