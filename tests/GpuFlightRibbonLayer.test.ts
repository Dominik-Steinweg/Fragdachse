import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
import type { GpuFlightRibbonStore } from '../src/effects/gpu/GpuFlightRibbon';
import { FLIGHT_RIBBON_PAGE_SIZE, FLIGHT_RIBBON_SLOT_WORDS } from '../src/effects/gpu/GpuFlightRibbon';

vi.mock('phaser', () => ({
  BlendModes: { ADD: 1 },
  GameObjects: { Events: { DESTROY: 'destroy' } },
  Renderer: { WebGL: { RenderNodes: {
    RenderNode: class { onRunBegin() {} onRunEnd() {} },
    BatchHandler: class {
      programManager = {
        getCurrentProgramSuite: () => programsReady ? { program: {}, vao: {} } : null,
        setUniform: (name: string, value: unknown) => uniforms.set(name, value),
        applyUniforms() {},
      };
      vertexBufferLayout = { buffer: {
        viewF32: new Float32Array(FLIGHT_RIBBON_PAGE_SIZE * FLIGHT_RIBBON_SLOT_WORDS),
        update(bytes: number, offset = 0) {
          uploads.push({ bytes, offset });
          const start = offset / 4;
          gpuData.set(this.viewF32.subarray(start, start + bytes / 4), start);
        },
      } };
      onRunBegin() {} onRunEnd() {}
    },
  } } },
}));
vi.mock('../src/effects/gpu/GpuVfxAtlas', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/effects/gpu/GpuVfxAtlas')>(),
  GPU_VFX_ATLAS_KEY: 'atlas', GpuVfxFrameId: { FlightCoreStrip: 0 },
  getGpuVfxFrame: () => ({ name: 'strip' }),
}));
const uniforms = new Map<string, unknown>();
const uploads: { bytes: number; offset: number }[] = [];
const gpuData = new Float32Array(FLIGHT_RIBBON_PAGE_SIZE * FLIGHT_RIBBON_SLOT_WORDS);
let programsReady = true;
import { createFlightRibbonLayer, FLIGHT_RIBBON_VERTEX_SHADER } from '../src/effects/gpu/GpuFlightRibbonLayer';

describe('flight ribbon camera transform', () => {
  it.each([0.5, 1, 2])('transforms world positions once at zoom %s, including framebuffer views', (zoom) => {
    // GLSL cannot run in the headless suite: protect its world-to-view boundary directly.
    expect(FLIGHT_RIBBON_VERTEX_SHADER).toMatch(/uViewMatrix\s*\*\s*vec3\(position,\s*1\.0\)/);
    expect(FLIGHT_RIBBON_VERTEX_SHADER).not.toContain('uScroll');
    for (const postFX of [false, true]) {
      uniforms.clear();
      let submitter: { run(context: unknown): void };
      const layer = {
        alpha: 1, frame: { source: { glTexture: {} } },
        setDepth() { return this; }, setBlendMode() { return this; }, setVisible() { return this; },
        setRenderNodeRole(_role: string, node: typeof submitter) { submitter = node; }, once() {},
      };
      const renderer = {
        gl: { TRIANGLES: 4 }, renderNodes: { startStandAloneRender() {} },
        projectionMatrix: { val: [] }, setProjectionMatrixFromDrawingContext: vi.fn(), drawElements() {},
      };
      const scene = { sys: { renderer }, add: { image: () => layer } };
      const store = { pageLive: [1], pageDrawCount: [1], pageVersion: [0], data: new Float32Array(0) };
      createFlightRibbonLayer(scene as unknown as Phaser.Scene, store as unknown as GpuFlightRibbonStore, 0, () => 0);
      const scrollX = 24000, scrollY = 18000;
      // External viewport translation is omitted when rendering into the PostFX framebuffer.
      const viewportX = postFX ? 0 : 120, viewportY = postFX ? 0 : 80;
      const view = { a: zoom, b: 0, c: 0, d: zoom, tx: viewportX - zoom * scrollX, ty: viewportY - zoom * scrollY };
      const context = { camera: { scrollX, scrollY, getViewMatrix: () => view } };
      submitter!.run(context);
      const m = uniforms.get('uViewMatrix') as number[];
      const x = scrollX + 200, y = scrollY + 100;
      expect(m[0] * x + m[3] * y + m[6]).toBe(viewportX + zoom * 200);
      expect(m[1] * x + m[4] * y + m[7]).toBe(viewportY + zoom * 100);
      expect(uniforms.has('uScroll')).toBe(false);
      expect(renderer.setProjectionMatrixFromDrawingContext).toHaveBeenCalledWith(context);
    }
  });
});

