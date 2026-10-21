import * as Phaser from 'phaser';
import { DEPTH, DEPTH_LIGHTING } from '../../config';
import type { ShaderWarmupProbe } from '../../graphics/ShaderWarmupProbe';
import { registerGraphicsObject } from '../EffectUtils';
import { SPAWN_FRAGMENT, SPAWN_VERTEX } from './SpawnShader';

/** Fixed bounded batch: three draws per frame regardless of how many figures spawn at once. */
export const SPAWN_GPU_CAPACITY = 1536;
/** Sigil paint under the bodies (lit), every glow above the light map, the light column above the canopy. */
export const SPAWN_PASS_DEPTHS = [DEPTH.PLAYERS - 0.3, DEPTH_LIGHTING + 0.08, DEPTH.CANOPY + 0.3] as const;
const VERTICES = 6, WORDS = 16;
const CORNERS = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];

/** One quad; see SpawnShader for the meaning of kind, variant and p1..p4. */
export interface SpawnGpuInstance {
  x: number; y: number; kind: number; t0: number; seed: number; variant: number;
  r: number; g: number; b: number; scale: number;
  p1: number; p2: number; p3: number; p4: number;
}

export class SpawnGpuLayer {
  private readonly data = new Float32Array(SPAWN_GPU_CAPACITY * VERTICES * WORDS);
  private count = 0;
  private version = 0;
  /** Layer clock in seconds, the same base as every instance's t0. */
  private time = 0;
  private detail = 1;
  private emissive = 1;
  private readonly passes: { image: Phaser.GameObjects.Image; batch: SpawnBatchPort }[] = [];

  constructor(scene: Phaser.Scene) {
    const renderer = scene.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
    if (!renderer?.gl) return;
    for (const [pass, depth] of SPAWN_PASS_DEPTHS.entries()) {
      const image = scene.add.image(0, 0, '__WHITE').setDepth(depth).setVisible(false);
      image.name = `spawn-${['ground', 'glow', 'sky'][pass]}`;
      registerGraphicsObject(scene, 'spawnRings', image);
      const batch = createSpawnBatch(renderer, image, pass, this);
      const manager = renderer.renderNodes;
      class Submitter extends Phaser.Renderer.WebGL.RenderNodes.RenderNode {
        constructor() { super(`SubmitterSpawn${pass}`, manager); }
        run(context: Phaser.Renderer.WebGL.DrawingContext): void {
          manager.startStandAloneRender(); this.onRunBegin(context); batch.run(context); this.onRunEnd(context);
        }
      }
      image.setRenderNodeRole('Submitter', new Submitter());
      image.once(Phaser.GameObjects.Events.DESTROY, () => batch.dispose());
      this.passes.push({ image, batch });
    }
  }

  /** False without WebGL (headless runtime, canvas renderer): spawns then carry only their light. */
  get renders(): boolean { return this.passes.length > 0; }
  get size(): number { return this.count; }

  begin(): void { this.count = 0; }
  add(i: SpawnGpuInstance): boolean {
    if (this.count >= SPAWN_GPU_CAPACITY) return false;
    let o = this.count++ * VERTICES * WORDS;
    const d = this.data;
    for (let v = 0; v < VERTICES; v++) {
      d[o++] = i.x; d[o++] = i.y; d[o++] = CORNERS[v * 2]; d[o++] = CORNERS[v * 2 + 1];
      d[o++] = i.kind; d[o++] = i.t0; d[o++] = i.seed; d[o++] = i.variant;
      d[o++] = i.r; d[o++] = i.g; d[o++] = i.b; d[o++] = i.scale;
      d[o++] = i.p1; d[o++] = i.p2; d[o++] = i.p3; d[o++] = i.p4;
    }
    return true;
  }
  /** Publishes the instances written since `begin()`; an empty layer is hidden and costs nothing. */
  end(): void {
    this.version++;
    for (const { image } of this.passes) image.setVisible(this.count > 0);
  }
  setFrame(timeSeconds: number, detail: number, emissive: number): void {
    this.time = timeSeconds; this.detail = detail; this.emissive = emissive;
  }

  /** Shader warmup: links the program and primes every pass with one empty instance. */
  prepare(context: Phaser.Renderer.WebGL.DrawingContext): boolean {
    context.renderer.renderNodes.startStandAloneRender();
    return this.passes.map(({ batch }) => batch.run(context, true)).every(Boolean);
  }
  destroy(): void {
    for (const { image } of this.passes) image.destroy();
    this.passes.length = 0;
    this.count = 0;
  }
  /** Read by the batch at render time; the layer itself is the frame, nothing is allocated. */
  get frame(): SpawnGpuLayerFrame { return this; }
  get instanceData(): Float32Array { return this.data; }
  get uploadVersion(): number { return this.version; }
  get clock(): number { return this.time; }
  get detailLevel(): number { return this.detail; }
  get emissiveScale(): number { return this.emissive; }
}

