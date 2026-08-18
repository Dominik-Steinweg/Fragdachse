import { describe, expect, it, vi } from 'vitest';

// Phaser braucht beim Laden ein DOM. Die Bake-Pfade rufen davon nichts auf; die Attrappe stellt nur
// so viel bereit, dass die Modulkette importierbar bleibt.
vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());
import { CELL_SIZE } from '../src/config';
import type { ArenaLayout, DecalCell } from '../src/types';
import { ROCK_DECAL_LARGE_SIZE, ROCK_DECAL_SIZE, isEnclosedRockDecal } from '../src/arena/DecalConfig';
import { createRockOverlaySource, ROCK_OVERLAY_CHUNK_SIZE, syncRockOverlaySource } from '../src/arena/RockOverlayRegions';
import {
  ROCK_OVERLAY_DECAL_LAYER_ID,
  ROCK_OVERLAY_MOSS_LAYER_ID,
  ROCK_OVERLAY_VEGETATION_LAYER_ID,
  RockOverlayStreamer,
  rockOverlayMottleLayerId,
} from '../src/arena/chunks/RockOverlayStreamer';
import { CHUNK_SAMPLING_GUTTER_PX, ChunkedRenderSurface } from '../src/arena/chunks/ChunkedRenderSurface';
import { createFakeArenaScene, fakeRockImage, FakeRenderTexture } from './fakeArenaRenderScene';

/**
 * Die gestreamten Fels-Overlays.
 *
 * Seit dem Chunk-Streaming gibt es nur noch **einen** Bake-Pfad: Der erste Aufbau eines Chunks und
 * jeder spaetere Dirty-Neubau laufen durch dieselbe Funktion, nur mit anderer Regionsgroesse. Die
 * frueher noetige Paritaet zwischen Vollbake und lokalem Neubau ist damit keine Zusicherung mehr,
 * sondern Konstruktion – geprueft wird stattdessen, dass ein *verworfener und wieder aufgebauter*
 * Chunk gleich aussieht, denn genau das passiert jetzt beim Hin- und Herlaufen ueber die Karte.
 */

const FRAME = { offsetX: 37, offsetY: 12, width: 256, height: 256 };
/** Ein Render-Chunk gleich einem Dirty-Chunk: So bleibt jede Region im Test einzeln adressierbar. */
const CHUNK = ROCK_OVERLAY_CHUNK_SIZE;
const FULL_VIEW = { x: FRAME.offsetX, y: FRAME.offsetY, width: FRAME.width, height: FRAME.height };
const FAR_AWAY = { x: FRAME.offsetX + 100_000, y: FRAME.offsetY, width: 200, height: 200 };

const LARGE_CORE_DECAL = 'rock_moss_carpet';
const SMALL_EDGE_DECAL = 'rock_moss_fringe';

function decal(textureKey: string, gridX: number, gridY: number, displaySize: number): DecalCell {
  return {
    gridX,
    gridY,
    textureKey,
    offsetX: 0,
    offsetY: 0,
    terrain: 'rock',
    surface: 'rock',
    displaySize,
    rotation: 0.25,
  } as unknown as DecalCell;
}

interface FixtureOptions {
  readonly rocks?: ReadonlyArray<{ gridX: number; gridY: number }>;
  readonly decals?: readonly DecalCell[];
}

/** Vier Felsen in einer Reihe; Moos und Vegetation liegen klar im linken Chunk. */
const ROW_ROCKS = [
  { gridX: 0, gridY: 1 },
  { gridX: 1, gridY: 1 },
  { gridX: 2, gridY: 1 },
  { gridX: 3, gridY: 1 },
];

