import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { installPhaserFramebufferBindings } from '../src/graphics/PhaserFramebufferBindings';

describe('Phaser framebuffer binding lifetime', () => {
  it('resizes the real Phaser attachments in place, but recreates them after context restoration', () => {
    const require = createRequire(import.meta.url);
    const Framebuffer = require('../node_modules/phaser/src/renderer/webgl/wrappers/WebGLFramebufferWrapper.js');
    installPhaserFramebufferBindings(Framebuffer.prototype);
    const gl = { FRAMEBUFFER: 1, FRAMEBUFFER_COMPLETE: 2, COLOR_ATTACHMENT0: 3, STENCIL_ATTACHMENT: 4,
      STENCIL_INDEX8: 5, RENDERBUFFER: 6, TEXTURE_2D: 7, isContextLost: vi.fn(() => false),
      createFramebuffer: vi.fn(() => ({})), createRenderbuffer: vi.fn(() => ({})),
      deleteFramebuffer: vi.fn(), deleteRenderbuffer: vi.fn(), framebufferTexture2D: vi.fn(),
      framebufferRenderbuffer: vi.fn(), renderbufferStorage: vi.fn(), checkFramebufferStatus: vi.fn(() => 2) };
    const bindings = { framebuffer: null as unknown, renderbuffer: null as unknown };
    const renderer = { gl, glWrapper: { state: { bindings },
      updateBindingsFramebuffer: (s: { bindings: { framebuffer: unknown } }) => { bindings.framebuffer = s.bindings.framebuffer; },
      updateBindingsRenderbuffer: (s: { bindings: { renderbuffer: unknown } }) => { bindings.renderbuffer = s.bindings.renderbuffer; } },
      deleteTexture: vi.fn() };
    const texture = { width: 16, height: 16, webGLTexture: {}, resize: vi.fn(function(this: {width:number;height:number}, w:number,h:number) { this.width=w;this.height=h; }) };
    const target = new Framebuffer(renderer, [texture], true, false);
    const handle = target.webGLFramebuffer, stencil = target.attachments[1].renderbuffer;
    target.resize(32, 48);
    const contextQueries = gl.isContextLost.mock.calls.length;
    target.resize(32, 48);
    expect(gl.isContextLost).toHaveBeenCalledTimes(contextQueries);
    target.resize(48, 32);
    expect([target.width,target.height,texture.width,texture.height]).toEqual([48,32,48,32]);
    expect(target.webGLFramebuffer).toBe(handle);
    expect(target.attachments[1].renderbuffer).toBe(stencil);
    expect(gl.checkFramebufferStatus).toHaveBeenCalledTimes(1);
    expect(gl.createFramebuffer).toHaveBeenCalledTimes(1);
    expect(gl.createRenderbuffer).toHaveBeenCalledTimes(1);
    expect(texture.resize).toHaveBeenCalledTimes(2);
    expect(gl.renderbufferStorage).toHaveBeenLastCalledWith(gl.RENDERBUFFER,gl.STENCIL_INDEX8,48,32);
    // Renderer restoration calls createResource, not resize: keep that path and validation.
    target.createResource();
    expect(target.webGLFramebuffer).not.toBe(handle);
    expect(gl.checkFramebufferStatus).toHaveBeenCalledTimes(2);
    expect(gl.deleteRenderbuffer).toHaveBeenCalledWith(stencil);
    target.destroy();
    expect(renderer.deleteTexture).toHaveBeenCalledWith(texture);
    expect(bindings.renderbuffer).toBeNull();
  });
  function fixture() {
    const deleted: unknown[] = [], restored: unknown[] = [];
    class Framebuffer {
      attachments: { renderbuffer?: unknown; texture?: unknown }[] = [];
      renderer = { glWrapper: {
        state: { bindings: { renderbuffer: null as unknown } },
        updateBindingsRenderbuffer(state: { bindings: { renderbuffer: null } }) {
          this.state.bindings.renderbuffer = state.bindings.renderbuffer;
        },
      } };
      createResource() { for (const a of this.attachments) if (!a.texture) deleted.push(a.renderbuffer); }
      destroy() { this.createResource(); this.attachments.length = 0; }
      restorePrivatePass() { restored.push(this.renderer.glWrapper.state.bindings.renderbuffer); }
    }
    installPhaserFramebufferBindings(Framebuffer.prototype);
    return { Framebuffer, deleted, restored };
  }
  it.each(['createResource', 'destroy'] as const)('never restores a deleted owned handle after %s', method => {
    const { Framebuffer, deleted, restored } = fixture(), buffer = {}, owner = new Framebuffer();
    owner.attachments = [{ renderbuffer: buffer }];
    owner.renderer.glWrapper.state.bindings.renderbuffer = buffer;
    owner[method](); owner.restorePrivatePass();
    expect(deleted).toEqual([buffer]); expect(restored).toEqual([null]);
  });
  it('keeps unrelated bindings and installs only once', () => {
    const { Framebuffer, restored } = fixture(), other = {}, owner = new Framebuffer();
    const destroy = Framebuffer.prototype.destroy;
    installPhaserFramebufferBindings(Framebuffer.prototype);
    expect(Framebuffer.prototype.destroy).toBe(destroy);
    owner.attachments = [{ renderbuffer: {} }];
    owner.renderer.glWrapper.state.bindings.renderbuffer = other;
    owner.destroy(); owner.restorePrivatePass(); expect(restored).toEqual([other]);
  });
});
