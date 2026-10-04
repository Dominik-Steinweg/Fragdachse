import { describe, expect, it, vi } from 'vitest';
import { createColorRenderTexture } from '../src/graphics/createColorRenderTexture';

describe('color-only render target allocation', () => {
  function fixture(inherited = false) {
    const createFramebuffer = vi.fn(function (this: unknown, texture: unknown, stencil: boolean, depth: boolean) {
      return { texture, stencil, depth, renderer: this };
    });
    const renderer = inherited ? Object.create({ createFramebuffer }) : { createFramebuffer };
    renderer.gl = { FRAMEBUFFER: 36160, FRAMEBUFFER_COMPLETE: 36053, checkFramebufferStatus: vi.fn(() => 36053) };
    renderer.deleteFramebuffer = vi.fn();
    const texture = {};
    const setStencil = vi.fn();
    const scene = {
      sys: { renderer },
      add: { renderTexture: vi.fn(() => ({
        texture: { drawingContext: { setStencil } },
        framebuffer: renderer.createFramebuffer(texture, true, false),
      })) },
    };
    return { scene, renderer, texture, createFramebuffer, setStencil };
  }

  it.each([false, true])('omits auxiliary attachments only for the blit target (inherited: %s)', inherited => {
    const { scene, renderer, texture, createFramebuffer, setStencil } = fixture(inherited);
    const result = createColorRenderTexture(scene as never, 512, 256);
    expect(result).toMatchObject({ framebuffer: { texture, stencil: false, depth: false, renderer } });
    expect(setStencil).toHaveBeenCalledWith(false);
    expect(scene.add.renderTexture).toHaveBeenCalledWith(0, 0, 512, 256);
    expect(renderer.createFramebuffer).toBe(createFramebuffer);
    expect(Object.hasOwn(renderer, 'createFramebuffer')).toBe(!inherited);
    expect(renderer.createFramebuffer({}, true, true)).toMatchObject({ stencil: true, depth: true });
  });

  it('restores normal allocation even when target construction fails', () => {
    const { scene, renderer, createFramebuffer } = fixture();
    const failure = new Error('allocation failed');
    scene.add.renderTexture.mockImplementation(() => { throw failure; });
    expect(() => createColorRenderTexture(scene as never, 512, 512)).toThrow(failure);
    expect(renderer.createFramebuffer).toBe(createFramebuffer);
    expect(renderer.createFramebuffer({}, true, false)).toMatchObject({ stencil: true });
  });

  it('releases an incomplete target and reports allocation failure without disabling normal rendering', () => {
    const { scene, renderer, createFramebuffer } = fixture();
    renderer.gl.checkFramebufferStatus.mockReturnValue(36061);
    expect(() => createColorRenderTexture(scene as never, 512, 256))
      .toThrow('Color render texture framebuffer incomplete: 36061 (512x256)');
    expect(renderer.deleteFramebuffer).toHaveBeenCalledWith(createFramebuffer.mock.results[0].value);
    expect(renderer.createFramebuffer).toBe(createFramebuffer);
  });
});
