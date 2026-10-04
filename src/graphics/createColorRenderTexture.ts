import type * as Phaser from 'phaser';

/** A render target for clear/fill/stamp operations only, never stencil geometry.
 * Phaser 4.2.1 DynamicTexture unconditionally inherits the renderer's stencil
 * setting. Scope the framebuffer factory to this synchronous construction so
 * large persistent blit pools do not each allocate an unused stencil surface.
 * The attachment list also stays color-only on resize and context restoration.
 */
export function createColorRenderTexture(
  scene: Phaser.Scene,
  width: number,
  height: number,
): Phaser.GameObjects.RenderTexture {
  const renderer = scene.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
  if (!renderer?.createFramebuffer) return scene.add.renderTexture(0, 0, width, height);

  const createFramebuffer = renderer.createFramebuffer;
  const hadOwnFactory = Object.prototype.hasOwnProperty.call(renderer, 'createFramebuffer');
  renderer.createFramebuffer = function (texture) {
    const framebuffer = createFramebuffer.call(this, texture, false, false);
    // Phaser only checks completeness while adding a stencil/depth attachment.
    // Keep allocation failures observable and release this partially built target.
    const status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
    if (status !== this.gl.FRAMEBUFFER_COMPLETE) {
      this.deleteFramebuffer(framebuffer);
      throw new Error(`Color render texture framebuffer incomplete: ${status} (${width}x${height})`);
    }
    return framebuffer;
  };
  try {
    const target = scene.add.renderTexture(0, 0, width, height);
    (target.texture as Phaser.Textures.DynamicTexture).drawingContext?.setStencil(false);
    return target;
  } finally {
    if (hadOwnFactory) renderer.createFramebuffer = createFramebuffer;
    else Reflect.deleteProperty(renderer, 'createFramebuffer');
  }
}
