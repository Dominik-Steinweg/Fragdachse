import * as Phaser from 'phaser';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { FIRESTARTER_FRAGMENT, FIRESTARTER_VERTEX } from './FirestarterShader';
import { registerGraphicsObject } from '../EffectUtils';

/** Fixed bounded batch: three draws regardless of how many firestarters fight. */
export const FIRESTARTER_BATCH_CAPACITY = 256;
const WORDS = 14, VERTICES = 6;
const CORNERS = [-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1];
/** Ground material, projectile body, emissive overlay. */
export const FIRESTARTER_PASS_DEPTHS = [5.12, 15.05, 19.7] as const;
/** Segment a→b with half width; see FirestarterShader for the per-kind meaning of t and aux. */
export interface FirestarterGpuItem {
  ax: number; ay: number; bx: number; by: number;
  halfWidth: number; kind: number; t: number; seed: number;
  allied: boolean; a1?: number; a2?: number; a3?: number;
}

export class FirestarterGpuLayer {
  private readonly data = new Float32Array(FIRESTARTER_BATCH_CAPACITY * VERTICES * WORDS);
  private count = 0;
  private version = 0;
  private timeSeconds = 0;
  private readonly passes: { image: Phaser.GameObjects.Image; batch: FirestarterBatchPort }[] = [];

  constructor(private readonly scene: Phaser.Scene) {
    const renderer = scene.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
    if (!renderer?.gl) return;
    for (const [pass, depth] of FIRESTARTER_PASS_DEPTHS.entries()) {
      const image = scene.add.image(0, 0, '__WHITE').setDepth(depth).setVisible(false);
      image.name = `firestarter-${['ground', 'orb', 'overlay'][pass]}`;
      registerGraphicsObject(scene, 'firestarterEffects', image);
      const batch = createFirestarterBatch(renderer, image, pass, this);
      const manager = renderer.renderNodes;
      class Submitter extends Phaser.Renderer.WebGL.RenderNodes.RenderNode {
        constructor() { super(`SubmitterFirestarter${pass}`, manager); }
        run(context: Phaser.Renderer.WebGL.DrawingContext): void {
          manager.startStandAloneRender(); this.onRunBegin(context); batch.run(context); this.onRunEnd(context);
        }
      }
      image.setRenderNodeRole('Submitter', new Submitter());
      image.once(Phaser.GameObjects.Events.DESTROY, () => batch.dispose());
      this.passes.push({ image, batch });
    }
  }

  begin(timeMs: number): void { this.count = 0; this.timeSeconds = (timeMs / 1000) % 1000; }
  add(item: FirestarterGpuItem): boolean {
    if (this.count >= FIRESTARTER_BATCH_CAPACITY) return false;
    let offset = this.count++ * VERTICES * WORDS;
    for (let i = 0; i < VERTICES; i++) {
      this.data[offset++] = item.ax; this.data[offset++] = item.ay; this.data[offset++] = item.bx; this.data[offset++] = item.by;
      this.data[offset++] = CORNERS[i * 2]; this.data[offset++] = CORNERS[i * 2 + 1];
      this.data[offset++] = item.halfWidth; this.data[offset++] = item.kind; this.data[offset++] = item.t; this.data[offset++] = item.seed;
      this.data[offset++] = item.allied ? 1 : 0; this.data[offset++] = item.a1 ?? 0;
      this.data[offset++] = item.a2 ?? 0; this.data[offset++] = item.a3 ?? 0;
    }
    return true;
  }
  flush(): void {
    this.version++;
    for (const { image } of this.passes) image.setVisible(this.count > 0);
  }
  clear(): void { this.begin(0); this.flush(); }
  /** Shader warmup: links the program and primes every pass with one empty instance. */
  prepare(context: Phaser.Renderer.WebGL.DrawingContext): boolean {
    context.renderer.renderNodes.startStandAloneRender();
    return this.passes.map(({ batch }) => batch.run(context, true)).every(Boolean);
  }
  destroy(): void { for (const { image } of this.passes) image.destroy(); this.passes.length = 0; }
  get size(): number { return this.count; }
  get frame() {
    return { data: this.data, count: this.count, version: this.version, time: this.timeSeconds,
      detail: getGraphicsQualityProfile(this.scene).level === 'low' ? 0 : 1 };
  }
}

