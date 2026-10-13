import * as Phaser from 'phaser';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { ALIEN_CONE_FRAGMENT, ALIEN_CONE_VERTEX } from './AlienConeShader';
import { registerGraphicsObject } from '../EffectUtils';

/** Fixed bounded batch: one draw for every charging and pulsing alien. */
export const ALIEN_CONE_BATCH_CAPACITY = 128;
const WORDS = 22, VERTICES = 6;
const CORNERS = [-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1];
/** Emissive energy above the night lightmap (19.5), below the canopy (20). */
export const ALIEN_CONE_PASS_DEPTH = 19.72;
const REACH_QUANT = 255;

/** One cone item in the caster frame; see AlienConeShader for the per-kind meaning of `t`. */
export interface AlienConeGpuItem {
  originX: number; originY: number; angle: number; range: number;
  halfArc: number; kind: number; t: number; seed: number;
  allied: boolean; intensity: number; muzzlePx: number;
  /** Cover reach per ray, fraction of `range`, left to right edge (16 values). */
  clip: readonly number[];
}

const q = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * REACH_QUANT);

export class AlienConeGpuLayer {
  private readonly data = new Float32Array(ALIEN_CONE_BATCH_CAPACITY * VERTICES * WORDS);
  private count = 0;
  private version = 0;
  private timeSeconds = 0;
  private pass: { image: Phaser.GameObjects.Image; batch: AlienConeBatchPort } | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    const renderer = scene.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
    if (!renderer?.gl) return;
    const image = scene.add.image(0, 0, '__WHITE').setDepth(ALIEN_CONE_PASS_DEPTH).setVisible(false);
    image.name = 'alien-cone-energy';
    registerGraphicsObject(scene, 'alienConeEffects', image);
    const batch = createAlienConeBatch(renderer, image, this);
    const manager = renderer.renderNodes;
    class Submitter extends Phaser.Renderer.WebGL.RenderNodes.RenderNode {
      constructor() { super('SubmitterAlienCone', manager); }
      run(context: Phaser.Renderer.WebGL.DrawingContext): void {
        manager.startStandAloneRender(); this.onRunBegin(context); batch.run(context); this.onRunEnd(context);
      }
    }
    image.setRenderNodeRole('Submitter', new Submitter());
    image.once(Phaser.GameObjects.Events.DESTROY, () => batch.dispose());
    this.pass = { image, batch };
  }

  begin(timeMs: number): void { this.count = 0; this.timeSeconds = (timeMs / 1000) % 1000; }
  add(item: AlienConeGpuItem): boolean {
    if (this.count >= ALIEN_CONE_BATCH_CAPACITY) return false;
    const c = item.clip;
    const packed = Array.from({ length: 8 }, (_, i) => q(c[i * 2] ?? 1) * 256 + q(c[i * 2 + 1] ?? 1));
    let offset = this.count++ * VERTICES * WORDS;
    for (let i = 0; i < VERTICES; i++) {
      this.data[offset++] = item.originX; this.data[offset++] = item.originY; this.data[offset++] = item.angle; this.data[offset++] = item.range;
      this.data[offset++] = CORNERS[i * 2]; this.data[offset++] = CORNERS[i * 2 + 1];
      this.data[offset++] = item.halfArc; this.data[offset++] = item.kind; this.data[offset++] = item.t; this.data[offset++] = item.seed;
      this.data[offset++] = item.allied ? 1 : 0; this.data[offset++] = item.intensity; this.data[offset++] = item.muzzlePx; this.data[offset++] = 0;
      for (const value of packed) this.data[offset++] = value;
    }
    return true;
  }
  flush(): void {
    this.version++;
    this.pass?.image.setVisible(this.count > 0);
  }
  clear(): void { this.begin(0); this.flush(); }
  /** Shader warmup: links the program and primes the pass with one empty instance. */
  prepare(context: Phaser.Renderer.WebGL.DrawingContext): boolean {
    if (!this.pass) return false;
    context.renderer.renderNodes.startStandAloneRender();
    return this.pass.batch.run(context, true);
  }
  destroy(): void { this.pass?.image.destroy(); this.pass = null; }
  get size(): number { return this.count; }
  get frame() {
    return { data: this.data, count: this.count, version: this.version, time: this.timeSeconds,
      detail: getGraphicsQualityProfile(this.scene).level === 'low' ? 0 : 1 };
  }
}

interface AlienConeBatchPort { run(context: Phaser.Renderer.WebGL.DrawingContext, preparing?: boolean): boolean; dispose(): void }
// Lazy like the other GPU layers: importing presentation must also work in headless runtime tests.
function createAlienConeBatch(renderer: Phaser.Renderer.WebGL.WebGLRenderer, image: Phaser.GameObjects.Image,
  owner: AlienConeGpuLayer): AlienConeBatchPort {
  class AlienConeBatch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    private uploadedVersion = -1;
    private disposed = false;
    constructor() {
      super(renderer.renderNodes, { name: 'BatchHandlerAlienCone', shaderName: 'ALIEN_CONE_GPU',
        instancesPerBatch: ALIEN_CONE_BATCH_CAPACITY, verticesPerInstance: VERTICES, indicesPerInstance: VERTICES,
        topology: renderer.gl.TRIANGLES, vertexSource: ALIEN_CONE_VERTEX, fragmentSource: ALIEN_CONE_FRAGMENT,
        vertexBufferLayout: { usage: 'DYNAMIC_DRAW', layout: [{ name: 'inA', size: 4 }, { name: 'inCorner', size: 2 },
          { name: 'inShape', size: 4 }, { name: 'inAux', size: 4 }, { name: 'inClipA', size: 4 }, { name: 'inClipB', size: 4 }] },
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
        program.setUniform('uDetail', frame.detail);
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
  return new AlienConeBatch();
}
