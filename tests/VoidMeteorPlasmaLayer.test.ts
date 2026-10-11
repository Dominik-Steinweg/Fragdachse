import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
import { VoidMeteorPlasmaLayer } from '../src/effects/gpu/VoidMeteorPlasmaLayer';

type Subscription = { event: string; callback: unknown; context: unknown };
function eventSource() {
  const subscriptions: Subscription[] = [];
  return {
    subscriptions,
    on(event: string, callback: unknown, context: unknown) {
      subscriptions.push({ event, callback, context });
    },
    off: vi.fn((event: string, callback: unknown, context: unknown) => {
      const index = subscriptions.findIndex((s) => s.event === event && s.callback === callback && s.context === context);
      if (index !== -1) subscriptions.splice(index, 1);
    }),
  };
}

interface MockBatch {
  ready: boolean;
  config: { instancesPerBatch: number; verticesPerInstance: number };
  uniforms: Map<string, Float32Array>;
  indexBuffer: object;
  vertexBufferLayout: { buffer: { viewF32: Float32Array; update: ReturnType<typeof vi.fn> } };
  suite: { program: object; vao: { destroy: ReturnType<typeof vi.fn> } };
}
const batches: MockBatch[] = [];

vi.mock('../src/effects/EffectUtils', () => ({ registerGraphicsObject: vi.fn() }));
vi.mock('phaser', () => ({
  GameObjects: { Events: { DESTROY: 'destroy' } },
  Utils: { Array: { Remove: (array: unknown[], item: unknown) => {
    const index = array.indexOf(item);
    if (index !== -1) array.splice(index, 1);
  } } },
  Renderer: {
    Events: { SET_PARALLEL_TEXTURE_UNITS: 'textureUnits', RESIZE: 'resize' },
    WebGL: { RenderNodes: {
      RenderNode: class { onRunBegin() {} onRunEnd() {} },
      BatchHandler: class {
        ready = true;
        uniforms = new Map<string, Float32Array>();
        suite = { program: {}, vao: { destroy: vi.fn() } };
        indexBuffer = {};
        vertexBufferLayout = { buffer: { viewF32: new Float32Array(12), update: vi.fn() } };
        programManager = {
          programs: { plasma: this.suite },
          getCurrentProgramSuite: () => this.ready ? this.suite : null,
          setUniform: (name: string, value: Float32Array) => this.uniforms.set(name, value),
          applyUniforms: vi.fn(),
        };
        topology: number;
        constructor(public manager: ReturnType<typeof eventSource> & {
          renderer: ReturnType<typeof eventSource> & { glVAOWrappers: unknown[] };
        }, public config: MockBatch['config'] & { topology: number }) {
          this.topology = config.topology;
          manager.on('textureUnits', this.updateTextureCount, this);
          manager.renderer.on('resize', this.resize, this);
          manager.renderer.glVAOWrappers.push(this.suite.vao);
          batches.push(this);
        }
        updateTextureCount() {} resize() {} onRunBegin() {} onRunEnd() {}
      },
    } },
  },
}));

function setup() {
  let submitter: { run(context: unknown): void };
  let onDestroy: (() => void) | undefined;
  const image = {
    name: '', visible: true,
    setDepth() { return this; },
    setVisible(visible: boolean) { this.visible = visible; return this; },
    setRenderNodeRole(_role: string, node: typeof submitter) { submitter = node; },
    once(_event: string, callback: () => void) { onDestroy = callback; },
    destroy: vi.fn(() => { const callback = onDestroy; onDestroy = undefined; callback?.(); }),
  };
  const renderer = {
    ...eventSource(), gl: { TRIANGLES: 4 }, glVAOWrappers: [] as unknown[],
    projectionMatrix: { val: new Float32Array(16) },
    setProjectionMatrixFromDrawingContext: vi.fn(), drawElements: vi.fn(), deleteBuffer: vi.fn(),
  };
  const manager = { ...eventSource(), renderer, startStandAloneRender: vi.fn() };
  const scene = { sys: { renderer: { ...renderer, renderNodes: manager } }, add: { image: vi.fn(() => image) } };
  const layer = new VoidMeteorPlasmaLayer(scene as unknown as Phaser.Scene);
  const batch = batches.at(-1)!;
  const view = { a: 1.25, b: 0, c: 0, d: 1.25, tx: -900, ty: -450 };
  const context = { useCanvas: false, camera: { getViewMatrix: vi.fn(() => view) } };
  return { layer, image, renderer, manager, batch, context, view, render: () => submitter.run(context) };
}

beforeEach(() => { batches.length = 0; });