function buildFixture(options: FixtureOptions = {}) {
  const rocks = options.rocks ?? ROW_ROCKS;
  const decals = options.decals ?? [];
  const layout = { seed: 7, rocks, trees: [], decals } as unknown as ArenaLayout;
  const rockObjects: Array<ReturnType<typeof fakeRockImage> | null> =
    rocks.map((cell) => fakeRockImage(cell.gridX, cell.gridY, CELL_SIZE, FRAME.offsetX, FRAME.offsetY));

  // Zustand nach dem Rundenaufbau: Die Materialquelle steht bereits, eine spaetere Zerstoerung ist
  // damit die einzige Aenderung und bestimmt die Chunk-Auswahl allein.
  const overlaySource = createRockOverlaySource();
  syncRockOverlaySource(overlaySource, rocks);

  const scene = createFakeArenaScene();
  const streamer = new RockOverlayStreamer({
    scene: scene as never,
    frame: FRAME,
    layout,
    rockObjects,
    overlaySource,
    mossPlacements: [{
      textureKey: 'rock_moss_01',
      worldX: FRAME.offsetX + 48,
      worldY: FRAME.offsetY + 48,
      sizePx: 32,
      rotation: 0.25,
      alpha: 0.8,
      mirrorX: false,
      mirrorY: true,
    }],
    vegetationPlacements: [{
      textureKey: 'rock_vegetation_01_small',
      worldX: FRAME.offsetX + 64,
      worldY: FRAME.offsetY + 32,
      lengthPx: 48,
      bandPx: 24,
      rotation: 0,
      alpha: 0.9,
      mirrorX: true,
    }],
    chunkSize: CHUNK,
  });
  streamer.updateResidency(FULL_VIEW);
  ChunkedRenderSurface.drainBakeQueue(scene as never);

  return { scene, layout, streamer, rockObjects, overlaySource };
}

function chunkTexture(streamer: RockOverlayStreamer, layerId: string, cx: number, cy: number): FakeRenderTexture {
  const texture = streamer.getChunkTexture(layerId, cx, cy);
  expect(texture, `chunk ${cx}:${cy} of layer ${layerId} must be resident`).toBeTruthy();
  return texture as unknown as FakeRenderTexture;
}

/** Was zuletzt in diesen Chunk geschrieben wurde. */
function lastBlit(texture: FakeRenderTexture): string[] {
  return texture.blits.at(-1)?.content ?? [];
}

/**
 * Rahmenlokale Zeichenposition in eine Texturposition des Chunks.
 *
 * Ein Renderziel beginnt eine Gutterbreite *vor* seinem logischen Chunk – dort liegt die
 * Nachbarschaft, die die Filterung an der Chunkkante braucht. Texturkoordinaten sind deshalb um
 * genau diese Breite gegenueber dem Chunkinhalt versetzt.
 */
function inChunk(key: string, localX: number, localY: number): string {
  return `${key}@${localX + CHUNK_SAMPLING_GUTTER_PX},${localY + CHUNK_SAMPLING_GUTTER_PX}`;
}

