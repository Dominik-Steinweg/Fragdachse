import * as Phaser from 'phaser';

type Layout = Phaser.Renderer.WebGL.Wrappers.WebGLVertexBufferLayoutWrapper;
// 4.2.1's declaration retains an obsolete program argument; the actual wrapper takes (renderer, layout).
type VertexLayoutConstructor = new (
  renderer: Phaser.Renderer.WebGL.WebGLRenderer, layout: { count: number; usage: string; instanceDivisor?: number;
    layout: { name: string; size: number; type: string }[] }) => Layout;
type Suite = { program: Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper; vao: Phaser.Renderer.WebGL.Wrappers.WebGLVAOWrapper };

/** Phaser-owned buffers/VAOs retain restoration data. Geometry and instance streams are separate. */
export class EnemyMeshGpu {
  readonly program: Phaser.Renderer.WebGL.ProgramManager;
  readonly geometry: Layout;
  readonly instances: Layout;
  private readonly indices: Phaser.Renderer.WebGL.Wrappers.WebGLBufferWrapper;
  indexCount: number;
  readonly bytes: number;
  private destroyed = false;
  constructor(private readonly renderer: Phaser.Renderer.WebGL.WebGLRenderer, name: string,
    vertex: string, fragment: string, positions: Float32Array, dimensions: number, indices: Uint16Array,
    attributes: { name: string; size: number }[], capacity: number) {
    const VertexLayout = Phaser.Renderer.WebGL.Wrappers.WebGLVertexBufferLayoutWrapper as unknown as VertexLayoutConstructor;
    renderer.renderNodes.finishBatch();
    renderer.glWrapper.update({ vao: null } as unknown as Phaser.Types.Renderer.WebGL.WebGLGlobalParameters);
    this.geometry = new VertexLayout(renderer, {
      count: positions.length / dimensions, usage: 'STATIC_DRAW', layout: [{ name: 'inPosition', size: dimensions, type: 'FLOAT' }],
    });
    this.geometry.buffer.viewF32!.set(positions); this.geometry.buffer.update(positions.byteLength);
    this.instances = new VertexLayout(renderer, {
      count: capacity, usage: 'DYNAMIC_DRAW', instanceDivisor: 1, layout: attributes.map(a => ({ ...a, type: 'FLOAT' })),
    });
    this.indices = renderer.createIndexBuffer(indices.buffer as ArrayBuffer, renderer.gl.STATIC_DRAW);
    // Phaser's declaration calls these plain layouts; runtime consumes their wrappers (as SpriteGPULayer does).
    this.program = new Phaser.Renderer.WebGL.ProgramManager(renderer,
      [this.geometry, this.instances] as unknown as Phaser.Types.Renderer.WebGL.WebGLAttributeBufferLayout[], this.indices);
    this.program.setBaseShader(name, vertex, fragment);
    this.indexCount = indices.length;
    this.bytes = positions.byteLength + indices.byteLength + capacity * attributes.reduce((n, a) => n + a.size * 4, 0);
  }
  prepare(): boolean { return !!this.program.getCurrentProgramSuite(); }
  /** Streaming poses may change topology within the buffers' fixed allocation. */
  updateGeometry(positions: Float32Array, indices: Uint16Array): boolean {
    if (positions.length > this.geometry.buffer.viewF32!.length || indices.length > this.indices.viewU16!.length) return false;
    this.renderer.renderNodes.finishBatch();
    this.renderer.glWrapper.update({ vao: null } as unknown as Phaser.Types.Renderer.WebGL.WebGLGlobalParameters);
    this.geometry.buffer.viewF32!.set(positions); this.geometry.buffer.update(positions.byteLength);
    // ELEMENT_ARRAY_BUFFER belongs to the VAO, but Phaser also caches its
    // binding globally. Synchronize around streaming so a subsequently created
    // VAO actually binds this buffer instead of inheriting a stale cache hit.
    this.indices.bind(true);
    this.indices.viewU16!.set(indices); this.indices.update(indices.byteLength);
    this.indices.bind(true);
    this.indexCount = indices.length;
    return true;
  }
  draw(context: Phaser.Renderer.WebGL.DrawingContext, data: Float32Array, count: number,
    textures: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper[], uniforms: (set: (name: string, value: unknown) => void) => void): boolean {
    const suite = this.program.getCurrentProgramSuite() as Suite | null; if (!suite || !count) return false;
    const r = this.renderer;
    r.renderNodes.startStandAloneRender();
    this.instances.buffer.viewF32!.set(data); this.instances.buffer.update(data.byteLength);
    uniforms((name, value) => this.program.setUniform(name, value)); this.program.applyUniforms(suite.program);
    context.beginDraw(); suite.program.bind(); suite.vao.bind(); r.glTextureUnits.bindUnits(textures);
    // Indexed instancing is absent from Phaser's draw helpers; use the same wrapper binding sequence.
    (r.gl as WebGL2RenderingContext).drawElementsInstanced(r.gl.TRIANGLES, this.indexCount, r.gl.UNSIGNED_SHORT, 0, count);
    return true;
  }
  destroy(): void {
    if (this.destroyed) return; this.destroyed = true;
    const r = this.renderer; r.renderNodes.finishBatch();
    r.glWrapper.update({ vao: null } as unknown as Phaser.Types.Renderer.WebGL.WebGLGlobalParameters);
    for (const suite of Object.values(this.program.programs)) {
      Phaser.Utils.Array.Remove(r.glVAOWrappers, suite.vao); suite.vao.destroy();
    }
    this.program.programs = {};
    r.deleteBuffer(this.indices); r.deleteBuffer(this.geometry.buffer); r.deleteBuffer(this.instances.buffer);
  }
}