interface FirestarterBatchPort { run(context: Phaser.Renderer.WebGL.DrawingContext, preparing?: boolean): boolean; dispose(): void }
// Lazy like MortarGpuLayer: importing presentation must also work in headless runtime tests.
function createFirestarterBatch(renderer: Phaser.Renderer.WebGL.WebGLRenderer, image: Phaser.GameObjects.Image,
  pass: number, owner: FirestarterGpuLayer): FirestarterBatchPort {
  class FirestarterBatch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    private uploadedVersion = -1;
    private disposed = false;
    constructor() {
      super(renderer.renderNodes, { name: `BatchHandlerFirestarter${pass}`, shaderName: 'FIRESTARTER_GPU',
        instancesPerBatch: FIRESTARTER_BATCH_CAPACITY, verticesPerInstance: VERTICES, indicesPerInstance: VERTICES,
        topology: renderer.gl.TRIANGLES, vertexSource: FIRESTARTER_VERTEX, fragmentSource: FIRESTARTER_FRAGMENT,
        vertexBufferLayout: { usage: 'DYNAMIC_DRAW', layout: [{ name: 'inSeg', size: 4 }, { name: 'inCorner', size: 2 },
          { name: 'inShape', size: 4 }, { name: 'inAux', size: 4 }] },
      });
    }
    _generateElementIndices(instances: number): ArrayBuffer {
      const indices = new Uint16Array(instances * VERTICES); for (let i = 0; i < indices.length; i++) indices[i] = i; return indices.buffer;
    }
    run(context: Phaser.Renderer.WebGL.DrawingContext, preparing = false): boolean {
      const frame = owner.frame;
      if (!preparing && !frame.count) return false;
      const instances = Math.max(preparing ? 1 : 0, frame.count);
      this.onRunBegin(context);
      const program = this.programManager;
      const suite = program.getCurrentProgramSuite() as { program: Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper;
        vao: Phaser.Renderer.WebGL.Wrappers.WebGLVAOWrapper } | null;
      if (suite) {
        if (this.uploadedVersion !== frame.version) {
          const data = frame.data.subarray(0, instances * VERTICES * WORDS);
          this.vertexBufferLayout.buffer.viewF32!.set(data);
          this.vertexBufferLayout.buffer.update(data.byteLength, 0); this.uploadedVersion = frame.version;
        }
        const m = context.camera!.getViewMatrix();
        renderer.setProjectionMatrixFromDrawingContext(context);
        program.setUniform('uProjectionMatrix', renderer.projectionMatrix.val);
        program.setUniform('uViewMatrix', [m.a, m.b, 0, m.c, m.d, 0, m.tx, m.ty, 1]);
        program.setUniform('uPass', pass); program.setUniform('uDetail', frame.detail);
        program.setUniform('uTime', frame.time); program.setUniform('uAlpha', image.alpha);
        program.applyUniforms(suite.program);
        renderer.drawElements(context, [], suite.program, suite.vao, instances * VERTICES, 0, this.topology);
      }
      this.onRunEnd(context); return !!suite;
    }
    dispose(): void {
      if (this.disposed) return; this.disposed = true;
      (this.manager as unknown as Phaser.Events.EventEmitter).off(Phaser.Renderer.Events.SET_PARALLEL_TEXTURE_UNITS, this.updateTextureCount, this);
      for (const suite of Object.values(this.programManager.programs)) {
        Phaser.Utils.Array.Remove(renderer.glVAOWrappers, suite.vao); suite.vao.destroy();
      }
      this.programManager.programs = {}; renderer.deleteBuffer(this.indexBuffer); renderer.deleteBuffer(this.vertexBufferLayout.buffer);
    }
  }
  return new FirestarterBatch();
}
