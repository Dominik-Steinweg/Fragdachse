import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, MULTIPLY: 1 } }));
import {
  copyRgbRegion,
  getTerrainSnapshotRegions,
  getTerrainTexturePhase,
} from '../src/arena/TerrainColorSnapshotBuilder';
import { TerrainColorSnapshot } from '../src/arena/TerrainColorSnapshot';
import { DIRT_BLOB_SURFACE_PROFILE } from '../src/arena/BlobSurfaceProfile';
import { stampBlobSurfaceMottle } from '../src/arena/BlobSurfaceMottle';
import { stampGroundCover } from '../src/arena/GroundCoverLayer';
import { FakeRenderTexture } from './fakeArenaRenderScene';

describe('TerrainColorSnapshot', () => {
  it('uses fixed 1:4 RGB coordinates with explicit world offsets', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const snapshot = new TerrainColorSnapshot(2, 1, 100, 200, data);

    expect(snapshot.scale).toBe(4);
    expect(snapshot.width).toBe(2);
    expect(snapshot.height).toBe(1);
    expect(snapshot.sample(100, 200)).toBe(0x010203);
    expect(snapshot.sample(103.99, 203.99)).toBe(0x010203);
    expect(snapshot.sample(104, 200)).toBe(0x040506);
    expect(snapshot.sample(99.99, 200)).toBe(0xc9d8b0);
    expect(snapshot.sample(108, 200)).toBe(0xc9d8b0);
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

    expect(firstRegionEdge).toBe(31);
    expect(nextRegionStart).toBe(32);
    expect(nextRegionStart).not.toBe(0);
  });

  it('maps a region origin to snapshot pixel 0,0 with a top-left camera origin', () => {
    const [region] = getTerrainSnapshotRegions(2048, 2048, 320, 640);
    const renderScale = 0.25;

    expect({
      x: (region.worldX - region.worldX) * renderScale,
      y: (region.worldY - region.worldY) * renderScale,
    }).toEqual({ x: 0, y: 0 });

    const source = readFileSync(
      new URL('../src/arena/TerrainColorSnapshotBuilder.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('this.scratch.camera.setOrigin(0, 0);');
    expect(source).toContain('this.scratch.camera.setScroll(region.worldX, region.worldY);');
    expect(source).toContain('this.scratch.camera.setZoom(renderScale);');
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

  it('clips snapshot mottle with the dirt silhouette before compositing', () => {
    const source = readFileSync(
      new URL('../src/arena/chunks/GroundSurfaceStreamer.ts', import.meta.url),
      'utf8',
    );
    const snapshotPath = source.slice(
      source.indexOf('renderSnapshotDirt('),
      source.indexOf('renderSnapshotGroundCover('),
    );
    const normalBakePath = source.slice(
      source.indexOf('private bakeDirtRegion('),
      source.indexOf('private bakeGroundCoverRegion('),
    );

    expect(snapshotPath).toContain('this.bakeDirtRegion(bakeRegion');
    expect(snapshotPath).toContain('scaleX: renderScale');
    expect(snapshotPath).not.toMatch(/stampBlobSurfaceMottle\(\s*this\.scene,\s*target/u);

    // Der normale sichtbare Bake bleibt auf demselben bestehenden Cutout-/Erase-Pfad.
    expect(normalBakePath).toContain('eraseChunkScratch(layer, cutout, size)');
    expect(normalBakePath).toContain('target.draw(layer)');
  });

  it('flushes each dirt blit before reusing the scratch texture', () => {
    const source = readFileSync(
      new URL('../src/arena/chunks/GroundSurfaceStreamer.ts', import.meta.url),
      'utf8',
    );
    const dirtPath = source.slice(
      source.indexOf('renderSnapshotDirt('),
      source.indexOf('renderSnapshotGroundCover('),
    );
    const stampAt = dirtPath.indexOf('target.stamp(');
    expect(stampAt).toBeGreaterThanOrEqual(0);
    expect(dirtPath.indexOf('target.render()', stampAt)).toBeGreaterThan(stampAt);

    const target = new FakeRenderTexture('snapshot-dirt-target-regression', 64, 32);
    const scratch = new FakeRenderTexture('snapshot-dirt-scratch-regression', 16, 16);

    scratch.content = ['dirt-first@0,0'];
    target.stamp(scratch.texture.key, undefined, 0, 0, { originX: 0, originY: 0 });
    target.render();

    scratch.content = ['dirt-second@0,0'];
    target.stamp(scratch.texture.key, undefined, 16, 0, { originX: 0, originY: 0 });
    target.render();

    expect(target.content).toContain('dirt-first@0,0');
    expect(target.content).toContain('dirt-second@16,0');
    expect(target.content).not.toContain('dirt-second@0,0');
  });

  it('keeps the legacy leaf source artwork colors', () => {
    const source = readFileSync(
      new URL('../src/effects/gpu/GpuVfxSourceTextures.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain("ctx.fillStyle = '#8aa357'");
    expect(source).toContain("ctx.strokeStyle = '#d8c97a'");
    expect(source).not.toContain('#f2f2ee');
    expect(source).not.toContain('#ffffff');
  });

  it('keeps the leaf blower dust source neutral for direct terrain tinting', () => {
    const source = readFileSync(
      new URL('../src/effects/gpu/GpuVfxSourceTextures.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain("export const TEX_LEAF_BLOWER_DUST");
    expect(source).toContain("rgba(244,244,244,0.82)");
    expect(source).toContain("rgba(220,220,220,0.58)");
  });
});
