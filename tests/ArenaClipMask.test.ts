import { describe, expect, it, vi } from 'vitest';
import { coversDesignSpace } from '../src/scenes/arena/ArenaClipPolicy';
import { WebGLRectMaskTexture } from '../src/utils/webglRectMask';

vi.mock('phaser', () => ({
  Textures: { FilterMode: { NEAREST: 0 } },
}));

describe('arena camera clip policy', () => {
  it('skips the WebGL mask when the clip covers the complete design space', () => {
    expect(coversDesignSpace(
      { x: 0, y: 0, width: 1920, height: 1080 },
      1920,
      1080,
    )).toBe(true);
    expect(coversDesignSpace(
      { x: -24, y: -12, width: 1968, height: 1104 },
      1920,
      1080,
    )).toBe(true);
  });

  it('keeps the mask for clips that leave any design-space edge uncovered', () => {
    expect(coversDesignSpace(
      { x: 0, y: 12, width: 1920, height: 1056 },
      1920,
      1080,
    )).toBe(false);
    expect(coversDesignSpace(
      { x: 240, y: 0, width: 1440, height: 1080 },
      1920,
      1080,
    )).toBe(false);
  });

  it('detaches and reattaches the same texture without leaking the old filter', () => {
    const texture = {
      width: 1920,
      height: 1080,
      context: { clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '' },
      setSmoothPixelArt: vi.fn(),
      setFilter: vi.fn(),
      refresh: vi.fn(),
    };
    const scene = {
      textures: {
        createCanvas: vi.fn(() => texture),
        exists: vi.fn(() => true),
        remove: vi.fn(),
      },
    } as any;
    const filterList = {
      addMask: vi.fn((key: string) => ({ key })),
      remove: vi.fn(),
    };
    const camera = { filters: { internal: filterList } } as any;
    const mask = new WebGLRectMaskTexture(scene, '__test_arena_clip', 1920, 1080);

    mask.update({ x: 0, y: 12, width: 1920, height: 1056 });
    mask.attachToCamera(camera);
    mask.detachFromCamera();
    mask.update({ x: 0, y: 0, width: 1920, height: 1080 });
    mask.attachToCamera(camera);
    mask.destroy();

    expect(scene.textures.createCanvas).toHaveBeenCalledTimes(1);
    expect(filterList.addMask).toHaveBeenCalledTimes(2);
    expect(filterList.remove).toHaveBeenCalledTimes(2);
    expect(scene.textures.remove).toHaveBeenCalledTimes(1);
  });
});
