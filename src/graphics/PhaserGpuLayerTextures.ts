interface FrameDataTexture {
  renderer: { deleteTexture(texture: FrameDataTexture): void } | null;
}
interface GpuLayerTextures {
  frameDataTexture: FrameDataTexture | null;
  generateFrameDataTexture(): void;
  preDestroy(): void;
}
const installed = new WeakSet<object>();

/** Phaser 4.2.1 destroys SpriteGPULayer frame textures directly, leaving dead wrappers
 * in the renderer's context-restoration registry. Unregister only the texture that
 * the original method actually destroyed; preserve live textures on failed rebuilds.
 */
export function installPhaserGpuLayerTextures(target: object): void {
  if (installed.has(target)) return;
  installed.add(target);
  const prototype = target as GpuLayerTextures;
  for (const method of ['generateFrameDataTexture', 'preDestroy'] as const) {
    const original = prototype[method];
    prototype[method] = function () {
      const texture = this.frameDataTexture, renderer = texture?.renderer;
      try { return original.call(this); }
      finally {
        if (texture && renderer && texture.renderer === null) renderer.deleteTexture(texture);
      }
    };
  }
}