describe('VoidMeteorPlasmaLayer', () => {
  it('stays hidden until synced and clear stops rendering without losing reusable resources', () => {
    const h = setup();
    expect(h.image.visible).toBe(false);
    h.render();
    expect(h.renderer.drawElements).not.toHaveBeenCalled();
    h.layer.sync(20, 30, 100, 0, 1, 42, 0.5, 1);
    h.render();
    expect(h.image.visible).toBe(true);
    expect(h.renderer.drawElements).toHaveBeenCalledTimes(1);
    h.layer.clear();
    h.render();
    expect(h.image.visible).toBe(false);
    expect(h.renderer.drawElements).toHaveBeenCalledTimes(1);
    expect(h.renderer.deleteBuffer).not.toHaveBeenCalled();
    h.layer.sync(40, 50, 100, 0, 2, 42, 0.5, 1);
    h.render();
    expect(h.image.visible).toBe(true);
    expect(h.renderer.drawElements).toHaveBeenCalledTimes(2);
    h.layer.destroy();
  });

  it('reuses one quad, uniform storage and texture list while updating deterministic late-join state', () => {
    const h = setup();
    const buffer = h.batch.vertexBufferLayout.buffer;
    const subarray = vi.spyOn(buffer.viewF32, 'subarray');
    h.layer.sync(120, 240, 100, 0.5, 2.25, 123456, 0.6, 0.8);
    h.render();
    const geometry = h.batch.uniforms.get('uGeometry')!;
    const plasma = h.batch.uniforms.get('uPlasma')!;
    const view = h.batch.uniforms.get('uViewMatrix')!;
    const originalPlasma = Array.from(plasma);
    const textures = h.renderer.drawElements.mock.calls[0][1];
    expect(h.batch.config.instancesPerBatch).toBe(1);
    expect(Array.from(geometry)).toEqual([120, 240, 100, 0.5]);
    h.layer.sync(360, 480, 90, 1, 3, 42, 2, 2);
    h.view.tx = -1000;
    h.render();
    expect(h.batch.uniforms.get('uGeometry')).toBe(geometry);
    expect(h.batch.uniforms.get('uPlasma')).toBe(plasma);
    expect(h.batch.uniforms.get('uViewMatrix')).toBe(view);
    expect(Array.from(geometry)).toEqual([360, 480, 90, 1]);
    expect(plasma[0]).toBe(3);
    expect(plasma[2]).toBe(1);
    expect(plasma[3]).toBe(1);
    expect(view[6]).toBe(-1000);
    expect(h.renderer.drawElements.mock.calls[1][1]).toBe(textures);
    h.layer.clear();
    h.layer.sync(120, 240, 100, 0.5, 2.25, 123456, 0.6, 0.8);
    h.render();
    expect(Array.from(plasma)).toEqual(originalPlasma);
    const lateJoin = setup();
    lateJoin.layer.sync(120, 240, 100, 0.5, 2.25, 123456, 0.6, 0.8);
    lateJoin.render();
    expect(Array.from(lateJoin.batch.uniforms.get('uPlasma')!)).toEqual(originalPlasma);
    expect(buffer.update).toHaveBeenCalledExactlyOnceWith();
    expect(subarray).not.toHaveBeenCalled();
    expect(h.context.camera.getViewMatrix).toHaveBeenCalledWith(true);
    h.layer.destroy();
    lateJoin.layer.destroy();
  });

  it('waits for shader linking before uploading or drawing', () => {
    const h = setup();
    h.batch.ready = false;
    h.layer.sync(20, 30, 100, 0, 1, 42, 0.5, 1);
    h.render();
    expect(h.batch.vertexBufferLayout.buffer.update).not.toHaveBeenCalled();
    expect(h.renderer.drawElements).not.toHaveBeenCalled();
    h.batch.ready = true;
    h.render();
    expect(h.batch.vertexBufferLayout.buffer.update).toHaveBeenCalledTimes(1);
    expect(h.renderer.drawElements).toHaveBeenCalledTimes(1);
    h.layer.destroy();
  });

  it.each([NaN, Infinity, -1, 0])('hides invalid radius %s instead of submitting invalid geometry', (radius) => {
    const h = setup();
    h.layer.sync(20, 30, 100, 0, 1, 42, 0.5, 1);
    h.layer.sync(20, 30, radius, 0, 1, 42, 0.5, 1);
    h.render();
    expect(h.image.visible).toBe(false);
    expect(h.renderer.drawElements).not.toHaveBeenCalled();
    h.layer.destroy();
  });

  it.each([false, true])('disposes both subscriptions and GPU resources once (scene first: %s)', (sceneFirst) => {
    const h = setup();
    expect(h.manager.subscriptions).toHaveLength(1);
    expect(h.renderer.subscriptions).toHaveLength(1);
    if (sceneFirst) h.image.destroy();
    h.layer.destroy();
    h.layer.destroy();
    h.image.destroy();
    expect(h.manager.subscriptions).toEqual([]);
    expect(h.renderer.subscriptions).toEqual([]);
    expect(h.manager.off).toHaveBeenCalledTimes(1);
    expect(h.renderer.off).toHaveBeenCalledTimes(1);
    expect(h.renderer.deleteBuffer.mock.calls.map(([buffer]) => buffer)).toEqual([
      h.batch.indexBuffer, h.batch.vertexBufferLayout.buffer,
    ]);
    expect(h.batch.suite.vao.destroy).toHaveBeenCalledTimes(1);
    expect(h.renderer.glVAOWrappers).toEqual([]);
    h.layer.sync(20, 30, 100, 0, 1, 42, 0.5, 1);
    h.render();
    expect(h.image.visible).toBe(false);
    expect(h.renderer.drawElements).not.toHaveBeenCalled();
  });

  it('supports headless scene lifecycle without allocating GPU resources', () => {
    const image = vi.fn();
    const layer = new VoidMeteorPlasmaLayer({ sys: {}, add: { image } } as unknown as Phaser.Scene);
    layer.sync(20, 30, 100, 0, 1, 42, 0.5, 1);
    layer.clear();
    layer.destroy();
    layer.destroy();
    expect(image).not.toHaveBeenCalled();
    expect(batches).toHaveLength(0);
  });
});
