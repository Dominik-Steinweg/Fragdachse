import * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import type { ShaderWarmupProbe } from '../../graphics/ShaderWarmupProbe';
import { CHARACTER_SHADOW_CONFIG } from '../ShadowConfig';
import { registerGraphicsObject } from '../EffectUtils';
import { BEE_SWARM_FRAGMENT, BEE_SWARM_VERTEX } from './BeeSwarmShader';

/** Bounded batch: two draws per frame for every bee on screen (hives and swarms). */
export const BEE_GPU_CAPACITY = 1024;
/** Soft shadow dots on the ground; bees in the low flight band, lit like the ground, under the crowns. */
export const BEE_PASS_DEPTHS = [CHARACTER_SHADOW_CONFIG.depth - 0.005, DEPTH.GROUND_FOG_COMPOSITE + 1.8] as const;
const VERTICES = 6, WORDS = 16;
const CORNERS = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];

export interface BeeGpuInstance {
  x: number; y: number;
  heading: number; wing: number; size: number; alpha: number;
  r: number; g: number; b: number; hostile: number;
  kind: number; blur: number; altitude: number; seed: number;
}

export class BeeSwarmGpuLayer {
  private readonly data = new Float32Array(BEE_GPU_CAPACITY * VERTICES * WORDS);
  private count = 0;
  private version = 0;
  private time = 0;
  private pixel = 1;
  private shadow = 1;
  private readonly passes: { image: Phaser.GameObjects.Image; batch: BeeBatchPort }[] = [];

  constructor(scene: Phaser.Scene) {
    const renderer = scene.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
    if (!renderer?.gl) return;
    for (const [pass, depth] of BEE_PASS_DEPTHS.entries()) {
      const image = scene.add.image(0, 0, '__WHITE').setDepth(depth).setVisible(false);
      image.name = `bees-${['shadow', 'flight'][pass]}`;
      registerGraphicsObject(scene, 'beeSwarms', image);
      const batch = createBeeBatch(renderer, image, pass, this);
      const manager = renderer.renderNodes;
      class Submitter extends Phaser.Renderer.WebGL.RenderNodes.RenderNode {
        constructor() { super(`SubmitterBees${pass}`, manager); }
        run(context: Phaser.Renderer.WebGL.DrawingContext): void {
          manager.startStandAloneRender(); this.onRunBegin(context); batch.run(context); this.onRunEnd(context);
        }
      }
      image.setRenderNodeRole('Submitter', new Submitter());
      image.once(Phaser.GameObjects.Events.DESTROY, () => batch.dispose());
      this.passes.push({ image, batch });
    }
  }

  /** False without WebGL (headless runtime): bees are then simply not drawn. */
  get renders(): boolean { return this.passes.length > 0; }
  get size(): number { return this.count; }

  begin(): void { this.count = 0; }
  add(i: BeeGpuInstance): boolean {
    if (this.count >= BEE_GPU_CAPACITY) return false;
    let o = this.count++ * VERTICES * WORDS;
    const d = this.data;
    for (let v = 0; v < VERTICES; v++) {
      d[o++] = i.x; d[o++] = i.y; d[o++] = CORNERS[v * 2]; d[o++] = CORNERS[v * 2 + 1];
      d[o++] = i.heading; d[o++] = i.wing; d[o++] = i.size; d[o++] = i.alpha;
      d[o++] = i.r; d[o++] = i.g; d[o++] = i.b; d[o++] = i.hostile;
      d[o++] = i.kind; d[o++] = i.blur; d[o++] = i.altitude; d[o++] = i.seed;
    }
    return true;
  }
  /** Publishes the instances written since `begin()`; an empty layer is hidden and costs nothing. */
  end(): void {
    this.version++;
    for (const { image } of this.passes) image.setVisible(this.count > 0);
  }
  /** Layer clock in seconds, world px per screen px (antialiasing width) and the shadow strength. */
  setFrame(timeSeconds: number, worldPxPerScreenPx: number, shadowStrength: number): void {
    this.time = timeSeconds; this.pixel = worldPxPerScreenPx; this.shadow = shadowStrength;
  }

  /** Shader warmup: links the program and primes both passes with one empty instance. */
  prepare(context: Phaser.Renderer.WebGL.DrawingContext): boolean {
    context.renderer.renderNodes.startStandAloneRender();
    return this.passes.map(({ batch }) => batch.run(context, true)).every(Boolean);
  }
  destroy(): void {
    for (const { image } of this.passes) image.destroy();
    this.passes.length = 0;
    this.count = 0;
  }
  get frame(): BeeGpuLayerFrame { return this; }
  get instanceData(): Float32Array { return this.data; }
  get uploadVersion(): number { return this.version; }
  get clock(): number { return this.time; }
  get pixelSize(): number { return this.pixel; }
  get shadowStrength(): number { return this.shadow; }
}

/** Links the bee program during the loading barrier, so the first swarm never stalls the frame. */
export function createBeeSwarmShaderProbe(scene: Phaser.Scene): ShaderWarmupProbe {
  let layer: BeeSwarmGpuLayer | null = null;
  return {
    name: 'bee-swarm',
    prepare: context => (layer ??= new BeeSwarmGpuLayer(scene)).prepare(context),
    destroy: () => { layer?.destroy(); layer = null; },
  };
}

interface BeeGpuLayerFrame {
  readonly instanceData: Float32Array; readonly size: number; readonly uploadVersion: number;
  readonly clock: number; readonly pixelSize: number; readonly shadowStrength: number;
}
interface BeeBatchPort { run(context: Phaser.Renderer.WebGL.DrawingContext, preparing?: boolean): boolean; dispose(): void }
// Lazy like SpawnGpuLayer: importing presentation must also work in headless runtime tests.
function createBeeBatch(renderer: Phaser.Renderer.WebGL.WebGLRenderer, image: Phaser.GameObjects.Image,
  pass: number, owner: BeeSwarmGpuLayer): BeeBatchPort {
  class BeeBatch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    private uploadedVersion = -1;
    private disposed = false;
    constructor() {
      super(renderer.renderNodes, { name: `BatchHandlerBees${pass}`, shaderName: 'BEE_SWARM_GPU',
        instancesPerBatch: BEE_GPU_CAPACITY, verticesPerInstance: VERTICES, indicesPerInstance: VERTICES,
        topology: renderer.gl.TRIANGLES, vertexSource: BEE_SWARM_VERTEX, fragmentSource: BEE_SWARM_FRAGMENT,
        vertexBufferLayout: { usage: 'DYNAMIC_DRAW', layout: [{ name: 'inGeom', size: 4 }, { name: 'inBee', size: 4 },
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
        program.setUniform('uPixel', frame.pixelSize);
        program.setUniform('uShadow', frame.shadowStrength);
        program.setUniform('uAlpha', image.alpha);
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
  return new BeeBatch();
}
