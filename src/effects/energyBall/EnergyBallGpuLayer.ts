import * as Phaser from 'phaser';
import type { ShaderWarmupProbe } from '../../graphics/ShaderWarmupProbe';
import { ENERGY_BALL_FRAGMENT_SHADER, ENERGY_BALL_VERTEX_SHADER } from './energyBallShader';
import {
  EnergyBallGpuStore,
  ENERGY_BALL_CAPACITY, ENERGY_BALL_FLOATS_PER_VERTEX, ENERGY_BALL_VERTICES,
} from './EnergyBallGpuStore';

export interface EnergyBallUniforms {
  /** Called once per render before upload, e.g. to retire finished impact bursts. */
  beforeRender(): void;
  /** Seconds; wraps at `wrap()`, the same clock the store's born times use. */
  time(): number;
  wrap(): number;
  emission(): number;
  detail(): number;
}

export interface EnergyBallGpuLayer {
  readonly image: Phaser.GameObjects.Image;
  /** True once the shader program is linked (or cannot be probed any further). */
  isReady(): boolean;
  /** Runs one degenerate quad so the program links; true once it did. */
  prepare(context: Phaser.Renderer.WebGL.DrawingContext): boolean;
}

/**
 * One display-list entry and one draw call for every energy ball and impact on screen. The
 * store owns the data; this node only uploads the live range and sets the per-frame uniforms.
 * WebGL-only, like SpriteGPULayer; returns null for headless or canvas renderers.
 */
export function createEnergyBallGpuLayer(scene: Phaser.Scene, store: EnergyBallGpuStore, depth: number,
  uniforms: EnergyBallUniforms): EnergyBallGpuLayer | null {
  const layer = buildLayer(scene, store, uniforms);
  layer?.image.setDepth(depth);
  return layer;
}

/**
 * Links the energy ball program during the loading barrier, so the first plasma shot of a
 * round does not stall on shader linking.
 */
export function createEnergyBallShaderProbe(scene: Phaser.Scene): ShaderWarmupProbe {
  let layer: EnergyBallGpuLayer | null = null;
  return {
    name: 'energy-ball',
    prepare: context => {
      layer ??= buildLayer(scene, new EnergyBallGpuStore(), {
        beforeRender: () => {}, time: () => 0, wrap: () => 1, emission: () => 0, detail: () => 1,
      });
      layer?.image.setVisible(false);
      return layer?.prepare(context) ?? true;
    },
    destroy: () => { layer?.image.destroy(); layer = null; },
  };
}

