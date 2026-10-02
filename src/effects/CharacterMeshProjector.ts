import * as Phaser from 'phaser';
import type { CharacterMeshData } from '../assets/CharacterMeshAssets';
import { CHARACTER_MESH_VERTEX, CHARACTER_MESH_MASK } from './characterMeshShaders';
import { sunShaderName } from './sunlight/SunRenderTarget';

type Suite = { program: Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper; vao: Phaser.Renderer.WebGL.Wrappers.WebGLVAOWrapper };

/** Shared geometry nodes, one current-pose VBO + fixed U16 IBO per mesh.
 * Phaser wrappers own restoration data. No raw GL state/VAO mutation during drawing. */
export class CharacterMeshProjector {
  private readonly nodes = new Map<string, ReturnType<typeof createMeshNode>>();
  private readonly name = sunShaderName('CharacterMeshProjection');
  draws = 0;
  triangles = 0;
  uploadedBytes = 0;
  constructor(private readonly scene: Phaser.Scene) {}
  resetCosts(): void { this.draws = 0; this.triangles = 0; this.uploadedBytes = 0; }
  draw(context: Phaser.Renderer.WebGL.DrawingContext, mesh: CharacterMeshData, pose: number,
    model: Float32Array, bounds: number[], sun: number[]): void {
    let node = this.nodes.get(mesh.spec.id);
    if (!node) { node = createMeshNode(this.scene, mesh, this.name); this.nodes.set(mesh.spec.id, node); }
    const uploaded = node.draw(context, pose, model, bounds, sun);
    if (uploaded >= 0) { this.uploadedBytes += uploaded; this.draws++; this.triangles += mesh.spec.triangleCount; }
  }
  destroy(): void {
    const renderer = this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    renderer.renderNodes.finishBatch();
    renderer.glWrapper.update({ vao: null } as unknown as Phaser.Types.Renderer.WebGL.WebGLGlobalParameters);
    for (const node of this.nodes.values()) node.dispose();
    this.nodes.clear();
    const programs = renderer.shaderProgramFactory.programs as Record<string, Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper>;
    for (const key of Object.keys(programs)) if (key === this.name || key.startsWith(this.name + '_')) {
      renderer.deleteProgram(programs[key]); delete programs[key];
    }
  }
}

function createMeshNode(scene: Phaser.Scene, mesh: CharacterMeshData, shaderName: string) {
  const renderer = scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer, manager = renderer.renderNodes;
  class MeshNode extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    private pose = -1;
    constructor() {
      super(manager, { name: `${shaderName}:${mesh.spec.id}`, shaderName,
        instancesPerBatch: 1, verticesPerInstance: mesh.spec.vertexCount, indicesPerInstance: mesh.indices.length,
        topology: renderer.gl.TRIANGLES, vertexSource: CHARACTER_MESH_VERTEX, fragmentSource: CHARACTER_MESH_MASK,
        vertexBufferLayout: { usage: 'DYNAMIC_DRAW', layout: [{ name: 'inPosition', size: 3 }] } });
    }
    _generateElementIndices(): ArrayBuffer { return mesh.indices.buffer as ArrayBuffer; }
    draw(context: Phaser.Renderer.WebGL.DrawingContext, pose: number, model: Float32Array, bounds: number[], sun: number[]): number {
      manager.startStandAloneRender(); this.onRunBegin(context);
      let uploaded = 0;
      try {
        const suite = this.programManager.getCurrentProgramSuite() as Suite | null;
        if (!suite) return -1; // Parallel shader compile: report only actual submissions.
        if (this.pose !== pose) {
          const index = mesh.spec.poseIndices.indexOf(pose), length = mesh.spec.vertexCount * 3;
          if (index < 0) throw new Error(`Missing mesh pose ${mesh.spec.id}/${pose}`);
          this.vertexBufferLayout.buffer.viewF32!.set(mesh.positions.subarray(index * length, (index + 1) * length));
          uploaded = length * 4; this.vertexBufferLayout.buffer.update(uploaded); this.pose = pose;
        }
        this.programManager.setUniform('uModel', model);
        this.programManager.setUniform('uSun', sun);
        this.programManager.setUniform('uBounds', bounds);
        this.programManager.applyUniforms(suite.program);
        renderer.drawElements(context, [], suite.program, suite.vao, mesh.indices.length, 0, this.topology);
      } finally { this.onRunEnd(context); }
      return uploaded;
    }
    dispose(): void {
      (manager as unknown as Phaser.Events.EventEmitter).off(Phaser.Renderer.Events.SET_PARALLEL_TEXTURE_UNITS, this.updateTextureCount, this);
      renderer.off(Phaser.Renderer.Events.RESIZE, this.resize, this);
      for (const suite of Object.values(this.programManager.programs)) {
        Phaser.Utils.Array.Remove(renderer.glVAOWrappers, suite.vao); suite.vao.destroy();
      }
      this.programManager.programs = {};
      renderer.deleteBuffer(this.indexBuffer); renderer.deleteBuffer(this.vertexBufferLayout.buffer);
    }
  }
  return new MeshNode();
}
