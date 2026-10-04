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
}
