import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ objects: [] as { destroy: ReturnType<typeof vi.fn> }[] }));
vi.mock('phaser', () => ({
  Textures: { FilterMode: { LINEAR: 1 } }, BlendModes: { NORMAL: 0 },
  GameObjects: { Shader: class {
    destroy = vi.fn();
    constructor() { state.objects.push(this); }
    setDepth() { return this; }
    setBlendMode() { return this; }
  } },
}));
import { WaterSurfaceRenderer } from '../src/arena/WaterSurfaceRenderer';

describe('Water presentation residency', () => {
  it('only allocates nearby occupied chunks, reuses masks, and releases all resources on teardown', () => {
    state.objects.length = 0;
    const textures = new Set<string>();
    const createCanvas = vi.fn((key: string) => {
      textures.add(key);
      return { context: { createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: vi.fn() }, refresh: vi.fn(), setFilter: vi.fn() };
    });
    const scene = { time: { now: 100 }, add: { existing: vi.fn() }, textures: {
      createCanvas, remove: (key: string) => textures.delete(key),
    } };
    const renderer = new WaterSurfaceRenderer(scene as never,
      { offsetX: 100, offsetY: 50, width: 4096, height: 1024 },
      [{ gridX: 15, gridY: 15 }, { gridX: 16, gridY: 15 }, { gridX: 16, gridY: 16 }, { gridX: 100, gridY: 15 }], 1);
    const near = { x: 100, y: 50, width: 800, height: 700 };
    renderer.updateResidency(near);
    const initial = createCanvas.mock.calls.length;
    expect(initial).toBeGreaterThan(1);
    for (let frame = 0; frame < 60; frame++) renderer.updateResidency(near);
    expect(createCanvas).toHaveBeenCalledTimes(initial);
    renderer.updateResidency({ x: 3200, y: 50, width: 600, height: 700 });
    expect(state.objects.slice(0, initial).every(object => object.destroy.mock.calls.length === 1)).toBe(true);
    expect(textures.size).toBe(1);
    renderer.updateResidency(near);
    renderer.destroy(); renderer.destroy();
    expect(textures.size).toBe(0);
    expect(state.objects.every(object => object.destroy.mock.calls.length === 1)).toBe(true);
  });
});
