import * as Phaser from 'phaser';
import { DEPTH_LIGHTING } from '../../config';
import { emissiveAlpha } from '../EmissiveScale';
import { registerGraphicsObject } from '../EffectUtils';
import { GRAVE_WISP_FRAGMENT, GRAVE_WISP_VERTEX } from './GraveWispShader';

/** Grave lights, flying plasma lights and their puffs of every titan share one bounded draw. */
export const GRAVE_WISP_CAPACITY = 160;
/** Self-lit like the boss's fireflies: above the lightmap. */
export const GRAVE_WISP_DEPTH = DEPTH_LIGHTING + 0.1;
const WORDS = 14, VERTICES = 6;
const CORNERS = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];
/** Grave lights stay readable by day; the night lifts them to full strength. */
const DAY_FLOOR = 0.7;

export const GraveWispKind = { Light: 0, Puff: 1 } as const;

/** Segment tail -> head; a light without travel has tail = head. */
export interface GraveWispItem {
  tailX: number; tailY: number; headX: number; headY: number;
  halfWidth: number; kind: number; t: number; seed: number; size: number; intensity: number;
}

/** Immediate mode: the owner rebuilds every item each frame with begin/add/flush. */
export class GraveWispGpuLayer {
  private readonly data = new Float32Array(GRAVE_WISP_CAPACITY * VERTICES * WORDS);
  private count = 0;
  private version = 0;
  private timeSeconds = 0;
  private readonly image: Phaser.GameObjects.Image | null = null;
  private readonly batch: { dispose(): void } | null = null;

  constructor(scene: Phaser.Scene) {
    const renderer = scene.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
    if (!renderer?.gl) return;
    const image = scene.add.image(0, 0, '__WHITE').setDepth(GRAVE_WISP_DEPTH).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
    image.name = 'grave-wisps';
    registerGraphicsObject(scene, 'bossIntro', image);
    const batch = createGraveWispBatch(renderer, image, this);
    const manager = renderer.renderNodes;
    class Submitter extends Phaser.Renderer.WebGL.RenderNodes.RenderNode {
      constructor() { super('SubmitterGraveWisp', manager); }
      run(context: Phaser.Renderer.WebGL.DrawingContext): void {
        manager.startStandAloneRender(); this.onRunBegin(context); batch.run(context); this.onRunEnd(context);
      }
    }
    image.setRenderNodeRole('Submitter', new Submitter());
    image.once(Phaser.GameObjects.Events.DESTROY, () => batch.dispose());
    this.image = image;
    this.batch = batch;
  }

  begin(timeMs: number): void { this.count = 0; this.timeSeconds = (timeMs / 1000) % 1000; }

  add(item: GraveWispItem): boolean {
    if (this.count >= GRAVE_WISP_CAPACITY) return false;
    let offset = this.count++ * VERTICES * WORDS;
    for (let i = 0; i < VERTICES; i++) {
      this.data[offset++] = item.tailX; this.data[offset++] = item.tailY; this.data[offset++] = item.headX; this.data[offset++] = item.headY;
      this.data[offset++] = CORNERS[i * 2]; this.data[offset++] = CORNERS[i * 2 + 1];
      this.data[offset++] = item.halfWidth; this.data[offset++] = item.kind; this.data[offset++] = item.t; this.data[offset++] = item.seed;
      this.data[offset++] = item.size; this.data[offset++] = item.intensity; this.data[offset++] = 0; this.data[offset++] = 0;
    }
    return true;
  }

  flush(): void {
    this.version++;
    this.image?.setVisible(this.count > 0);
  }

  clear(): void { this.begin(0); this.flush(); }

  destroy(): void { this.image?.destroy(); }

  get size(): number { return this.count; }

  get frame() {
    return { data: this.data, count: this.count, version: this.version, time: this.timeSeconds,
      emissive: Math.max(DAY_FLOOR, emissiveAlpha(1)) };
  }
}

// Lazy like RestHealGpuLayer: importing presentation must also work in headless runtime tests.
function createGraveWispBatch(renderer: Phaser.Renderer.WebGL.WebGLRenderer, image: Phaser.GameObjects.Image,
  owner: GraveWispGpuLayer): { run(context: Phaser.Renderer.WebGL.DrawingContext): void; dispose(): void } {
  class GraveWispBatch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    private uploadedVersion = -1;
    private disposed = false;
    constructor() {
      super(renderer.renderNodes, { name: 'BatchHandlerGraveWisp', shaderName: 'GRAVE_WISP',
        instancesPerBatch: GRAVE_WISP_CAPACITY, verticesPerInstance: VERTICES, indicesPerInstance: VERTICES,
        topology: renderer.gl.TRIANGLES, vertexSource: GRAVE_WISP_VERTEX, fragmentSource: GRAVE_WISP_FRAGMENT,
        vertexBufferLayout: { usage: 'DYNAMIC_DRAW', layout: [{ name: 'inSeg', size: 4 }, { name: 'inCorner', size: 2 },
          { name: 'inShape', size: 4 }, { name: 'inAux', size: 4 }] },
      });
    }
    // Phaser calls this virtual hook in its constructor (omitted from Phaser's public d.ts).
    _generateElementIndices(instances: number): ArrayBuffer {
      const indices = new Uint16Array(instances * VERTICES); for (let i = 0; i < indices.length; i++) indices[i] = i; return indices.buffer;
    }
    run(context: Phaser.Renderer.WebGL.DrawingContext): void {
      const frame = owner.frame;
      if (!frame.count) return;
      this.onRunBegin(context);
      const program = this.programManager;
      const suite = program.getCurrentProgramSuite() as { program: Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper;
        vao: Phaser.Renderer.WebGL.Wrappers.WebGLVAOWrapper } | null;
      if (suite) {
        if (this.uploadedVersion !== frame.version) {
          const data = frame.data.subarray(0, frame.count * VERTICES * WORDS);
          this.vertexBufferLayout.buffer.viewF32!.set(data);
          this.vertexBufferLayout.buffer.update(data.byteLength, 0); this.uploadedVersion = frame.version;
        }
        // Inside a camera framebuffer the viewport offset is applied at composite time.
        const m = context.camera!.getViewMatrix(!context.useCanvas);
        renderer.setProjectionMatrixFromDrawingContext(context);
        program.setUniform('uProjectionMatrix', renderer.projectionMatrix.val);
        program.setUniform('uViewMatrix', [m.a, m.b, 0, m.c, m.d, 0, m.tx, m.ty, 1]);
        program.setUniform('uTime', frame.time); program.setUniform('uAlpha', image.alpha);
        program.setUniform('uEmissive', frame.emissive);
        program.applyUniforms(suite.program);
        renderer.drawElements(context, [], suite.program, suite.vao, frame.count * VERTICES, 0, this.topology);
      }
      this.onRunEnd(context);
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
  return new GraveWispBatch();
}