describe('rock overlay streamer', () => {
  it('bakes each resident chunk chunk-locally, never at world coordinates', () => {
    const { streamer } = buildFixture();

    // Der linke Chunk traegt Moos, der rechte nicht.
    const left = chunkTexture(streamer, ROCK_OVERLAY_MOSS_LAYER_ID, 0, 0);
    const right = chunkTexture(streamer, ROCK_OVERLAY_MOSS_LAYER_ID, 1, 0);
    expect(lastBlit(left)).toEqual([inChunk('rock_moss_01', 48, 48)]);
    expect(lastBlit(right)).toEqual([]);

    // Jeder Blit sitzt am chunklokalen Ursprung, und die Zielkamera bleibt neutral – sonst
    // verschoebe der Arena-Offset (hier 37/12) den Inhalt.
    for (const texture of [left, right]) {
      expect(texture.blits.at(-1)).toMatchObject({ localX: 0, localY: 0, drawX: 0, drawY: 0 });
      expect(texture.camera.scrollX).toBe(0);
      expect(texture.camera.scrollY).toBe(0);
    }

    // Und das Renderziel selbst steht an der Weltecke seines Chunks.
    expect(right.x).toBe(FRAME.offsetX + CHUNK);
    expect(right.y).toBe(FRAME.offsetY);
  });

  it('does not leak the previous chunk into a chunk without any placements', () => {
    const { scene, streamer, rockObjects } = buildFixture();

    rockObjects[2] = null; // Zelle (2, 1) zerstoert
    streamer.refreshRegions(new Set([2]));
    ChunkedRenderSurface.drainBakeQueue(scene as never);

    // Die Zerstoerung zieht wegen des Maskenrands beide Chunks in den Neubau; ohne den
    // ausgefuehrten Leerbefehl traege der rechte danach den Inhalt des linken.
    for (const layerId of [ROCK_OVERLAY_MOSS_LAYER_ID, ROCK_OVERLAY_VEGETATION_LAYER_ID]) {
      expect(lastBlit(chunkTexture(streamer, layerId, 1, 0))).toEqual([]);
    }
    expect(lastBlit(chunkTexture(streamer, ROCK_OVERLAY_MOSS_LAYER_ID, 0, 0)))
      .toEqual([inChunk('rock_moss_01', 48, 48)]);
    expect(lastBlit(chunkTexture(streamer, ROCK_OVERLAY_VEGETATION_LAYER_ID, 0, 0)))
      .toEqual([inChunk('rock_vegetation_01_small', 64, 32)]);
  });

  it('keeps the material source stable across destruction', () => {
    const { scene, streamer, rockObjects, overlaySource } = buildFixture();
    const before = [...overlaySource.cells];

    rockObjects[1] = null;
    rockObjects[2] = null;
    streamer.refreshRegions(new Set([1, 2]));
    ChunkedRenderSurface.drainBakeQueue(scene as never);

    // Schruempfte die Quelle mit den gefallenen Felsen, spraengen ihre Materialflecken auf den
    // unveraenderten Nachbarn um.
    expect(overlaySource.cells).toEqual(before);
  });

  it('rebuilds a revisited chunk identically', () => {
    const { scene, streamer } = buildFixture();
    const layerIds = [
      rockOverlayMottleLayerId(0),
      ROCK_OVERLAY_MOSS_LAYER_ID,
      ROCK_OVERLAY_VEGETATION_LAYER_ID,
    ];
    const before = layerIds.map((layerId) => lastBlit(chunkTexture(streamer, layerId, 0, 0)));

    // Weit weglaufen: Der Chunk wird verworfen und sein Renderziel recycelt.
    streamer.updateResidency(FAR_AWAY);
    ChunkedRenderSurface.drainBakeQueue(scene as never);
    expect(streamer.getChunkTexture(ROCK_OVERLAY_MOSS_LAYER_ID, 0, 0)).toBeNull();

    // Und wieder zurueck.
    streamer.updateResidency(FULL_VIEW);
    ChunkedRenderSurface.drainBakeQueue(scene as never);
    const after = layerIds.map((layerId) => lastBlit(chunkTexture(streamer, layerId, 0, 0)));

    expect(after).toEqual(before);
    // Nicht nur gleich lang, sondern tatsaechlich befuellt – ein leerer Vergleich zeigte nichts.
    expect(after[0].length).toBeGreaterThan(0);
  });

  it('holds render targets only around the view', () => {
    const { scene, streamer } = buildFixture();
    const all = streamer.getStats().residentChunks;
    expect(all).toBeGreaterThan(1);

    streamer.updateResidency(FAR_AWAY);
    ChunkedRenderSurface.drainBakeQueue(scene as never);
    expect(streamer.getStats().residentChunks).toBe(0);
  });
});

