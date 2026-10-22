import * as Phaser from 'phaser';
import { BAR_SDF_FRAGMENT, BAR_SDF_VERTEX } from './barSdfShader';
import {
  BAR_SDF_INDICES, BAR_SDF_INSTANCE_WORDS, BAR_SDF_VERTICES, barSdfPixelScale, writeBarSdfInstance,
  type BarSdfInstance, type BarSdfMatrix,
} from './barSdfInstance';

/**
 * Everything a bar object submits. `instances` live in the object's local units; for a world
 * layer the object sits at the origin and the instances carry world coordinates. `unitWidth` /
 * `unitHeight` map the Image's `width`/`height` back to local units, so a bar may be scaled by
 * itself or its parents (tweens, HUD scale) without rebuilding anything.
 */
export interface BarSdfSource {
  readonly instances: readonly BarSdfInstance[];
  /** Number of leading instances to draw; defaults to all. */
  count?: number;
  unitWidth: number;
  unitHeight: number;
  /** Field texture for living instances; plain bars ignore the bound texture. */
  texture?: () => Phaser.Textures.Texture | null;
}

const sources = new WeakMap<object, BarSdfSource>();
interface GpuNodes { batch: BarSdfBatch; submitter: Phaser.Renderer.WebGL.RenderNodes.RenderNode }
const nodes = new WeakMap<object, GpuNodes>();

interface BarSdfBatch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
  add(context: Phaser.Renderer.WebGL.DrawingContext, texture: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null,
    matrix: BarSdfMatrix, ox: number, oy: number, pxPerUnit: number, instance: BarSdfInstance): void;
}

function webglRenderer(scene: Phaser.Scene | undefined): Phaser.Renderer.WebGL.WebGLRenderer | null {
  const renderer = scene?.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
  return renderer?.gl && renderer.renderNodes ? renderer : null;
}

/**
 * Binds `image` to the shared bar program. Returns false without a WebGL renderer (tests,
 * headless consumers); the caller keeps its source and simply never draws.
 */
export function attachBarSdf(image: Phaser.GameObjects.Image, source: BarSdfSource): boolean {
  sources.set(image, source);
  const renderer = webglRenderer(image.scene);
  if (!renderer || typeof image.setRenderNodeRole !== 'function') return false;
  image.setRenderNodeRole('Submitter', gpuNodes(renderer).submitter);
  return true;
}

export function getBarSdfSource(image: object): BarSdfSource | undefined { return sources.get(image); }

/** Program warm-up for loading screens: links the shared bar program once per renderer. */
export function getBarSdfProgramManager(scene: Phaser.Scene): Phaser.Renderer.WebGL.ProgramManager | null {
  const renderer = webglRenderer(scene);
  return renderer ? gpuNodes(renderer).batch.programManager : null;
}

/** Renderer-lifetime nodes, like Phaser's own batch handlers. Kept lazy for headless imports. */
function gpuNodes(renderer: Phaser.Renderer.WebGL.WebGLRenderer): GpuNodes {
  let entry = nodes.get(renderer);
  if (entry) return entry;
  const batch = createBatch(renderer);
  const manager = renderer.renderNodes;
  const view = new Phaser.GameObjects.Components.TransformMatrix();
  const sprite = new Phaser.GameObjects.Components.TransformMatrix();
  const matrix: BarSdfMatrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  class BarSdfSubmitter extends Phaser.Renderer.WebGL.RenderNodes.RenderNode {
    constructor() { super('SubmitterBarSdf', manager); }
    run(context: Phaser.Renderer.WebGL.DrawingContext, gameObject: Phaser.GameObjects.Image,
      parentMatrix?: Phaser.GameObjects.Components.TransformMatrix): void {
      const source = sources.get(gameObject);
      const count = Math.min(source?.instances.length ?? 0, source?.count ?? Infinity);
      const camera = context.camera;
      if (!source || count <= 0 || !camera) return;
      this.onRunBegin(context);
      view.copyWithScrollFactorFrom(camera.getViewMatrix(!context.useCanvas), camera.scrollX, camera.scrollY,
        gameObject.scrollFactorX, gameObject.scrollFactorY);
      if (parentMatrix) view.multiply(parentMatrix);
      // Bars keep scale 1 and carry their size in `width`/`height` (Size component), so filters
      // focus a framebuffer of the real bar size instead of the 4×4 white frame.
      const sx = gameObject.scaleX * (gameObject.width || 1) / Math.max(1e-6, source.unitWidth);
      const sy = gameObject.scaleY * (gameObject.height || 1) / Math.max(1e-6, source.unitHeight);
      sprite.applyITRS(gameObject.x, gameObject.y, gameObject.rotation, sx, sy);
      view.multiply(sprite);
      const m = view.matrix;
      matrix.a = m[0]; matrix.b = m[1]; matrix.c = m[2]; matrix.d = m[3]; matrix.tx = m[4]; matrix.ty = m[5];
      const pxPerUnit = barSdfPixelScale(matrix);
      const fieldTexture = source.texture?.()?.source[0]?.glTexture ?? null;
      // Containers multiply their alpha into the corner alphas for the duration of the render.
      const alpha = (gameObject as unknown as { _alphaTL?: number })._alphaTL ?? gameObject.alpha;
      for (let i = 0; i < count; i++) {
        const instance = source.instances[i];
        if (alpha >= 0.999) { batch.add(context, fieldTexture, matrix, 0, 0, pxPerUnit, instance); continue; }
        const own = instance.alpha;
        instance.alpha = own * alpha;
        batch.add(context, fieldTexture, matrix, 0, 0, pxPerUnit, instance);
        instance.alpha = own;
      }
      this.onRunEnd(context);
    }
  }
  entry = { batch, submitter: new BarSdfSubmitter() };
  nodes.set(renderer, entry);
  return entry;
}

