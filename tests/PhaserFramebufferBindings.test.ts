import { describe, expect, it } from 'vitest';
import { installPhaserFramebufferBindings } from '../src/graphics/PhaserFramebufferBindings';

describe('Phaser framebuffer binding lifetime', () => {
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
