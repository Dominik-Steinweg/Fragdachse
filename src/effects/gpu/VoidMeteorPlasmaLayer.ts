import * as Phaser from 'phaser';
import { registerGraphicsObject } from '../EffectUtils';
import { VOID_METEOR_PLASMA_FRAGMENT, VOID_METEOR_PLASMA_VERTEX } from './VoidMeteorPlasmaShader';

const VERTICES = 6;
const QUAD = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);

interface PlasmaFrame {
  readonly geometry: Float32Array;
  readonly plasma: Float32Array;
  active: boolean;
}

/** One scene-owned airborne plasma pass. The fixed quad and uniform arrays are reused;
 * syncing a late join needs no particle replay, new geometry, or per-frame allocation. */
export class VoidMeteorPlasmaLayer {
  private readonly frame: PlasmaFrame = {
    geometry: new Float32Array(4), plasma: new Float32Array(4), active: false,
  };
  private image: Phaser.GameObjects.Image | null = null;
  private destroyed = false;

  constructor(scene: Phaser.Scene) {
    const renderer = scene.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
    if (!renderer?.gl) return;
    const image = scene.add.image(0, 0, '__WHITE').setDepth(20.66).setVisible(false);
    image.name = 'void-meteor-plasma';
    registerGraphicsObject(scene, 'bossIntro', image);
    const batch = createPlasmaBatch(renderer, this.frame);
    const manager = renderer.renderNodes;
    class PlasmaSubmitter extends Phaser.Renderer.WebGL.RenderNodes.RenderNode {
      constructor() { super('SubmitterVoidMeteorPlasma', manager); }
      run(context: Phaser.Renderer.WebGL.DrawingContext): void {
        manager.startStandAloneRender();
        this.onRunBegin(context);
        batch.run(context);
        this.onRunEnd(context);
      }
    }
    image.setRenderNodeRole('Submitter', new PlasmaSubmitter());
    image.once(Phaser.GameObjects.Events.DESTROY, () => batch.dispose());
    this.image = image;
  }

  /** Radius is the core/corona world radius; angle points forward, wake trails behind it.
   * Age is synchronized flight age in seconds. Compression [0,1] intensifies the leading bow. */
  sync(x: number, y: number, radius: number, angle: number, ageSeconds: number,
    seed: number, compression: number, alpha: number): void {
    if (this.destroyed) return;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius <= 0
      || !Number.isFinite(angle) || !Number.isFinite(ageSeconds) || ageSeconds < 0
      || !Number.isFinite(seed) || !Number.isFinite(compression) || !Number.isFinite(alpha) || alpha <= 0) {
      this.clear();
      return;
    }
    const geometry = this.frame.geometry, plasma = this.frame.plasma;
    geometry[0] = x; geometry[1] = y; geometry[2] = radius; geometry[3] = angle;
    plasma[0] = ageSeconds; plasma[1] = (seed >>> 0) % 997;
    plasma[2] = Math.max(0, Math.min(1, compression)); plasma[3] = Math.min(1, alpha);
    this.frame.active = true;
    this.image?.setVisible(true);
  }

  clear(): void {
    this.frame.active = false;
    this.image?.setVisible(false);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    this.image?.destroy();
    this.image = null;
  }
}

interface PlasmaBatchPort {
  run(context: Phaser.Renderer.WebGL.DrawingContext): void;
  dispose(): void;
}

// Lazy class definition keeps import and headless scene construction independent of WebGL.
function createPlasmaBatch(renderer: Phaser.Renderer.WebGL.WebGLRenderer, frame: PlasmaFrame): PlasmaBatchPort {
  class PlasmaBatch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    private readonly viewMatrix = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    private readonly textures: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper[] = [];
    private uploaded = false;
    private disposed = false;

    constructor() {
      super(renderer.renderNodes, {
        name: 'BatchHandlerVoidMeteorPlasma', shaderName: 'VOID_METEOR_PLASMA',
        instancesPerBatch: 1, verticesPerInstance: VERTICES, indicesPerInstance: VERTICES,
        topology: renderer.gl.TRIANGLES,
        vertexSource: VOID_METEOR_PLASMA_VERTEX, fragmentSource: VOID_METEOR_PLASMA_FRAGMENT,
        vertexBufferLayout: { usage: 'STATIC_DRAW', layout: [{ name: 'inCorner', size: 2 }] },
      });
    }

    _generateElementIndices(instances: number): ArrayBuffer {
      const indices = new Uint16Array(instances * VERTICES);
      for (let i = 0; i < indices.length; i++) indices[i] = i;
      return indices.buffer;
    }

    run(context: Phaser.Renderer.WebGL.DrawingContext): void {
      if (this.disposed || !frame.active) return;
      this.onRunBegin(context);
      const program = this.programManager;
      const suite = program.getCurrentProgramSuite() as {
        program: Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper;
        vao: Phaser.Renderer.WebGL.Wrappers.WebGLVAOWrapper;
      } | null;
      if (suite) {
        if (!this.uploaded) {
          this.vertexBufferLayout.buffer.viewF32!.set(QUAD);
          this.vertexBufferLayout.buffer.update();
          this.uploaded = true;
        }
        // Match regular sprite transforms inside camera framebuffers; avoid double viewport offset.
        const matrix = context.camera!.getViewMatrix(!context.useCanvas), view = this.viewMatrix;
        view[0] = matrix.a; view[1] = matrix.b; view[3] = matrix.c; view[4] = matrix.d;
        view[6] = matrix.tx; view[7] = matrix.ty;
        renderer.setProjectionMatrixFromDrawingContext(context);
        program.setUniform('uProjectionMatrix', renderer.projectionMatrix.val);
        program.setUniform('uViewMatrix', view);
        program.setUniform('uGeometry', frame.geometry);
        program.setUniform('uPlasma', frame.plasma);
        program.applyUniforms(suite.program);
        renderer.drawElements(context, this.textures, suite.program, suite.vao, VERTICES, 0, this.topology);
      }
      this.onRunEnd(context);
    }

    dispose(): void {
      if (this.disposed) return;
      this.disposed = true;
      (this.manager as unknown as Phaser.Events.EventEmitter).off(
        Phaser.Renderer.Events.SET_PARALLEL_TEXTURE_UNITS, this.updateTextureCount, this);
      renderer.off(Phaser.Renderer.Events.RESIZE, this.resize, this);
      const programs = this.programManager.programs as Record<string, {
        vao: Phaser.Renderer.WebGL.Wrappers.WebGLVAOWrapper;
      }>;
      for (const name in programs) {
        const suite = programs[name];
        Phaser.Utils.Array.Remove(renderer.glVAOWrappers, suite.vao);
        suite.vao.destroy();
      }
      // Programs belong to Phaser's shared shader factory; only our wrappers/buffers are disposed.
      this.programManager.programs = {};
      renderer.deleteBuffer(this.indexBuffer);
      renderer.deleteBuffer(this.vertexBufferLayout.buffer);
    }
  }
  return new PlasmaBatch();
}
