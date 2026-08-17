import { describe, expect, it, vi } from 'vitest';

// Phaser braucht beim Laden ein DOM. Der Aufraeumpfad ruft davon nichts auf; die Attrappe stellt
// nur so viel bereit, dass die Modulkette von `ArenaBuilder` importierbar bleibt.
vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());
import { ArenaBuilder } from '../src/arena/ArenaBuilder';
import type { ArenaBuilderResult } from '../src/arena/ArenaBuilder';
import { CELL_SIZE } from '../src/config';
import type { ArenaLayout } from '../src/types';
import { createRockOverlaySource, syncRockOverlaySource } from '../src/arena/RockOverlayRegions';
import { GroundSurfaceStreamer } from '../src/arena/chunks/GroundSurfaceStreamer';
import { RockOverlayStreamer } from '../src/arena/chunks/RockOverlayStreamer';
import { createFakeArenaScene, fakeRockImage, FakeRenderTexture } from './fakeArenaRenderScene';

/**
 * Aufraeumen der rundengebundenen Weltschichten.
 *
 * Seit dem Chunk-Streaming haengen an einer Runde nicht mehr ein paar arenagrosse RenderTextures,
 * sondern zwei Streamer mit je residenten Chunk-Zielen, einem Recycling-Pool und einem Satz
 * Scratch-Zielen. Ein vergessener Teil waere kein sichtbarer Fehler, sondern eine ueber die
 * Rundengrenzen hinweg wachsende Zahl toter Texturen – genau das Speicherwachstum, auf das der
 * manuelle Stresstest achtet.
 */

const FRAME = { offsetX: 37, offsetY: 12, width: 256, height: 256 };
const VIEW = { x: FRAME.offsetX, y: FRAME.offsetY, width: FRAME.width, height: FRAME.height };
const ROCKS = [{ gridX: 0, gridY: 1 }, { gridX: 1, gridY: 1 }, { gridX: 2, gridY: 1 }];

function buildResult() {
  const layout = {
    seed: 3,
    rocks: ROCKS,
    trees: [],
    dirt: [{ gridX: 0, gridY: 2 }, { gridX: 1, gridY: 2 }],
    decals: [],
  } as unknown as ArenaLayout;

  const scene = createFakeArenaScene();
  const rockObjects = ROCKS.map((cell) => fakeRockImage(cell.gridX, cell.gridY, CELL_SIZE, FRAME.offsetX, FRAME.offsetY));
  const overlaySource = createRockOverlaySource();
  syncRockOverlaySource(overlaySource, ROCKS);

  const groundSurface = new GroundSurfaceStreamer({
    scene: scene as never,
    frame: FRAME,
    layout,
    groundCoverPlacements: [],
    chunkSize: 128,
  });
  const rockOverlaySurface = new RockOverlayStreamer({
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
      rotation: 0,
      alpha: 1,
      mirrorX: false,
      mirrorY: false,
    }],
    vegetationPlacements: [{
      textureKey: 'rock_vegetation_01_small',
      worldX: FRAME.offsetX + 64,
      worldY: FRAME.offsetY + 32,
      lengthPx: 48,
      bandPx: 24,
      rotation: 0,
      alpha: 1,
      mirrorX: false,
    }],
    chunkSize: 128,
  });
  groundSurface.updateResidency(VIEW);
  rockOverlaySurface.updateResidency(VIEW);

  const result = {
    baseZoneObjects: [],
    rockGroup: { destroy() {} },
    rockObjects: [],
    rockStateTints: [],
    trunkGroup: { destroy() {} },
    trunkObjects: [],
    canopyObjects: [],
    trackObjects: [],
    groundSurface,
    groundCoverPlacements: [{ textureKey: 'ground_cover_01' }],
    rockOverlaySurface,
    rockOverlaySource: overlaySource,
    rockMossPlacements: [{ textureKey: 'rock_moss_01' }],
    rockVegetationPlacements: [{ textureKey: 'rock_veg_01_large' }],
  } as unknown as ArenaBuilderResult;

  return { result, groundSurface, rockOverlaySurface, scene };
}

describe('round-scoped world surface teardown', () => {
  it('destroys every resident chunk target and scratch of both streamers', () => {
    const { result, groundSurface, rockOverlaySurface } = buildResult();

    expect(groundSurface.getStats().residentChunks).toBeGreaterThan(0);
    expect(rockOverlaySurface.getStats().residentChunks).toBeGreaterThan(0);

    const groundChunk = groundSurface.getChunkTexture('dirt', 0, 0) as unknown as FakeRenderTexture;
    const rockChunk = rockOverlaySurface.getChunkTexture('rockMoss', 0, 0) as unknown as FakeRenderTexture;
    expect(groundChunk.active).toBe(true);
    expect(rockChunk.active).toBe(true);

    ArenaBuilder.destroyDynamic(result);

    expect(groundChunk.active).toBe(false);
    expect(rockChunk.active).toBe(false);
    expect(groundSurface.getStats().residentChunks).toBe(0);
    expect(groundSurface.getStats().pooledTextures).toBe(0);
    expect(rockOverlaySurface.getStats().residentChunks).toBe(0);
    expect(rockOverlaySurface.getStats().pooledTextures).toBe(0);

    expect(result.groundSurface).toBeNull();
    expect(result.rockOverlaySurface).toBeNull();
  });

  it('clears every placement set and the material source', () => {
    const { result } = buildResult();

    ArenaBuilder.destroyDynamic(result);

    // Die Platzierungen sind die Quelle jedes Chunk-Bakes; blieben sie stehen, stempelte die
    // naechste Runde die Flecken der vorigen.
    expect(result.rockVegetationPlacements).toHaveLength(0);
    expect(result.rockMossPlacements).toHaveLength(0);
    expect(result.groundCoverPlacements).toHaveLength(0);
    // Und die Materialquelle wuerde sonst Zellen der Vorrunde weiterstempeln.
    expect(result.rockOverlaySource.cells).toHaveLength(0);
    expect(result.rockOverlaySource.keys.size).toBe(0);
  });

  it('is safe to run twice', () => {
    const { result } = buildResult();

    ArenaBuilder.destroyDynamic(result);
    expect(() => ArenaBuilder.destroyDynamic(result)).not.toThrow();
    expect(result.groundSurface).toBeNull();
    expect(result.rockOverlaySurface).toBeNull();
  });

  it('releases the pooled targets of a chunk that was walked away from', () => {
    const { result, rockOverlaySurface } = buildResult();

    // Weglaufen legt die Renderziele in den Pool statt sie zu zerstoeren – der Teardown muss
    // auch diese finden.
    rockOverlaySurface.updateResidency({ x: 100_000, y: 0, width: 100, height: 100 });
    expect(rockOverlaySurface.getStats().residentChunks).toBe(0);
    expect(rockOverlaySurface.getStats().pooledTextures).toBeGreaterThan(0);

    ArenaBuilder.destroyDynamic(result);
    expect(rockOverlaySurface.getStats().pooledTextures).toBe(0);
  });
});
