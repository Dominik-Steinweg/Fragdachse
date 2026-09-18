import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, MULTIPLY: 1 },
  Scenes: { Events: { POST_UPDATE: 'postupdate', SHUTDOWN: 'shutdown' } } }));
import {
  copyRgbRegion,
  getTerrainSnapshotRegions,
  getTerrainTexturePhase,
  stampWaterSnapshot,
  TerrainColorSnapshotBuilder,
} from '../src/arena/TerrainColorSnapshotBuilder';
import { TerrainColorSnapshot } from '../src/arena/TerrainColorSnapshot';
import { WATER_COLOR, WaterSurfaceModel } from '../src/arena/WaterSurfaceModel';
import { WaterSurfaceRenderer } from '../src/arena/WaterSurfaceRenderer';
import { DIRT_BLOB_SURFACE_PROFILE } from '../src/arena/BlobSurfaceProfile';
import { stampBlobSurfaceMottle } from '../src/arena/BlobSurfaceMottle';
import { stampGroundCover } from '../src/arena/GroundCoverLayer';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function snapshotBuildFixture() {
  class ReadbackImage {}
  vi.stubGlobal('HTMLImageElement', ReadbackImage);
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({
    drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray([17, 17, 17, 255]) }),
  }) }) });
  const events = new EventEmitter();
  let readback: (image: ReadbackImage) => void = () => {};
  let current = true, prepared = false;
  const scratch = { camera: { setOrigin() {} }, setOrigin() { return this; },
    setVisible() { return this; }, setScrollFactor() { return this; }, destroy: vi.fn(),
    snapshotArea: vi.fn((_x, _y, _width, _height, callback) => { readback = callback; }),
  };
  const masks = [{ x: 0, y: 0, mask: { size: 128, data: new Uint8ClampedArray(128 * 128 * 4).fill(255) } }];
  const water = { isPrepared: () => prepared, getPreparedMasks: vi.fn(() => masks) };
  const onReadbackComplete = vi.fn();
  vi.spyOn(TerrainColorSnapshotBuilder.prototype as any, 'renderRegion').mockImplementation(() => {});
  const builder = new TerrainColorSnapshotBuilder({
    scene: { events, add: { renderTexture: () => scratch } }, mode: 'deathmatch', layout: {},
    worldMetrics: { widthPx: 4, heightPx: 4, offsetX: 100, offsetY: 200 },
    arenaResult: { waterSurface: water }, isCurrent: () => current, onReadbackComplete,
  } as any);
  return { builder, events, scratch, water, onReadbackComplete,
    frame: () => events.emit('postupdate'), read: () => readback(new ReadbackImage()),
    invalidate: () => { current = false; }, prepare: () => { prepared = true; } };
}