/** Links the spawn program during the loading barrier, so the first spawn never stalls. */
export function createSpawnShaderProbe(scene: Phaser.Scene): ShaderWarmupProbe {
  let layer: SpawnGpuLayer | null = null;
  return {
    name: 'spawn',
    prepare: context => (layer ??= new SpawnGpuLayer(scene)).prepare(context),
    destroy: () => { layer?.destroy(); layer = null; },
  };
}

interface SpawnGpuLayerFrame {
  readonly instanceData: Float32Array; readonly size: number; readonly uploadVersion: number;
  readonly clock: number; readonly detailLevel: number; readonly emissiveScale: number;
}
interface SpawnBatchPort { run(context: Phaser.Renderer.WebGL.DrawingContext, preparing?: boolean): boolean; dispose(): void }
// Lazy like RestHealGpuLayer: importing presentation must also work in headless runtime tests.
function createSpawnBatch(renderer: Phaser.Renderer.WebGL.WebGLRenderer, image: Phaser.GameObjects.Image,
  pass: number, owner: SpawnGpuLayer): SpawnBatchPort {
  class SpawnBatch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    private uploadedVersion = -1;
    private disposed = false;
    constructor() {
      super(renderer.renderNodes, { name: `BatchHandlerSpawn${pass}`, shaderName: 'SPAWN_GPU',
        instancesPerBatch: SPAWN_GPU_CAPACITY, verticesPerInstance: VERTICES, indicesPerInstance: VERTICES,
        topology: renderer.gl.TRIANGLES, vertexSource: SPAWN_VERTEX, fragmentSource: SPAWN_FRAGMENT,
        vertexBufferLayout: { usage: 'DYNAMIC_DRAW', layout: [{ name: 'inGeom', size: 4 }, { name: 'inEvent', size: 4 },
          { name: 'inColor', size: 4 }, { name: 'inParam', size: 4 }] },
      });
    }
    // Phaser calls this virtual hook in its constructor (omitted from Phaser's public d.ts).
    _generateElementIndices(instances: number): ArrayBuffer {
      const indices = new Uint16Array(instances * VERTICES); for (let i = 0; i < indices.length; i++) indices[i] = i; return indices.buffer;
    }
    run(context: Phaser.Renderer.WebGL.DrawingContext, preparing = false): boolean {
      const frame = owner.frame;
      if (!preparing && !frame.size) return false;
      const instances = Math.max(preparing ? 1 : 0, frame.size);
      this.onRunBegin(context);
      const program = this.programManager;
      // Phaser 4.2.1 documents the suite but types its return as plain Object.
      const suite = program.getCurrentProgramSuite() as { program: Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper;
        vao: Phaser.Renderer.WebGL.Wrappers.WebGLVAOWrapper } | null;
      if (suite) {
        if (preparing && frame.size === 0) frame.instanceData.fill(0, 0, VERTICES * WORDS);
        if (this.uploadedVersion !== frame.uploadVersion || preparing) {
          const data = frame.instanceData.subarray(0, instances * VERTICES * WORDS);
          this.vertexBufferLayout.buffer.viewF32!.set(data);
          this.vertexBufferLayout.buffer.update(data.byteLength, 0);
          this.uploadedVersion = preparing ? -1 : frame.uploadVersion;
        }
        const m = context.camera!.getViewMatrix(!context.useCanvas);
        renderer.setProjectionMatrixFromDrawingContext(context);
        program.setUniform('uProjectionMatrix', renderer.projectionMatrix.val);
        program.setUniform('uViewMatrix', [m.a, m.b, 0, m.c, m.d, 0, m.tx, m.ty, 1]);
        program.setUniform('uPass', pass);
        program.setUniform('uTime', frame.clock);
        program.setUniform('uDetail', frame.detailLevel);
        program.setUniform('uEmissive', frame.emissiveScale);
        program.setUniform('uAlpha', image.alpha);
        // World units per framebuffer pixel keep every line one pixel soft at any zoom.
        program.setUniform('uPixel', 1 / Math.max(1e-4, Math.hypot(m.a, m.b)));
        program.applyUniforms(suite.program);
        renderer.drawElements(context, [], suite.program, suite.vao, instances * VERTICES, 0, this.topology);
      }
      this.onRunEnd(context); return !!suite;
    }
    dispose(): void {
      if (this.disposed) return; this.disposed = true;
      // RenderNodeManager mixes in EventEmitter; its d.ts omits that inheritance.
      (this.manager as unknown as Phaser.Events.EventEmitter).off(Phaser.Renderer.Events.SET_PARALLEL_TEXTURE_UNITS, this.updateTextureCount, this);
      for (const suite of Object.values(this.programManager.programs)) {
        Phaser.Utils.Array.Remove(renderer.glVAOWrappers, suite.vao); suite.vao.destroy();
      }
      this.programManager.programs = {}; renderer.deleteBuffer(this.indexBuffer); renderer.deleteBuffer(this.vertexBufferLayout.buffer);
    }
  }
  return new SpawnBatch();
}
