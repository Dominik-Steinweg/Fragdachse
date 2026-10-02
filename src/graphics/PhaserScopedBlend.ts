import type * as Phaser from 'phaser';

type Context = Phaser.Renderer.WebGL.DrawingContext;
type ShaderRun = Phaser.Renderer.WebGL.RenderNodes.ShaderQuad['run'];

/** A standalone draw must not export its private blend into the display list.
 * Use Phaser's state wrapper (never raw gl.blendFunc), and restore both the
 * context descriptor and the tracked GL state, including on a failed draw.
 * No context clone or callback allocation is needed per frame.
 */
export function runWithScopedBlend(
  node: Phaser.Renderer.WebGL.RenderNodes.ShaderQuad,
  run: ShaderRun,
  context: Context,
  mode: number,
  object: Phaser.GameObjects.Shader,
  parent: Phaser.GameObjects.Components.TransformMatrix,
): void {
  const manager = node.manager;
  // Pending geometry still belongs to the caller's blend, not this draw.
  manager.finishBatch();
  const previous = context.state.blend;
  const previousMode = context.blendMode;
  // Registration owns this immutable descriptor. Unlike setBlendMode in 4.2.1,
  // it includes the correctly spelled `enabled` field.
  context.state.blend = context.renderer.blendModes[mode];
  context.blendMode = mode;
  try {
    run.call(node, context, object, parent);
  } finally {
    context.state.blend = previous;
    context.blendMode = previousMode;
    context.renderer.glWrapper.updateBlend(context.state);
  }
}
