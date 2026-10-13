import * as Phaser from 'phaser';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { ENERGY_SHIELD_FRAGMENT, ENERGY_SHIELD_VERTEX } from './EnergyShieldShader';
import { registerGraphicsObject } from '../EffectUtils';

/** Fixed bounded batch: one draw for every player shield, dome and enemy frontal shield. */
export const ENERGY_SHIELD_BATCH_CAPACITY = 192;
const WORDS = 18, VERTICES = 6;
const CORNERS = [-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1];
/** Same band as the former Graphics arcs (DEPTH.FIRE + 0.2): above bodies, under the lightmap. */
export const ENERGY_SHIELD_PASS_DEPTH = 16.2;

/** One shield membrane; see EnergyShieldShader for the meaning of each word. */
export interface EnergyShieldGpuItem {
  x: number; y: number; angle: number; radius: number;
  thickness: number; halfArc: number; alpha: number; flash: number;
  color: number; style: number;
  impactAgeS: number; lifeS: number; fade: number; seed: number;
}

export class EnergyShieldGpuLayer {
  private readonly data = new Float32Array(ENERGY_SHIELD_BATCH_CAPACITY * VERTICES * WORDS);
  private count = 0;
  private version = 0;
  private timeSeconds = 0;
  private pass: { image: Phaser.GameObjects.Image; batch: EnergyShieldBatchPort } | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    const renderer = scene.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
    if (!renderer?.gl) return;
    const image = scene.add.image(0, 0, '__WHITE').setDepth(ENERGY_SHIELD_PASS_DEPTH).setVisible(false);
    image.name = 'energy-shield-membrane';
    registerGraphicsObject(scene, 'energyShieldEffects', image);
    const batch = createEnergyShieldBatch(renderer, image, this);
    const manager = renderer.renderNodes;
    class Submitter extends Phaser.Renderer.WebGL.RenderNodes.RenderNode {
      constructor() { super('SubmitterEnergyShield', manager); }
      run(context: Phaser.Renderer.WebGL.DrawingContext): void {
        manager.startStandAloneRender(); this.onRunBegin(context); batch.run(context); this.onRunEnd(context);
      }
    }
    image.setRenderNodeRole('Submitter', new Submitter());
    image.once(Phaser.GameObjects.Events.DESTROY, () => batch.dispose());
    this.pass = { image, batch };
  }

  begin(timeMs: number): void { this.count = 0; this.timeSeconds = (timeMs / 1000) % 1000; }
  add(item: EnergyShieldGpuItem): boolean {
    if (this.count >= ENERGY_SHIELD_BATCH_CAPACITY) return false;
    const r = ((item.color >> 16) & 0xff) / 255, g = ((item.color >> 8) & 0xff) / 255, b = (item.color & 0xff) / 255;
    let offset = this.count++ * VERTICES * WORDS;
    for (let i = 0; i < VERTICES; i++) {
      this.data[offset++] = item.x; this.data[offset++] = item.y; this.data[offset++] = item.angle; this.data[offset++] = item.radius;
      this.data[offset++] = CORNERS[i * 2]; this.data[offset++] = CORNERS[i * 2 + 1];
      this.data[offset++] = item.thickness; this.data[offset++] = item.halfArc; this.data[offset++] = item.alpha; this.data[offset++] = item.flash;
      this.data[offset++] = r; this.data[offset++] = g; this.data[offset++] = b; this.data[offset++] = item.style;
      this.data[offset++] = item.impactAgeS; this.data[offset++] = item.lifeS; this.data[offset++] = item.fade; this.data[offset++] = item.seed;
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

interface EnergyShieldBatchPort { run(context: Phaser.Renderer.WebGL.DrawingContext, preparing?: boolean): boolean; dispose(): void }
// Lazy like the other GPU layers: importing presentation must also work in headless runtime tests.
function createEnergyShieldBatch(renderer: Phaser.Renderer.WebGL.WebGLRenderer, image: Phaser.GameObjects.Image,
  owner: EnergyShieldGpuLayer): EnergyShieldBatchPort {
  class EnergyShieldBatch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    private uploadedVersion = -1;
    private disposed = false;
    constructor() {
      super(renderer.renderNodes, { name: 'BatchHandlerEnergyShield', shaderName: 'ENERGY_SHIELD_GPU',
        instancesPerBatch: ENERGY_SHIELD_BATCH_CAPACITY, verticesPerInstance: VERTICES, indicesPerInstance: VERTICES,
        topology: renderer.gl.TRIANGLES, vertexSource: ENERGY_SHIELD_VERTEX, fragmentSource: ENERGY_SHIELD_FRAGMENT,
        vertexBufferLayout: { usage: 'DYNAMIC_DRAW', layout: [{ name: 'inA', size: 4 }, { name: 'inCorner', size: 2 },
          { name: 'inShape', size: 4 }, { name: 'inColor', size: 4 }, { name: 'inTime', size: 4 }] },
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
  return new EnergyShieldBatch();
}