function buildLayer(scene: Phaser.Scene, store: EnergyBallGpuStore,
  uniforms: EnergyBallUniforms): EnergyBallGpuLayer | null {
  const renderer = scene.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
  if (!renderer?.gl) return null;
  const manager = renderer.renderNodes;
  const image = scene.add.image(0, 0, '__WHITE');
  image.name = 'energy-balls';
  image.setBlendMode(Phaser.BlendModes.ADD);
  let ready = false;

  class EnergyBallBatch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    private uploadedVersion = -1;
    constructor() {
      super(manager, {
        name: 'BatchHandlerEnergyBall', shaderName: 'ENERGY_BALL',
        instancesPerBatch: ENERGY_BALL_CAPACITY,
        verticesPerInstance: ENERGY_BALL_VERTICES, indicesPerInstance: ENERGY_BALL_VERTICES,
        topology: renderer!.gl.TRIANGLES,
        vertexSource: ENERGY_BALL_VERTEX_SHADER, fragmentSource: ENERGY_BALL_FRAGMENT_SHADER,
        vertexBufferLayout: { usage: 'DYNAMIC_DRAW', layout: [
          { name: 'inGeom', size: 4 }, { name: 'inShape', size: 4 }, { name: 'inMotion', size: 4 },
          { name: 'inGlow', size: 4 }, { name: 'inShell', size: 4 }, { name: 'inCore', size: 3 },
        ] },
      });
    }
    // Phaser calls this virtual hook in its constructor (omitted from Phaser's public d.ts).
    _generateElementIndices(instances: number): ArrayBuffer {
      const indices = new Uint16Array(instances * ENERGY_BALL_VERTICES);
      for (let i = 0; i < indices.length; i++) indices[i] = i;
      return indices.buffer;
    }
    run(context: Phaser.Renderer.WebGL.DrawingContext): void {
      // Until linked, one all-zero (degenerate) quad compiles the program while the arena loads.
      if (store.count === 0 && ready) return;
      this.onRunBegin(context);
      const program = this.programManager;
      // Phaser 4.2.1 documents the suite but types its return as plain Object.
      const suite = program.getCurrentProgramSuite() as {
        program: Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper;
        vao: Phaser.Renderer.WebGL.Wrappers.WebGLVAOWrapper;
      } | null;
      if (suite) {
        ready = true;
        if (this.uploadedVersion !== store.version && store.count > 0) {
          const data = store.data.subarray(0, store.count * ENERGY_BALL_VERTICES * ENERGY_BALL_FLOATS_PER_VERTEX);
          this.vertexBufferLayout.buffer.viewF32!.set(data, 0);
          this.vertexBufferLayout.buffer.update(data.byteLength, 0);
          this.uploadedVersion = store.version;
        }
        const m = context.camera!.getViewMatrix(!context.useCanvas);
        renderer!.setProjectionMatrixFromDrawingContext(context);
        program.setUniform('uProjectionMatrix', renderer!.projectionMatrix.val);
        program.setUniform('uViewMatrix', [m.a, m.b, 0, m.c, m.d, 0, m.tx, m.ty, 1]);
        program.setUniform('uTime', uniforms.time());
        program.setUniform('uWrap', uniforms.wrap());
        // World units per framebuffer pixel keeps every arc one pixel soft at any zoom.
        program.setUniform('uPixel', 1 / Math.max(1e-4, Math.hypot(m.a, m.b)));
        program.setUniform('uEmission', uniforms.emission());
        program.setUniform('uDetail', uniforms.detail());
        program.setUniform('uAlpha', image.alpha);
        program.applyUniforms(suite.program);
        renderer!.drawElements(context, [image.frame.source.glTexture!], suite.program, suite.vao,
          Math.max(1, store.count) * ENERGY_BALL_VERTICES, 0, this.topology);
      }
      this.onRunEnd(context);
    }
    dispose(): void {
      // RenderNodeManager mixes in EventEmitter; its d.ts omits that inheritance.
      (manager as unknown as Phaser.Events.EventEmitter).off(
        Phaser.Renderer.Events.SET_PARALLEL_TEXTURE_UNITS, this.updateTextureCount, this);
      for (const suite of Object.values(this.programManager.programs)) {
        Phaser.Utils.Array.Remove(renderer!.glVAOWrappers, suite.vao);
        suite.vao.destroy();
      }
      this.programManager.programs = {};
      renderer!.deleteBuffer(this.indexBuffer);
      renderer!.deleteBuffer(this.vertexBufferLayout.buffer);
    }
  }

  const batch = new EnergyBallBatch();
  class EnergyBallSubmitter extends Phaser.Renderer.WebGL.RenderNodes.RenderNode {
    constructor() { super('SubmitterEnergyBall', manager); }
    run(context: Phaser.Renderer.WebGL.DrawingContext): void {
      uniforms.beforeRender();
      if (store.count === 0 && ready) return;
      manager.startStandAloneRender(); this.onRunBegin(context);
      batch.run(context);
      this.onRunEnd(context);
    }
  }
  image.setRenderNodeRole('Submitter', new EnergyBallSubmitter());
  image.once(Phaser.GameObjects.Events.DESTROY, () => batch.dispose());
  return {
    image,
    isReady: () => ready,
    prepare(context) {
      manager.startStandAloneRender();
      batch.run(context);
      return ready;
    },
  };
}