describe('TerrainColorSnapshot', () => {
  it('waits for shared masks after readback and releases all loading callbacks on completion', async () => {
    const f = snapshotBuildFixture();
    const done = vi.fn();
    const result = f.builder.build().then(snapshot => { done(); return snapshot; });
    f.frame(); f.read();
    expect(f.onReadbackComplete).toHaveBeenCalledOnce();
    for (let frame = 0; frame < 3; frame++) f.frame();
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled(); expect(f.water.getPreparedMasks).not.toHaveBeenCalled();
    f.prepare(); f.frame(); f.frame();
    expect((await result).sample(102, 202)).toBe(WATER_COLOR);
    expect(f.water.getPreparedMasks).toHaveBeenCalledOnce();
    expect(f.scratch.destroy).toHaveBeenCalledOnce();
    expect(f.events.eventNames()).toEqual([]);
  });

  it.each(['revision', 'shutdown'])('cancels pending readback on %s and ignores a late callback', async reason => {
    const f = snapshotBuildFixture();
    const rejected = expect(f.builder.build()).rejects.toThrow('cancelled');
    f.frame();
    if (reason === 'shutdown') f.events.emit('shutdown'); else { f.invalidate(); f.frame(); }
    await rejected;
    f.read(); f.prepare(); f.frame();
    expect(f.water.getPreparedMasks).not.toHaveBeenCalled();
    expect(f.scratch.destroy).toHaveBeenCalledOnce();
    expect(f.events.eventNames()).toEqual([]);
  });

  it('stamps expanded water across chunk boundaries while retaining dry ground', () => {
    const cells = Array.from({ length: 4 * 4 }, (_, i) => ({ gridX: 12 + i % 4, gridY: 12 + Math.floor(i / 4) }));
    const data = new Uint8Array(256 * 256 * 3).fill(17);
    const renderer = new WaterSurfaceRenderer({} as never,
      { width: 1024, height: 1024, offsetX: 100, offsetY: 200 }, cells, 1);
    while (!renderer.isPrepared()) renderer.prepareMasks();
    const bake = vi.spyOn(WaterSurfaceModel.prototype, 'bakeSteps');
    const masks = [...renderer.getPreparedMasks()];
    const beforeMasks = masks.map(({ mask }) => Array.from(mask.data));
    const work = stampWaterSnapshot(data, 256, 256, renderer.getPreparedMasks());
    expect(work.next().done).toBe(false);
    expect(data.every(value => value === 17)).toBe(true);
    for (const _ of work) { /* loading slices */ }
    const snapshot = new TerrainColorSnapshot(256, 256, 100, 200, data);
    expect(snapshot.sample(100 + 514, 200 + 448)).toBe(WATER_COLOR);
    expect(snapshot.sample(100 + 448, 200 + 514)).toBe(WATER_COLOR);
    expect(snapshot.sample(100 + 540, 200 + 448)).toBe(0x111111);
    const before = data.slice();
    for (const _ of stampWaterSnapshot(data, 256, 256, [])) { /* dry world */ }
    expect(data).toEqual(before);
    expect(bake).not.toHaveBeenCalled();
    expect(masks.map(({ mask }) => Array.from(mask.data))).toEqual(beforeMasks);
    bake.mockRestore();
    renderer.destroy();
    expect(() => [...renderer.getPreparedMasks()]).toThrow('not prepared');
  });
  it('uses fixed 1:4 RGB coordinates with explicit world offsets', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const snapshot = new TerrainColorSnapshot(2, 1, 100, 200, data);

    expect(snapshot.scale).toBe(4);
    expect(snapshot.width).toBe(2);
    expect(snapshot.height).toBe(1);
    expect(snapshot.sample(100, 200)).toBe(0x010203);
    expect(snapshot.sample(103.99, 203.99)).toBe(0x010203);
    expect(snapshot.sample(104, 200)).toBe(0x040506);
    expect(snapshot.sample(99.99, 200)).toBe(snapshot.sample(-1, -1));
  });

  it('requires exactly three RGB bytes per sample pixel', () => {
    expect(() => new TerrainColorSnapshot(2, 3, 0, 0, new Uint8Array(17))).toThrow();
    expect(new TerrainColorSnapshot(2, 3, 0, 0, new Uint8Array(18)).data).toHaveLength(18);
  });

  it('splits a large arena into row-major 512px scratch regions', () => {
    const regions = getTerrainSnapshotRegions(4096, 3072, 128, 256);

    expect(regions).toHaveLength(4);
    expect(regions[0]).toMatchObject({
      worldX: 128, worldY: 256, width: 2048, height: 2048,
      pixelX: 0, pixelY: 0, pixelWidth: 512, pixelHeight: 512,
    });
    expect(regions[1]).toMatchObject({
      worldX: 2176, worldY: 256, width: 2048, height: 2048,
      pixelX: 512, pixelY: 0, pixelWidth: 512, pixelHeight: 512,
    });
    expect(regions[2]).toMatchObject({
      worldX: 128, worldY: 2304, width: 2048, height: 1024,
      pixelX: 0, pixelY: 512, pixelWidth: 512, pixelHeight: 256,
    });
    expect(regions[3]).toMatchObject({
      worldX: 2176, worldY: 2304, width: 2048, height: 1024,
      pixelX: 512, pixelY: 512, pixelWidth: 512, pixelHeight: 256,
    });
  });

  it('assembles separate RGBA readbacks into one contiguous RGB array', () => {
    const regions = getTerrainSnapshotRegions(4096, 4, 0, 0);
    const target = new Uint8Array(1024 * 1 * 3);
    const left = regions[0];
    const right = regions[1];
    const leftRgba = new Uint8Array(left.pixelWidth * left.pixelHeight * 4);
    const rightRgba = new Uint8Array(right.pixelWidth * right.pixelHeight * 4);
    leftRgba.fill(11);
    rightRgba.fill(22);

    copyRgbRegion(leftRgba, target, 1024, left);
    copyRgbRegion(rightRgba, target, 1024, right);

    expect(target).toHaveLength(1024 * 3);
    expect([...target.slice(0, 3)]).toEqual([11, 11, 11]);
    expect([...target.slice((512 * 3) - 3, 512 * 3)]).toEqual([11, 11, 11]);
    expect([...target.slice(512 * 3, 512 * 3 + 3)]).toEqual([22, 22, 22]);
    expect([...target.slice(-3)]).toEqual([22, 22, 22]);
  });

  it('keeps global texture phase continuous at a region boundary', () => {
    const textureSize = 48;
    const firstRegionEdge = getTerrainTexturePhase(128 + 2048 - 1, 128, textureSize);
    const nextRegionStart = getTerrainTexturePhase(128 + 2048, 128, textureSize);

    expect(nextRegionStart).toBe(firstRegionEdge + 1);
    expect(nextRegionStart).not.toBe(0);
  });

  it('maps a region origin to snapshot pixel 0,0 with a top-left camera origin', () => {
    const [region] = getTerrainSnapshotRegions(2048, 2048, 320, 640);
    const renderScale = 0.25;

    expect({
      x: (region.worldX - region.worldX) * renderScale,
      y: (region.worldY - region.worldY) * renderScale,
    }).toEqual({ x: 0, y: 0 });

  });

  it('scales stamp positions and sizes only for the snapshot path', () => {
    const calls: Array<{ x: number; y: number; config: Record<string, number> }> = [];
    const layer = {
      stamp: (_key: string, _frame: undefined, x: number, y: number, config: Record<string, number>) => {
        calls.push({ x, y, config });
        return layer;
      },
    };
    const scene = {
      textures: { getFrame: () => ({ width: 16, height: 8 }), exists: () => true },
    };
    const placement = {
      textureKey: 'cover', worldX: 100, worldY: 200, sizePx: 32,
      rotation: 0.25, alpha: 0.75, mirrorX: false, mirrorY: true, anchor: 'edge' as const,
    };

    stampGroundCover(scene as never, layer as never, [placement], 10, 20);
    stampGroundCover(scene as never, layer as never, [placement], 10, 20, 1, 0.25);

    expect(calls[0]).toMatchObject({ x: 110, y: 220, config: { scaleX: 2, scaleY: -2 } });
    expect(calls[1]).toMatchObject({ x: 35, y: 70, config: { scaleX: 0.5, scaleY: -0.5 } });
  });

  it('scales deterministic mottle stamps while preserving their normal path', () => {
    const record = (renderScale: number) => {
      const calls: Array<{ x: number; y: number; scaleX: number }> = [];
      const layer = {
        stamp: (_key: string, _frame: undefined, x: number, y: number, config: { scaleX: number }) => {
          calls.push({ x, y, scaleX: config.scaleX });
          return layer;
        },
      };
      stampBlobSurfaceMottle(
        { textures: { exists: () => true } } as never,
        layer as never,
        DIRT_BLOB_SURFACE_PROFILE,
        DIRT_BLOB_SURFACE_PROFILE.mottle,
        [{ gridX: 3, gridY: 2 }],
        0,
        0,
        0,
        renderScale,
      );
      return calls[0];
    };

    const normal = record(1);
    const snapshot = record(0.25);
    expect(snapshot.x).toBeCloseTo(normal.x * 0.25, 10);
    expect(snapshot.y).toBeCloseTo(normal.y * 0.25, 10);
    expect(snapshot.scaleX).toBeCloseTo(normal.scaleX * 0.25, 10);
  });

});
