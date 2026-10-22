import * as Phaser from 'phaser';
import { DEPTH, DEPTH_LIGHTING } from '../../config';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { emissiveAlpha } from '../EmissiveScale';
import { BROOD_PIT_FRAGMENT, BROOD_PIT_VERTEX } from './BroodPitShader';
import { registerGraphicsObject } from '../EffectUtils';

/** Fixed bounded batch: two draws regardless of how many spawn structures a map holds. */
export const BROOD_PIT_BATCH_CAPACITY = 32;
/** Rising bodies one pit shows at once; further ones wait for a free slot. */
export const BROOD_PIT_SWELLS = 3;
const WORDS = 20, VERTICES = 6;
const CORNERS = [-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1];
/** The ooze surface just above the pit sprite (lit), every glow above the light map (emissive). */
export const BROOD_PIT_PASS_DEPTHS = [DEPTH.BASE_GROUNDING + 0.12, DEPTH_LIGHTING + 0.07] as const;

export interface BroodPitSwell {
  /** Pit-local offset of the rising body, px. */
  readonly x: number;
  readonly y: number;
  /** 0..0.75 heaving, 0.75..1 parting and closing; see BroodPitShader. */
  readonly t: number;
}

export interface BroodPitGpuItem {
  x: number; y: number;
  /** Quad half size and pool radius, px. */
  halfSize: number; radius: number;
  charge: number;
  /** 0 sealed, 1 active, 2 dry. */
  state: number;
  seed: number;
  swells: readonly BroodPitSwell[];
}

export class BroodPitGpuLayer {
  private readonly data = new Float32Array(BROOD_PIT_BATCH_CAPACITY * VERTICES * WORDS);
  private count = 0;
  private version = 0;
  private timeSeconds = 0;
  private readonly passes: { image: Phaser.GameObjects.Image; batch: BroodPitBatchPort }[] = [];

  constructor(private readonly scene: Phaser.Scene) {
    const renderer = scene.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
    if (!renderer?.gl) return;
    for (const [pass, depth] of BROOD_PIT_PASS_DEPTHS.entries()) {
      const image = scene.add.image(0, 0, '__WHITE').setDepth(depth).setVisible(false);
      image.name = `brood-pit-${['surface', 'glow'][pass]}`;
      registerGraphicsObject(scene, 'broodPits', image);
      const batch = createBroodPitBatch(renderer, image, pass, this);
      const manager = renderer.renderNodes;
      class Submitter extends Phaser.Renderer.WebGL.RenderNodes.RenderNode {
        constructor() { super(`SubmitterBroodPit${pass}`, manager); }
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
  add(item: BroodPitGpuItem): boolean {
    if (this.count >= BROOD_PIT_BATCH_CAPACITY) return false;
    const swell = (i: number): BroodPitSwell => item.swells[i] ?? { x: 0, y: 0, t: -1 };
    const [s0, s1, s2] = [swell(0), swell(1), swell(2)];
    let offset = this.count++ * VERTICES * WORDS;
    for (let i = 0; i < VERTICES; i++) {
      const values = [item.x, item.y, CORNERS[i * 2], CORNERS[i * 2 + 1],
        item.halfSize, item.radius, item.charge, item.state,
        s0.x, s0.y, s0.t, item.seed,
        s1.x, s1.y, s1.t, s2.x,
        s2.y, s2.t, 0, 0];
      for (const value of values) this.data[offset++] = value;
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
      detail: getGraphicsQualityProfile(this.scene).level === 'low' ? 0 : 1, emissive: emissiveAlpha(1) };
  }
}

interface BroodPitBatchPort { run(context: Phaser.Renderer.WebGL.DrawingContext, preparing?: boolean): boolean; dispose(): void }
// Lazy like RestHealGpuLayer: importing presentation must also work in headless runtime tests.
function createBroodPitBatch(renderer: Phaser.Renderer.WebGL.WebGLRenderer, image: Phaser.GameObjects.Image,
  pass: number, owner: BroodPitGpuLayer): BroodPitBatchPort {
  class BroodPitBatch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    private uploadedVersion = -1;
    private disposed = false;
    constructor() {
      super(renderer.renderNodes, { name: `BatchHandlerBroodPit${pass}`, shaderName: 'BROOD_PIT_GPU',
        instancesPerBatch: BROOD_PIT_BATCH_CAPACITY, verticesPerInstance: VERTICES, indicesPerInstance: VERTICES,
        topology: renderer.gl.TRIANGLES, vertexSource: BROOD_PIT_VERTEX, fragmentSource: BROOD_PIT_FRAGMENT,
        vertexBufferLayout: { usage: 'DYNAMIC_DRAW', layout: [{ name: 'inA', size: 4 }, { name: 'inB', size: 4 },
          { name: 'inC', size: 4 }, { name: 'inD', size: 4 }, { name: 'inE', size: 4 }] },
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
        program.setUniform('uEmissive', frame.emissive);
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
  return new BroodPitBatch();
}