function createBatch(renderer: Phaser.Renderer.WebGL.WebGLRenderer): BarSdfBatch {
  const gl = renderer.gl;
  class Batch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler implements BarSdfBatch {
    private texture: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null = null;
    private readonly fieldSize = new Float32Array(2);
    constructor() {
      super(renderer.renderNodes, {
        name: 'BatchHandlerBarSdf', shaderName: 'BAR_SDF', instancesPerBatch: 2048,
        verticesPerInstance: BAR_SDF_VERTICES, indicesPerInstance: BAR_SDF_INDICES, topology: gl.TRIANGLES,
        vertexSource: BAR_SDF_VERTEX, fragmentSource: BAR_SDF_FRAGMENT,
        vertexBufferLayout: { usage: 'DYNAMIC_DRAW', layout: [
          { name: 'inPosition', size: 2 }, { name: 'inLocal', size: 2 }, { name: 'inSize', size: 4 },
          { name: 'inA', size: 4 }, { name: 'inB', size: 4 }, { name: 'inMeta', size: 2 },
          ...[0, 1, 2, 3].map(i => ({ name: `inColor${i}`, size: 4, type: 'UNSIGNED_BYTE', normalized: true })),
        ] },
      } as Phaser.Types.Renderer.WebGL.RenderNodes.BatchHandlerConfig);
    }
    _generateElementIndices(instances: number): ArrayBuffer {
      const indices = new Uint16Array(instances * BAR_SDF_INDICES);
      for (let i = 0, v = 0, o = 0; i < instances; i++, v += 4) {
        indices[o++] = v; indices[o++] = v + 1; indices[o++] = v + 2;
        indices[o++] = v + 2; indices[o++] = v + 1; indices[o++] = v + 3;
      }
      return indices.buffer;
    }
    add(context: Phaser.Renderer.WebGL.DrawingContext, texture: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null,
      matrix: BarSdfMatrix, ox: number, oy: number, pxPerUnit: number, instance: BarSdfInstance): void {
      if (this.instanceCount === 0) this.manager.setCurrentBatchNode(this, context);
      // Plain bars never sample; only a living window needs the field bound for its batch.
      if (texture && texture !== this.texture) {
        if (this.instanceCount > 0) this.run(context);
        this.texture = texture;
      }
      const buffer = this.vertexBufferLayout.buffer;
      writeBarSdfInstance(buffer.viewF32!, buffer.viewU32!, this.instanceCount * BAR_SDF_INSTANCE_WORDS,
        matrix, ox, oy, pxPerUnit, instance);
      this.instanceCount++;
      if (this.instanceCount >= this.instancesPerBatch) this.run(context);
    }
    run(context: Phaser.Renderer.WebGL.DrawingContext): void {
      if (this.instanceCount === 0) return;
      this.onRunBegin(context);
      const programManager = this.programManager;
      const suite = programManager.getCurrentProgramSuite() as { program: Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper;
        vao: Phaser.Renderer.WebGL.Wrappers.WebGLVAOWrapper } | null;
      if (suite) {
        const texture = this.texture ?? renderer.whiteTexture;
        renderer.setProjectionMatrixFromDrawingContext(context);
        programManager.setUniform('uProjectionMatrix', renderer.projectionMatrix.val);
        programManager.setUniform('uField', 0);
        this.fieldSize[0] = Math.max(1, texture.width); this.fieldSize[1] = Math.max(1, texture.height);
        programManager.setUniform('uFieldSize', this.fieldSize);
        programManager.applyUniforms(suite.program);
        this.vertexBufferLayout.buffer.update(this.instanceCount * this.bytesPerInstance);
        renderer.drawElements(context, [texture], suite.program, suite.vao,
          this.instanceCount * BAR_SDF_INDICES, 0, this.topology);
      }
      this.instanceCount = 0;
      this.onRunEnd(context);
    }
  }
  return new Batch();
}
