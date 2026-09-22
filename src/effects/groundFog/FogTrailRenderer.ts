import * as Phaser from 'phaser';
import { FOG, type FogFrame, type FogRect } from './FogConfig';
import type { FogTrailSegments } from './FogTrailSegments';

/** Rasterize only capsule bounds. MAX union keeps crossings/endpoints as soft as a single trace. */
export class FogTrailRenderer {
  private version = -1;
  private viewKey = '';
  private vertices = 0;
  constructor(private readonly shader: Phaser.GameObjects.Shader, private readonly frame: FogFrame) {
    const renderer = shader.renderNode.renderer, gl = renderer.gl;
    const maximum = 'MAX' in gl ? (gl as WebGL2RenderingContext).MAX : gl.getExtension('EXT_blend_minmax')?.MAX_EXT;
    if (maximum === undefined) throw new Error('Ground fog requires MAX blending');
    shader.drawingContext!.state.blend = { ...shader.drawingContext!.state.blend, enabled: true, equation: [maximum, maximum] };
    shader.renderNode.vertexBufferLayout.buffer.resize(FOG.trailCapacity * 6 * 4 * 4);
  }
  draw(trails: FogTrailSegments, view: FogRect, elapsed: number, reaction: number, commands: Phaser.Textures.Texture, includeProjectiles = true): void {
    const shader = this.shader, node = shader.renderNode, renderer = node.renderer, gl = renderer.gl;
    const context = shader.drawingContext!, buffer = node.vertexBufferLayout.buffer;
    node.manager.startStandAloneRender();
    const key = `${view.x},${view.y},${view.width},${view.height},${includeProjectiles}`;
    if (this.version !== trails.version || this.viewKey !== key) {
      this.vertices = trails.writeVertices(buffer.viewF32!, view, includeProjectiles);
      if (this.vertices) buffer.update(this.vertices * 16);
      this.version = trails.version; this.viewKey = key;
    }
    context.use();
    if (this.vertices) {
      const manager = node.programManager;
      const suite = manager.getCurrentProgramSuite() as { program: Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper; vao: Phaser.Renderer.WebGL.Wrappers.WebGLVAOWrapper };
      manager.setUniform('uViewOrigin', [view.x - this.frame.offsetX, view.y - this.frame.offsetY]);
      manager.setUniform('uViewSize', [view.width, view.height]);
      manager.setUniform('uWorldSize', [this.frame.width, this.frame.height]);
      manager.setUniform('uCommands', 0); manager.setUniform('uTrailTime', elapsed % 60000); manager.setUniform('uReaction', reaction);
      manager.applyUniforms(suite.program);
      context.beginDraw(); suite.program.bind(); suite.vao.bind();
      renderer.glTextureUnits.bindUnits([commands.get().source.glTexture]);
      // The VAO/program/target/blend changes all go through Phaser's state wrappers.
      gl.drawArrays(gl.TRIANGLES, 0, this.vertices);
    }
    context.release();
    renderer.glWrapper.update({ blend: { enabled: true, equation: [gl.FUNC_ADD, gl.FUNC_ADD] } });
  }
  get drawCalls(): number { return this.vertices ? 1 : 0; }
  get visibleTraces(): number { return this.vertices / 6; }
}
