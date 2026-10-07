import * as Phaser from 'phaser';
import type { ShaderWarmupProbe } from '../../graphics/ShaderWarmupProbe';
import { TESLA_STORM_FRAGMENT_SHADER, TESLA_STORM_VERTEX_SHADER } from './teslaStormBoltShader';
import {
  TeslaStormBoltStore,
  TESLA_STORM_CAPACITY, TESLA_STORM_FLOATS_PER_VERTEX, TESLA_STORM_VERTICES,
} from './TeslaStormBoltStore';

export interface TeslaStormBoltUniforms {
  /** Seconds; wraps far apart, shapes only jump once per wrap. */
  time(): number;
  emission(): number;
  detail(): number;
}

export interface TeslaStormBoltGpuLayer {
  readonly image: Phaser.GameObjects.Image;
  /** True once the shader program is linked (or cannot be probed any further). */
  isReady(): boolean;
  /** Runs one degenerate quad so the program links; true once it did. */
  prepare(context: Phaser.Renderer.WebGL.DrawingContext): boolean;
}

/**
 * One display-list entry and one draw call for every Tesla storm discharge on screen. The store
 * owns the data; this node only uploads the live range and sets the per-frame uniforms.
 * WebGL-only, like SpriteGPULayer; returns null for headless or canvas renderers.
 */
export function createTeslaStormBoltGpuLayer(scene: Phaser.Scene, store: TeslaStormBoltStore, depth: number,
  uniforms: TeslaStormBoltUniforms): TeslaStormBoltGpuLayer | null {
  const layer = buildLayer(scene, store, uniforms);
  layer?.image.setDepth(depth);
  return layer;
}

/**
 * Links the shared storm program during the loading barrier. The arena's own layer is rebuilt
 * with every World, so without this the first storm pulse of a round would stall on linking.
 */
export function createTeslaStormShaderProbe(scene: Phaser.Scene): ShaderWarmupProbe {
  let layer: TeslaStormBoltGpuLayer | null = null;
  return {
    name: 'tesla-storm',
    prepare: context => {
      layer ??= buildLayer(scene, new TeslaStormBoltStore(), { time: () => 0, emission: () => 0, detail: () => 1 });
      layer?.image.setVisible(false);
      return layer?.prepare(context) ?? true;
    },
    destroy: () => { layer?.image.destroy(); layer = null; },
  };
}

function buildLayer(scene: Phaser.Scene, store: TeslaStormBoltStore,
  uniforms: TeslaStormBoltUniforms): TeslaStormBoltGpuLayer | null {
  const renderer = scene.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
  if (!renderer?.gl) return null;
  const manager = renderer.renderNodes;
  const image = scene.add.image(0, 0, '__WHITE');
  image.name = 'tesla-storm-discharges';
  image.setBlendMode(Phaser.BlendModes.ADD);
  let ready = false;

  class StormBatch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    private uploadedVersion = -1;
    constructor() {
      super(manager, {
        name: 'BatchHandlerTeslaStorm', shaderName: 'TESLA_STORM',
        instancesPerBatch: TESLA_STORM_CAPACITY,
        verticesPerInstance: TESLA_STORM_VERTICES, indicesPerInstance: TESLA_STORM_VERTICES,
        topology: renderer!.gl.TRIANGLES,
        vertexSource: TESLA_STORM_VERTEX_SHADER, fragmentSource: TESLA_STORM_FRAGMENT_SHADER,
        vertexBufferLayout: { usage: 'DYNAMIC_DRAW', layout: [
          { name: 'inPosition', size: 2 }, { name: 'inLocal', size: 2 }, { name: 'inShape', size: 4 },
          { name: 'inColor', size: 4 },
        ] },
      });
    }
    // Phaser calls this virtual hook in its constructor (omitted from Phaser's public d.ts).
    _generateElementIndices(instances: number): ArrayBuffer {
      const indices = new Uint16Array(instances * TESLA_STORM_VERTICES);
      for (let i = 0; i < indices.length; i++) indices[i] = i;
      return indices.buffer;
    }
    run(context: Phaser.Renderer.WebGL.DrawingContext): void {
      // Until linked, one all-zero (degenerate) quad compiles the program while the arena
      // loads, so the first storm pulse does not stall on shader linking.
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
          const data = store.data.subarray(0, store.count * TESLA_STORM_VERTICES * TESLA_STORM_FLOATS_PER_VERTEX);
          this.vertexBufferLayout.buffer.viewF32!.set(data, 0);
          this.vertexBufferLayout.buffer.update(data.byteLength, 0);
          this.uploadedVersion = store.version;
        }
        const m = context.camera!.getViewMatrix(!context.useCanvas);
        renderer!.setProjectionMatrixFromDrawingContext(context);
        program.setUniform('uProjectionMatrix', renderer!.projectionMatrix.val);
        program.setUniform('uViewMatrix', [m.a, m.b, 0, m.c, m.d, 0, m.tx, m.ty, 1]);
        program.setUniform('uTime', uniforms.time());
        // World units per framebuffer pixel keeps every filament one pixel soft at any zoom.
        program.setUniform('uPixel', 1 / Math.max(1e-4, Math.hypot(m.a, m.b)));
        program.setUniform('uEmission', uniforms.emission());
        program.setUniform('uDetail', uniforms.detail());
        program.setUniform('uAlpha', image.alpha);
        program.applyUniforms(suite.program);
        renderer!.drawElements(context, [image.frame.source.glTexture!], suite.program, suite.vao,
          Math.max(1, store.count) * TESLA_STORM_VERTICES, 0, this.topology);
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

  const batch = new StormBatch();
  class StormSubmitter extends Phaser.Renderer.WebGL.RenderNodes.RenderNode {
    constructor() { super('SubmitterTeslaStorm', manager); }
    run(context: Phaser.Renderer.WebGL.DrawingContext): void {
      if (store.count === 0 && ready) return;
      manager.startStandAloneRender(); this.onRunBegin(context);
      batch.run(context);
      this.onRunEnd(context);
    }
  }
  image.setRenderNodeRole('Submitter', new StormSubmitter());
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
