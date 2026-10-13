import type * as Phaser from 'phaser';

interface FramebufferOwner {
  renderer: { glWrapper: {
    state: { bindings: { renderbuffer?: unknown } };
    updateBindingsRenderbuffer(state: { bindings: { renderbuffer: null } }): void;
  } } | null;
  attachments: { texture?: unknown; renderbuffer?: unknown }[];
  createResource(): void;
  destroy(): void;
}
const installed = new WeakSet<object>();

/** Phaser 4.2.1 deletes renderbuffers on resize/destroy but leaves the raw handle
 * in its state cache. A later private pass restoring that cache would rebind a
 * deleted object. Clear only a binding owned by the framebuffer being released.
 * No draw hook, GL query or change to attachment ownership is needed. */
export function installPhaserFramebufferBindings(target: object): void {
  // Phaser's declaration erases the binding keys to `object`.
  const prototype = target as FramebufferOwner;
  if (installed.has(prototype)) return;
  installed.add(prototype);
  for (const method of ['createResource', 'destroy'] as const) {
    const original = prototype[method];
    prototype[method] = function () {
      const wrapper = this.renderer?.glWrapper, bound = wrapper?.state.bindings.renderbuffer;
      if (bound && this.attachments.some(a => !a.texture && a.renderbuffer === bound)) {
        wrapper!.updateBindingsRenderbuffer({ bindings: { renderbuffer: null } });
      }
      original.call(this);
    };
  }
  const framebuffer = target as Phaser.Renderer.WebGL.Wrappers.WebGLFramebufferWrapper;
  const resize = framebuffer.resize;
  if (!resize) return;
  framebuffer.resize = function (this: typeof framebuffer, width, height) {
    // Phaser 4.2.1 texture.resize uses texImage2D on the SAME texture handle.
    // Its attachments therefore remain valid. Recreating the FBO and stencil
    // on every animated bound change adds a synchronous completeness query.
    // Restrict reuse to the ordinary single-color target; exotic attachment
    // layouts and context loss retain Phaser's original path. Creation and
    // restoration still validate and recreate resources through createResource.
    // Keep Phaser's no-op fast path free of GL calls and attachment scans.
    if (this.useCanvas || (this.width === width && this.height === height)) return;
    const gl = this.renderer.gl;
    let singleColor = this.attachments[0]?.texture === this.renderTexture;
    for (let i = 1; i < this.attachments.length; i++) {
      const attachment = this.attachments[i];
      if (attachment.texture || !attachment.renderbuffer) singleColor = false;
    }
    if (!this.webGLFramebuffer || gl.isContextLost() || !this.renderTexture
      || !singleColor
      || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      resize.call(this, width, height); return;
    }
    this.width = width; this.height = height;
    this.renderTexture.resize(width, height);
    this.renderer.glWrapper.updateBindingsFramebuffer({ bindings: { framebuffer: this } });
    for (const attachment of this.attachments) if (!attachment.texture) {
      this.renderer.glWrapper.updateBindingsRenderbuffer({ bindings: { renderbuffer: attachment.renderbuffer } });
      gl.renderbufferStorage(gl.RENDERBUFFER, attachment.internalFormat!, width, height);
    }
  };
}