describe('flight ribbon persistent GPU data', () => {
  it('prepares the actual shader and first buffer before effects exist, waiting for asynchronous linking', () => {
    uploads.length = 0;
    let submitter: { run(context: unknown): void };
    const layer = {
      alpha: 1, frame: { source: { glTexture: {} } },
      setDepth() { return this; }, setBlendMode() { return this; }, setVisible() { return this; },
      setRenderNodeRole(_role: string, node: typeof submitter) { submitter = node; }, once() {},
    };
    const renderer = {
      gl: { TRIANGLES: 4 }, renderNodes: { startStandAloneRender() {} },
      projectionMatrix: { val: [] }, setProjectionMatrixFromDrawingContext() {}, drawElements: vi.fn(),
    };
    const store = { pageLive: [0, 0], pageDrawCount: [0, 0], pageVersion: [0, 0], pageDirtyStart: [0, 0], pageDirtyEnd: [0, 0], data: new Float32Array(gpuData.length * 2) };
    const ribbon = createFlightRibbonLayer({ sys: { renderer }, add: { image: () => layer } } as unknown as Phaser.Scene,
      store as unknown as GpuFlightRibbonStore, 0, () => 0)!;
    const context = { camera: { getViewMatrix: () => ({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }) } } as unknown as Phaser.Renderer.WebGL.DrawingContext;
    programsReady = false;
    expect(ribbon.prepare(context)).toBe(false);
    expect(uploads).toHaveLength(0);
    programsReady = true;
    expect(ribbon.prepare(context)).toBe(false);
    expect(uploads).toEqual([{ bytes: gpuData.byteLength, offset: 0 }]);
    expect(ribbon.prepare(context)).toBe(true);
    expect(uploads).toHaveLength(2);
    expect(store.pageLive).toEqual([0, 0]);
    renderer.drawElements.mockClear();
    submitter!.run(context);
    expect(renderer.drawElements).not.toHaveBeenCalled();
    store.pageLive[0] = 1; store.pageDrawCount[0] = 1; store.pageVersion[0]++;
    store.pageDirtyEnd[0] = 1; store.data[0] = 42;
    submitter!.run(context);
    expect(uploads.at(-1)?.bytes).toBe(FLIGHT_RIBBON_SLOT_WORDS * 4);
    expect(gpuData[0]).toBe(42);
  });

  it('uploads changed ranges, preserves untouched slots, and catches up after skipped versions', () => {
    uploads.length = 0;
    gpuData.fill(0);
    let submitter: { run(context: unknown): void };
    const layer = {
      alpha: 1, frame: { source: { glTexture: {} } },
      setDepth() { return this; }, setBlendMode() { return this; }, setVisible() { return this; },
      setRenderNodeRole(_role: string, node: typeof submitter) { submitter = node; }, once() {},
    };
    const renderer = {
      gl: { TRIANGLES: 4 }, renderNodes: { startStandAloneRender() {} },
      projectionMatrix: { val: [] }, setProjectionMatrixFromDrawingContext() {}, drawElements: vi.fn(),
    };
    const data = new Float32Array(gpuData.length).fill(0.5);
    const store = { pageLive: [1], pageDrawCount: [12], pageVersion: [1], pageDirtyStart: [0], pageDirtyEnd: [1], data };
    createFlightRibbonLayer({ sys: { renderer }, add: { image: () => layer } } as unknown as Phaser.Scene,
      store as unknown as GpuFlightRibbonStore, 0, () => 0);
    const context = { camera: { getViewMatrix: () => ({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }) } };
    const render = () => submitter!.run(context);
    render();
    expect(uploads).toEqual([{ bytes: data.byteLength, offset: 0 }]);
    expect(Buffer.from(gpuData.buffer).equals(Buffer.from(data.buffer))).toBe(true);
    expect(renderer.drawElements.mock.calls.at(-1)?.[4]).toBe(12 * 9);
    // Clearing retired geometry is just as important as uploading newly live slots.
    data.fill(0, 3 * FLIGHT_RIBBON_SLOT_WORDS, 5 * FLIGHT_RIBBON_SLOT_WORDS);
    store.pageVersion[0]++;
    store.pageDirtyStart[0] = 3; store.pageDirtyEnd[0] = 5;
    render();
    expect(uploads.at(-1)).toEqual({ bytes: 2 * FLIGHT_RIBBON_SLOT_WORDS * 4, offset: 3 * FLIGHT_RIBBON_SLOT_WORDS * 4 });
    expect(Buffer.from(gpuData.buffer).equals(Buffer.from(data.buffer))).toBe(true);
    render();
    expect(uploads).toHaveLength(2);
    // An idle flush retains the last range until a second camera has consumed it.
    store.pageLive[0] = 0;
    data[0] = 8; store.pageVersion[0]++;
    render(); expect(uploads).toHaveLength(2);
    data[10 * FLIGHT_RIBBON_SLOT_WORDS] = 9; store.pageVersion[0]++;
    store.pageDirtyStart[0] = 10; store.pageDirtyEnd[0] = 11; store.pageLive[0] = 1;
    render();
    expect(uploads.at(-1)).toEqual({ bytes: data.byteLength, offset: 0 });
    expect(Buffer.from(gpuData.buffer).equals(Buffer.from(data.buffer))).toBe(true);
  });
});
