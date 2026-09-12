import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Textures: { FilterMode: { LINEAR: 1 } }, BlendModes: { NORMAL: 0 },
  Utils: { String: { UUID: () => 'test-mask' } }, Scenes: { Events: { POST_UPDATE: 'postupdate' } },
  Filters: { ParallelFilters: class {
    active = true;
    top = { addBlur: () => ({ x: 0, y: 0, steps: 0 }), addMask: vi.fn() };
    blend = { amount: 0, blendMode: 0 };
    setActive(active: boolean) { this.active = active; return this; }
    destroy = vi.fn();
  } },
}));
vi.mock('../src/graphics/GraphicsQuality', () => ({
  getGraphicsQualityController: (scene: any) => scene.quality,
  getGraphicsQualityProfile: () => ({ level: 'high' }),
}));
vi.mock('../src/graphics/RenderResolution', () => ({ getRenderScale: (scale: any) => scale.width / 1920 }));
import { BackdropBlur, type BackdropSurface } from '../src/effects/postfx/BackdropBlur';

describe('World backdrop blur lifetime', () => {
  it('reuses its camera branch and mask, follows surfaces, respects quality and cleans up after camera shutdown', () => {
    const events = new EventEmitter();
    const context = { clearRect: vi.fn(), save: vi.fn(), scale: vi.fn(), beginPath: vi.fn(),
      roundRect: vi.fn(), fill: vi.fn(), restore: vi.fn(), fillStyle: '', globalAlpha: 1 };
    const texture = { context, width: 960, height: 540, refresh: vi.fn(),
      setSmoothPixelArt: vi.fn(), setFilter: vi.fn() };
    const list = { add: vi.fn(), remove: vi.fn() };
    const scene = { events, scale: { width: 1920 }, cameras: { main: { filters: { internal: list } } },
      textures: { createCanvas: vi.fn(() => texture), remove: vi.fn() },
      quality: { trackFilter: vi.fn(), untrackFilter: vi.fn() } };
    let surfaces: (BackdropSurface | null)[] = [
      { x: 24, y: 240, width: 540, height: 800, radius: 22, alpha: 1 },
    ];
    const effect = new BackdropBlur(scene as never, () => surfaces);
    const branch = list.add.mock.calls[0][0];
    expect(branch.active).toBe(true);
    expect(branch.top.addMask).toHaveBeenCalledWith('__backdrop_blur_test-mask');
    const uploads = texture.refresh.mock.calls.length;
    for (let i = 0; i < 60; i++) events.emit('postupdate');
    expect(texture.refresh).toHaveBeenCalledTimes(uploads);
    expect(list.add).toHaveBeenCalledOnce();

    surfaces = [{ ...surfaces[0]!, y: 258, alpha: 0.5 }];
    events.emit('postupdate');
    expect(context.roundRect).toHaveBeenLastCalledWith(24, 258, 540, 800, 22);
    expect(context.globalAlpha).toBe(0.5);
    branch.setActive(false);
    events.emit('postupdate');
    expect(branch.active).toBe(false);
    branch.setActive(true);
    expect(branch.active).toBe(true);

    surfaces = [null, { ...surfaces[0]!, y: 1080 }];
    events.emit('postupdate');
    expect(branch.active).toBe(false);
    branch.setActive(true);
    expect(branch.active).toBe(false);
    // Scene CameraManager clears this before later shutdown listeners run.
    scene.cameras.main = undefined as never;
    effect.destroy(); effect.destroy();
    expect(events.listenerCount('postupdate')).toBe(0);
    expect(list.remove).toHaveBeenCalledExactlyOnceWith(branch);
    expect(scene.quality.untrackFilter).toHaveBeenCalledExactlyOnceWith(branch);
    expect(scene.textures.remove).toHaveBeenCalledExactlyOnceWith('__backdrop_blur_test-mask');
  });
});