describe('rock decal cutout inside the streamer', () => {
  /** Ein 3x3-Block, damit die Mittelzelle beim Fallen echte Nachbarn behaelt. */
  const BLOCK = [
    { gridX: 0, gridY: 0 }, { gridX: 1, gridY: 0 }, { gridX: 2, gridY: 0 },
    { gridX: 0, gridY: 1 }, { gridX: 1, gridY: 1 }, { gridX: 2, gridY: 1 },
    { gridX: 0, gridY: 2 }, { gridX: 1, gridY: 2 }, { gridX: 2, gridY: 2 },
  ];
  const CENTER_ID = BLOCK.findIndex((cell) => cell.gridX === 1 && cell.gridY === 1);
  const DECALS = [
    decal(SMALL_EDGE_DECAL, 0, 0, ROCK_DECAL_SIZE),
    decal(LARGE_CORE_DECAL, 1, 1, ROCK_DECAL_LARGE_SIZE),
    decal(SMALL_EDGE_DECAL, 1, 1, ROCK_DECAL_SIZE),
    decal(SMALL_EDGE_DECAL, 2, 2, ROCK_DECAL_SIZE),
  ];

  function buildDecalFixture() {
    return buildFixture({ rocks: BLOCK, decals: DECALS });
  }

  it('marks the large mats as enclosed and the small edge decals as not', () => {
    // Auf dieser Unterscheidung ruht die ganze Regel: Nur eine `core`-Matte liegt vollstaendig auf
    // Fels und darf deshalb rein geometrisch beschnitten werden.
    expect(isEnclosedRockDecal(LARGE_CORE_DECAL)).toBe(true);
    expect(isEnclosedRockDecal(SMALL_EDGE_DECAL)).toBe(false);
  });

  it('cuts nothing while every source cell still carries a rock', () => {
    const { streamer } = buildDecalFixture();
    const texture = chunkTexture(streamer, ROCK_OVERLAY_DECAL_LAYER_ID, 0, 0);
    const drawn = lastBlit(texture);
    // Alle vier Decals liegen im ersten Chunk und werden gezeichnet.
    expect(drawn).toHaveLength(DECALS.length);
    expect(drawn.some((entry) => entry.startsWith(LARGE_CORE_DECAL))).toBe(true);
  });

  it('keeps a large mat whose anchor cell fell and drops the small decal on it', () => {
    const { scene, streamer, rockObjects } = buildDecalFixture();

    rockObjects[CENTER_ID] = null;
    streamer.refreshRegions(new Set([CENTER_ID]));
    ChunkedRenderSurface.drainBakeQueue(scene as never);

    const drawn = lastBlit(chunkTexture(streamer, ROCK_OVERLAY_DECAL_LAYER_ID, 0, 0));
    // Die `core`-Matte liegt per Konstruktion vollstaendig auf Fels; sie bleibt stehen und
    // verliert nur das Quadrat der gefallenen Zelle.
    expect(drawn.some((entry) => entry.startsWith(LARGE_CORE_DECAL))).toBe(true);
    // Das kleine Kantendecal derselben Zelle darf die Kante ueberragen – sein Ueberhang laege
    // sonst frei auf dem Boden, also verschwindet es ganz.
    expect(drawn.filter((entry) => entry.startsWith(SMALL_EDGE_DECAL))).toHaveLength(2);
  });

  it('erases exactly the square of the fallen cell, nothing else', () => {
    const { scene, streamer, rockObjects } = buildDecalFixture();
    const texture = chunkTexture(streamer, ROCK_OVERLAY_DECAL_LAYER_ID, 0, 0);
    const before = texture.snapshotPixels();

    rockObjects[CENTER_ID] = null;
    streamer.refreshRegions(new Set([CENTER_ID]));
    ChunkedRenderSurface.drainBakeQueue(scene as never);
    const after = texture.snapshotPixels();

    const cleared: Array<{ x: number; y: number }> = [];
    for (let index = 0; index < before.length; index += 1) {
      if (before[index] === 1 && after[index] === 0) {
        cleared.push({ x: index % texture.width, y: Math.floor(index / texture.width) });
      }
    }
    expect(cleared.length).toBeGreaterThan(0);
    // Jeder geloeschte Pixel liegt im Zellquadrat des gefallenen Felsens – kein
    // Silhouettenschnitt, der die abgerundeten Ecken ueberlebender Nachbarn mitnaehme.
    // Texturkoordinaten liegen um den Gutter vor dem Chunkinhalt.
    const cellMin = CELL_SIZE + CHUNK_SAMPLING_GUTTER_PX;
    for (const pixel of cleared) {
      expect(pixel.x).toBeGreaterThanOrEqual(cellMin);
      expect(pixel.x).toBeLessThan(cellMin + CELL_SIZE);
      expect(pixel.y).toBeGreaterThanOrEqual(cellMin);
      expect(pixel.y).toBeLessThan(cellMin + CELL_SIZE);
    }
  });
});
