import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ objects: [] as { destroy: ReturnType<typeof vi.fn> }[] }));
vi.mock('phaser', () => ({
  Textures: { FilterMode: { LINEAR: 1 } }, BlendModes: { NORMAL: 0 },
  GameObjects: { Shader: class {
    destroy = vi.fn();
    constructor(_scene: unknown, _config: unknown, public x: number, public y: number) { state.objects.push(this); }
    setDepth() { return this; }
    setBlendMode() { return this; }
  } },
}));
import { WaterSurfaceRenderer } from '../src/arena/WaterSurfaceRenderer';
import { CELL_SIZE } from '../src/config';
import { WATER_MASK_HALO, WATER_MASK_STEP } from '../src/arena/WaterSurfaceModel';

describe('Water presentation residency', () => {
  it('continues the baked boundary using local map dimensions in an offset world', () => {
    const putImageData = vi.fn();
    const scene = { time: { now: 0 }, add: { existing: vi.fn() }, textures: {
      createCanvas: () => ({ context: {
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w }),
        putImageData,
      }, refresh: vi.fn(), setFilter: vi.fn() }), remove: vi.fn(),
    } };
    const width = 8 * CELL_SIZE, height = 6 * CELL_SIZE;
    const water = Array.from({ length: 8 * 6 }, (_, i) => ({ gridX: i % 8, gridY: Math.floor(i / 8) }));
    const renderer = new WaterSurfaceRenderer(scene as never,
      { offsetX: -700, offsetY: 350, width, height }, water, 1);
    renderer.updateResidency({ x: -700, y: 350, width, height });
    expect(putImageData).toHaveBeenCalledTimes(1);
    const pixels = putImageData.mock.calls[0][0] as { width: number; data: Uint8ClampedArray };
    for (const [x, y] of [[-4, -4], [width + 4, height + 4], [width / 2, height / 2]]) {
      const px = Math.floor((x + WATER_MASK_HALO) / WATER_MASK_STEP);
      const py = Math.floor((y + WATER_MASK_HALO) / WATER_MASK_STEP);
      expect(pixels.data[(py * pixels.width + px) * 4]).toBe(255);
      expect(pixels.data[(py * pixels.width + px) * 4 + 2]).toBe(255);
    }
    renderer.destroy();
  });

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
    // The far pond ends at y=512: its soft bank also occupies the next chunk row.
    expect(textures.size).toBe(2);
    renderer.updateResidency(near);
    renderer.destroy(); renderer.destroy();
    expect(textures.size).toBe(0);
    expect(state.objects.every(object => object.destroy.mock.calls.length === 1)).toBe(true);
  });

  it('renders the bank in a neighboring chunk with no authored water cells', () => {
    state.objects.length = 0;
    const scene = { time: { now: 0 }, add: { existing: vi.fn() }, textures: {
      createCanvas: () => ({ context: {
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: vi.fn(),
      }, refresh: vi.fn(), setFilter: vi.fn() }), remove: vi.fn(),
    } };
    const renderer = new WaterSurfaceRenderer(scene as never,
      { offsetX: 100, offsetY: 50, width: 1024, height: 512 }, [{ gridX: 15, gridY: 8 }], 1);
    renderer.updateResidency({ x: 100, y: 50, width: 1024, height: 512 });
    expect(state.objects).toEqual([
      expect.objectContaining({ x: 356, y: 306 }),
      expect.objectContaining({ x: 868, y: 306 }),
    ]);
    renderer.destroy();
    expect(state.objects.every(object => object.destroy.mock.calls.length === 1)).toBe(true);
  });
});
