import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
import type { GpuFlightRibbonStore } from '../src/effects/gpu/GpuFlightRibbon';

vi.mock('phaser', () => ({
  BlendModes: { ADD: 1 },
  GameObjects: { Events: { DESTROY: 'destroy' } },
  Renderer: { WebGL: { RenderNodes: {
    RenderNode: class { onRunBegin() {} onRunEnd() {} },
    BatchHandler: class {
      programManager = {
        getCurrentProgramSuite: () => ({ program: {}, vao: {} }),
        setUniform: (name: string, value: unknown) => uniforms.set(name, value),
        applyUniforms() {},
      };
      vertexBufferLayout = { buffer: { viewF32: new Float32Array(0), update() {} } };
      onRunBegin() {} onRunEnd() {}
    },
  } } },
}));
vi.mock('../src/effects/gpu/GpuVfxAtlas', () => ({
  GPU_VFX_ATLAS_KEY: 'atlas', GpuVfxFrameId: { FlightCoreStrip: 0 },
  getGpuVfxFrame: () => ({ name: 'strip' }),
}));
const uniforms = new Map<string, unknown>();
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
      const store = { pageLive: [1], pageVersion: [0], data: new Float32Array(0) };
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
