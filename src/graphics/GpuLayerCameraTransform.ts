import type * as Phaser from 'phaser';

const configured = new WeakSet<object>();

/** Phaser 4.2.1's GPU submitter always uses matrixCombined, even inside a camera framebuffer. */
export function configureGpuLayerCameraTransform(layer: Phaser.GameObjects.SpriteGPULayer): void {
  const node = layer.submitterNode;
  if (!node?.setupUniforms || configured.has(node)) return;
  configured.add(node);
  const setup = node.setupUniforms;
  node.setupUniforms = function (context: Phaser.Renderer.WebGL.DrawingContext): void {
    setup.call(this, context);
    // Match Phaser's regular sprite/tile transforms: the camera viewport is applied when
    // the framebuffer is composited, not once more to each member inside that framebuffer.
    const m = context.camera!.getViewMatrix(!context.useCanvas);
    this.programManager.setUniform('uViewMatrix', [m.a, m.b, 0, m.c, m.d, 0, m.tx, m.ty, 1]);
  };
}
