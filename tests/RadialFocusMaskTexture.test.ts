import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Textures: { FilterMode: { LINEAR: 1 } },
  Utils: { String: { UUID: () => randomUUID() } },
  Math: { Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)) },
  Filters: { ParallelFilters: class {} },
}));

import { RadialFocusMaskTexture } from '../src/effects/postfx/RadialFocusFilter';

describe('Radial focus mask ownership', () => {
  it.each([0, 1])('keeps other scene masks alive when owner %i is destroyed', (destroyIndex) => {
    const createTexture = (width: number, height: number) => ({
      width, height,
      context: { clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '' } as
        { clearRect: ReturnType<typeof vi.fn>; fillRect: ReturnType<typeof vi.fn>; fillStyle: string } | null,
      setSmoothPixelArt: vi.fn(), setFilter: vi.fn(), refresh: vi.fn(),
    });
    const registry = new Map<string, ReturnType<typeof createTexture>>();
    const textures = {
      exists: (key: string) => registry.has(key),
      createCanvas: (key: string, width: number, height: number) => {
        const texture = createTexture(width, height);
        registry.set(key, texture);
        return texture;
      },
      remove: (key: string) => {
        registry.get(key)!.context = null; // Phaser CanvasTexture.destroy invalidates the context.
        registry.delete(key);
      },
    };
    const masks = [
      new RadialFocusMaskTexture({ textures } as never),
      new RadialFocusMaskTexture({ textures } as never),
    ];
    const frame = { focusX: 100, focusY: 100, radiusPx: 0, alpha: 1 };
    for (const mask of masks) mask.update(frame);
    expect(registry.size).toBe(2);
    expect(masks[0].texture).not.toBe(masks[1].texture);

    masks[destroyIndex].destroy();
    masks[destroyIndex].destroy();
    masks[destroyIndex].update({ ...frame, alpha: 0.5 });
    const survivor = masks[1 - destroyIndex];
    survivor.update({ ...frame, alpha: 0.5 });
    expect(survivor.texture.context.clearRect).toHaveBeenCalledTimes(2);
    expect(registry.get(survivor.textureKey)).toBe(survivor.texture);
    survivor.destroy();
    expect(registry.size).toBe(0);
  });
});
