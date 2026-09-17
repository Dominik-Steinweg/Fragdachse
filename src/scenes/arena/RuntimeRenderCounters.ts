/** Counts submissions on this GL context, including instancing and framebuffer draws.
 * No getError/readPixels/finish, and no per-draw timer or framebuffer query.
 */
export class RuntimeRenderCounters {
  private patches: { target: Record<string, any>; key: string; original: any; wrapped: any; own: boolean }[] = [];
  private framebuffer: unknown;
  private framebufferKnown = false;
  private depth = 0;
  private calls = 0;
  private offscreen = 0;
  private invalid = false;
  readonly methods: string[] = [];

  constructor(private readonly gl: Record<string, any>) {
    try {
      if (typeof gl.getParameter === 'function' && gl.FRAMEBUFFER_BINDING !== undefined) {
        this.framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING); this.framebufferKnown = true;
      }
      if (typeof gl.drawArrays !== 'function' || typeof gl.drawElements !== 'function') return;
      const counter = this;
      const hookDraw = (target: Record<string, any>, key: string) => {
        if (typeof target[key] !== 'function') return;
        this.patch(target, key, original => function (this: unknown, ...args: unknown[]) {
          counter.depth++;
          try {
            const result = original.apply(this, args);
            if (counter.depth === 1) { counter.calls++; if (counter.framebufferKnown && counter.framebuffer != null) counter.offscreen++; }
            return result;
          } catch (error) { counter.invalid = true; throw error; }
          finally { counter.depth--; }
        });
        this.methods.push(key);
      };
      for (const key of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) hookDraw(gl, key);
      const extension = gl.getExtension?.('ANGLE_instanced_arrays');
      if (extension) for (const key of ['drawArraysInstancedANGLE', 'drawElementsInstancedANGLE']) hookDraw(extension, key);
      if (typeof gl.bindFramebuffer === 'function') this.patch(gl, 'bindFramebuffer', original => function (this: unknown, target: number, framebuffer: unknown) {
        const result = original.call(this, target, framebuffer);
        if (target === gl.FRAMEBUFFER || target === gl.DRAW_FRAMEBUFFER) { counter.framebuffer = framebuffer; counter.framebufferKnown = true; }
        return result;
      });
    } catch { this.invalid = true; }
  }

  private patch(target: Record<string, any>, key: string, wrap: (original: any) => any): void {
    const original = target[key], own = Object.prototype.hasOwnProperty.call(target, key), wrapped = wrap(original);
    target[key] = wrapped;
    if (target[key] !== wrapped) throw new Error('GL hook rejected');
    this.patches.push({ target, key, original, wrapped, own });
  }

  reset(): void { this.calls = 0; this.offscreen = 0; }
  snapshot(): { status: 'supported' | 'unsupported' | 'invalid'; drawCalls: number | null; offscreenDrawCalls: number | null } {
    if (this.gl.isContextLost?.() || this.patches.some(p => p.target[p.key] !== p.wrapped)) this.invalid = true;
    const status = this.invalid ? 'invalid' : this.methods.length >= 2 ? 'supported' : 'unsupported';
    return { status, drawCalls: status === 'supported' ? this.calls : null,
      offscreenDrawCalls: status === 'supported' && this.framebufferKnown ? this.offscreen : null };
  }
  stop(): void {
    for (const p of this.patches.reverse()) if (p.target[p.key] === p.wrapped) {
      if (p.own) p.target[p.key] = p.original; else delete p.target[p.key];
    }
    this.patches = [];
  }
}
