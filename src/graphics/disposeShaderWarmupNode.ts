import type * as Phaser from 'phaser';

type ProbeNode = Phaser.Renderer.WebGL.RenderNodes.ShaderQuad
  | Phaser.Renderer.WebGL.RenderNodes.SubmitterSpriteGPULayer;

/** Phaser 4.2.1 GameObject.destroy leaves these private nodes' buffers/VAOs alive.
 * Only for disposable probes: shader programs and the generic quad index buffer are shared.
 */
export function disposeShaderWarmupNode(node: ProbeNode): void {
  const renderer = node.manager.renderer;
  for (const suite of Object.values(node.programManager.programs)) {
    const index = renderer.glVAOWrappers.indexOf(suite.vao);
    if (index >= 0) renderer.glVAOWrappers.splice(index, 1);
    suite.vao.destroy();
  }
  node.programManager.programs = {};
  renderer.deleteBuffer(node.vertexBufferLayout.buffer);
  if ('instanceBufferLayout' in node) renderer.deleteBuffer(node.instanceBufferLayout.buffer);
}
