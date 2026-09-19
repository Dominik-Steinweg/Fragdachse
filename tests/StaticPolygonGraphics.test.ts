import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ batch: vi.fn(), triangulate: vi.fn(), matrix: { a: 2, b: 0, c: 0, d: 3, tx: 10, ty: -5 } }));
vi.mock('phaser', async () => {
  const earcut = (await import('../node_modules/phaser/src/geom/polygon/Earcut.js')).default;
  state.triangulate.mockImplementation(earcut);
  class Graphics {
    alpha = 1;
    lighting = false;
    customRenderNodes = {};
    defaultRenderNodes = { Submitter: { batch: state.batch } };
    triangles: number[][] = [];
    commandBuffer: number[] = [];
    fillStyle() { return this; }
    fillTriangle(...coordinates: number[]) { this.triangles.push(coordinates); this.commandBuffer.push(...coordinates); return this; }
    preDestroy() { this.commandBuffer = []; }
  }
  return { Geom: { Polygon: { Earcut: state.triangulate } },
    GameObjects: { Graphics, GetCalcMatrix: () => ({ calc: {
      getX: (x: number, y: number) => state.matrix.a * x + state.matrix.c * y + state.matrix.tx,
      getY: (x: number, y: number) => state.matrix.b * x + state.matrix.d * y + state.matrix.ty,
    } }) }, Renderer: { WebGL: { Utils: { getTintAppendFloatAlpha: (color: number, alpha: number) => color + alpha * 1_000_000 } } } };
});
import { createStaticPolygonGraphics } from '../src/effects/StaticPolygonGraphics';
import type * as Phaser from 'phaser';

describe('Immutable effect polygons', () => {
  it('culls only fully offscreen contours and rechecks transformed bounds on every render', () => {
    state.batch.mockClear();
    const original = { ...state.matrix };
    const scene = { add: { existing: vi.fn() } } as unknown as Phaser.Scene;
    const layers = [{ polygons: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }]], color: 10, opacity: 1 }];
    const layer = createStaticPolygonGraphics(scene, layers);
    const render = (layer as unknown as { renderWebGL: (...args: unknown[]) => void }).renderWebGL;
    const context = { camera: { addToRenderList: vi.fn() }, useCanvas: false, width: 100, height: 80 };
    try {
      Object.assign(state.matrix, { a: 0, b: 1, c: -1, d: 0, tx: 112, ty: 10 });
      render(null, layer, context);
      expect(state.batch).not.toHaveBeenCalled();
      expect(context.camera.addToRenderList).not.toHaveBeenCalled();
      // Rotated geometry overlaps the edge although its origin lies outside the target.
      state.matrix.tx = 105;
      render(null, layer, context);
      expect(state.batch).toHaveBeenCalledTimes(1);
      // A larger drawing target must not reuse the result from a smaller camera target.
      state.matrix.tx = 112;
      render(null, layer, { ...context, width: 120, useCanvas: true });
      expect(state.batch).toHaveBeenCalledTimes(2);
      Object.assign(state.matrix, { a: -2, b: 0, c: 0, d: -2, tx: 10, ty: 10 });
      render(null, layer, context);
      expect(state.batch).toHaveBeenCalledTimes(3);
    } finally { Object.assign(state.matrix, original); layer.preDestroy(); }
  });

  it('shares triangulation while live effects retain independent transforms, fades and lifetime', () => {
    state.batch.mockClear(); state.triangulate.mockClear();
    const scene = { add: { existing: vi.fn() } } as unknown as Phaser.Scene;
    const layers = [{ polygons: [[{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }]], color: 10, opacity: .8 }];
    const first = createStaticPolygonGraphics(scene, layers), second = createStaticPolygonGraphics(scene, layers);
    expect(state.triangulate).toHaveBeenCalledTimes(1);
    expect(first.commandBuffer).toEqual(second.commandBuffer);
    expect(first.commandBuffer).not.toBe(second.commandBuffer);
    first.preDestroy(); second.alpha = .5;
    const render = (second as unknown as { renderWebGL: (...args: unknown[]) => void }).renderWebGL;
    render(null, second, { camera: { addToRenderList: vi.fn() }, useCanvas: false });
    expect(state.batch.mock.calls[0][1]).toHaveLength(3);
    expect(state.batch.mock.calls[0][3]).toEqual([400010, 400010, 400010]);
    expect(second.commandBuffer.length).toBeGreaterThan(0);
    second.preDestroy();
  });

  it('preserves a concave contour, transform and fade without retriangulating each frame', () => {
    state.batch.mockClear(); state.triangulate.mockClear();
    const scene = { add: { existing: vi.fn() } } as unknown as Phaser.Scene;
    const polygon = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1 },
      { x: 1, y: 1 }, { x: 1, y: 4 }, { x: 0, y: 4 }];
    const layer = createStaticPolygonGraphics(scene, [{ polygons: [polygon], color: 42, opacity: .8 }]);
    const context = { camera: { addToRenderList: vi.fn() }, useCanvas: false };
    const render = (layer as unknown as { renderWebGL: (...args: unknown[]) => void }).renderWebGL;
    layer.alpha = .5;
    render(null, layer, context);
    const [, indexes, vertices, colors] = state.batch.mock.calls[0] as [unknown, number[], number[], number[]];
    let area = 0;
    for (let i = 0; i < indexes.length; i += 3) {
      const [a, b, c] = indexes.slice(i, i + 3).map(index => [vertices[index * 2], vertices[index * 2 + 1]]);
      area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
      // The missing upper-right corner must remain empty after the affine transform.
      const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3;
      expect(cx <= 12 || cy <= -2).toBe(true);
    }
    expect(area).toBe(42); // L area 7, scaled by 2 * 3.
    expect(new Set(colors)).toEqual(new Set([400042]));
    layer.alpha = .25;
    render(null, layer, context);
    expect(new Set(state.batch.mock.calls[1][3])).toEqual(new Set([200042]));
    expect(state.triangulate).toHaveBeenCalledTimes(1);
    layer.preDestroy(); render(null, layer, context);
    expect(state.batch).toHaveBeenCalledTimes(2);
  });

  it('submits overlapping color layers in their original order with a shared fade', () => {
    state.batch.mockClear();
    const scene = { add: { existing: vi.fn() } } as unknown as Phaser.Scene;
    const triangle = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }];
    const layer = createStaticPolygonGraphics(scene, [
      { polygons: [triangle], color: 10, opacity: .8 },
      { polygons: [triangle], color: 20, opacity: .4 },
    ]);
    layer.alpha = .5;
    const render = (layer as unknown as { renderWebGL: (...args: unknown[]) => void }).renderWebGL;
    render(null, layer, { camera: { addToRenderList: vi.fn() }, useCanvas: false });
    expect(state.batch).toHaveBeenCalledTimes(1);
    const [, indexes, , colors] = state.batch.mock.calls[0];
    expect(indexes.slice(0, 3).every((index: number) => index < 3)).toBe(true);
    expect(indexes.slice(3).every((index: number) => index >= 3)).toBe(true);
    expect(colors).toEqual([400010, 400010, 400010, 200020, 200020, 200020]);
    layer.preDestroy();
  });
});
