import * as Phaser from 'phaser';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { MORTAR_FRAGMENT, MORTAR_VERTEX } from './MortarShader';
import { registerGraphicsObject } from '../EffectUtils';

/** Fixed bounded batch: five draws regardless of strike count. No per-strike GameObjects.
 * Shared by mortar and airstrike telegraphs; each owner keeps its own instance of this layer. */
export const MORTAR_BATCH_CAPACITY = 128;
const WORDS = 11, VERTICES = 6;
const CORNERS = [-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1];
/** Ground material, emissive telegraph/embers, airborne shell, lit smoke, shooter thread. */
export const MORTAR_PASS_DEPTHS = [5.12, 19.7, 20.6, 13.38, 19.65] as const;
/** Colour family of a telegraph: hostile void, allied, or the warm player-ordnance family. */
export const STRIKE_PALETTE = { hostile: 0, allied: 1, player: 2 } as const;
export type StrikePalette = typeof STRIKE_PALETTE[keyof typeof STRIKE_PALETTE];
/** timeline: 0..1 windup, 1..2 committed flight, -(1..2) cancelled windup;
 * age < 0 incoming, else seconds since impact (for a cancelled windup: the windup it reached). */
export interface MortarGpuItem { x: number; y: number; radius: number; timeline: number; seed: number; palette: StrikePalette; age: number;
  /** World angle from the aim point toward the shooter; drives the direction-of-fire chevrons. */
  dir: number;
  /** World distance from the aim point to the shooter; 0 draws no shooter thread. */
  tracePx?: number }

export class MortarGpuLayer {
  private readonly data = new Float32Array(MORTAR_BATCH_CAPACITY * VERTICES * WORDS);
  private count = 0;
  private version = 0;
  private timeSeconds = 0;
  private readonly passes: { image: Phaser.GameObjects.Image; batch: MortarBatchPort }[] = [];

  /** `register` attributes the pass images to the owner's profiler family (mortar by default). */
  constructor(private readonly scene: Phaser.Scene,
    register: (image: Phaser.GameObjects.Image) => void = image => registerGraphicsObject(scene, 'mortarEffects', image)) {
    const renderer = scene.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
    if (!renderer?.gl) return;
    for (const [pass, depth] of MORTAR_PASS_DEPTHS.entries()) {
      const image = scene.add.image(0, 0, '__WHITE').setDepth(depth).setVisible(false);
      image.name = `mortar-${['ground', 'telegraph', 'shell', 'smoke', 'trace'][pass]}`;
      register(image);
      const batch = createMortarBatch(renderer, image, pass, this);
      const manager = renderer.renderNodes;
      class Submitter extends Phaser.Renderer.WebGL.RenderNodes.RenderNode {
        constructor() { super(`SubmitterMortar${pass}`, manager); }
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
  add(item: MortarGpuItem): boolean {
    if (this.count >= MORTAR_BATCH_CAPACITY) return false;
    let offset = this.count++ * VERTICES * WORDS;
    for (let i = 0; i < VERTICES; i++) {
      this.data[offset++] = item.x; this.data[offset++] = item.y;
      this.data[offset++] = CORNERS[i * 2]; this.data[offset++] = CORNERS[i * 2 + 1];
      this.data[offset++] = item.radius; this.data[offset++] = item.timeline;
      this.data[offset++] = item.seed; this.data[offset++] = item.palette; this.data[offset++] = item.age;
      this.data[offset++] = item.dir; this.data[offset++] = item.tracePx ? item.tracePx / Math.max(1, item.radius) : 0;
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

interface MortarBatchPort { run(context: Phaser.Renderer.WebGL.DrawingContext, preparing?: boolean): boolean; dispose(): void }
// Lazy like MeteorGpuLayer: importing presentation must also work in headless runtime tests.
function createMortarBatch(renderer: Phaser.Renderer.WebGL.WebGLRenderer, image: Phaser.GameObjects.Image,
  pass: number, owner: MortarGpuLayer): MortarBatchPort {
  class MortarBatch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    private uploadedVersion = -1;
    private disposed = false;
    constructor() {
      super(renderer.renderNodes, { name: `BatchHandlerMortar${pass}`, shaderName: 'MORTAR_GPU',
        instancesPerBatch: MORTAR_BATCH_CAPACITY, verticesPerInstance: VERTICES, indicesPerInstance: VERTICES,
        topology: renderer.gl.TRIANGLES, vertexSource: MORTAR_VERTEX, fragmentSource: MORTAR_FRAGMENT,
        vertexBufferLayout: { usage: 'DYNAMIC_DRAW', layout: [{ name: 'inCenter', size: 2 }, { name: 'inCorner', size: 2 },
          { name: 'inState', size: 4 }, { name: 'inAge', size: 1 }, { name: 'inDir', size: 1 }, { name: 'inTrace', size: 1 }] },
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
  return new MortarBatch();
}
