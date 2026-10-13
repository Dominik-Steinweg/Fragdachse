import * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import type { ShaderWarmupProbe } from '../../graphics/ShaderWarmupProbe';
import { FIRE_CONTROL_FRAGMENT, FIRE_CONTROL_VERTEX } from './fireControlPortalShader';
import { ensureFireControlRelayAssets, FIRE_CONTROL_RELAY } from './FireControlRelayAssets';
import {
  FireControlPortalGpuStore,
  FIRE_CONTROL_CAPACITY, FIRE_CONTROL_WORDS, FIRE_CONTROL_VERTICES,
} from './FireControlPortalGpuStore';

export interface FireControlPortalGpuLayer {
  readonly image: Phaser.GameObjects.Image;
  /** True once the shader program is linked (or cannot be probed any further). */
  isReady(): boolean;
  destroy(): void;
  /** Runs one degenerate quad so the program links; true once it did. */
  prepare(context: Phaser.Renderer.WebGL.DrawingContext): boolean;
}

/**
 * One display-list entry and one draw call for every fire-control and impact on screen. The
 * store owns the data; this node only uploads the live range and sets the per-frame uniforms.
 * WebGL-only, like SpriteGPULayer; returns null for headless or canvas renderers.
 */
export function createFireControlPortalGpuLayer(scene: Phaser.Scene, store: FireControlPortalGpuStore): FireControlPortalGpuLayer | null {
  const layer = buildLayer(scene, store);
  layer?.image.setDepth(DEPTH.ROCKS + 0.3).setBlendMode(Phaser.BlendModes.ADD);
  return layer;
}

/**
 * Links the fire-control program during the loading barrier, so the first portal of a
 * round does not stall on shader linking.
 */
export function createFireControlPortalShaderProbe(scene: Phaser.Scene): ShaderWarmupProbe {
  ensureFireControlRelayAssets(scene);
  let layer: FireControlPortalGpuLayer | null = null;
  return {
    name: 'fire-control',
    prepare: context => {
      layer ??= buildLayer(scene, new FireControlPortalGpuStore());
      layer?.image.setVisible(false);
      const shaderReady = layer?.prepare(context) ?? true;
      return shaderReady && scene.textures.exists(FIRE_CONTROL_RELAY.sheetTextureKey);
    },
    destroy: () => { layer?.image.destroy(); layer = null; },
  };
}

function buildLayer(scene: Phaser.Scene, store: FireControlPortalGpuStore): FireControlPortalGpuLayer | null {
  const renderer = scene.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
  if (!renderer?.gl) return null;
  const manager = renderer.renderNodes;
  const image = scene.add.image(0, 0, '__WHITE');
  image.name = 'fire-control-portals';
  let ready = false;

  class FireControlPortalBatch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    private uploadedVersion = -1;
    constructor() {
      super(manager, {
        name: 'BatchHandlerFireControlPortal', shaderName: 'FIRE_CONTROL',
        instancesPerBatch: FIRE_CONTROL_CAPACITY,
        verticesPerInstance: FIRE_CONTROL_VERTICES, indicesPerInstance: FIRE_CONTROL_VERTICES,
        topology: renderer!.gl.TRIANGLES,
        vertexSource: FIRE_CONTROL_VERTEX, fragmentSource: FIRE_CONTROL_FRAGMENT,
        vertexBufferLayout: { usage: 'DYNAMIC_DRAW', layout: [
          { name: 'inGeom', size: 4 }, { name: 'inShape', size: 4 }, { name: 'inState', size: 4 },
        ] },
      });
    }
    // Phaser calls this virtual hook in its constructor (omitted from Phaser's public d.ts).
    _generateElementIndices(instances: number): ArrayBuffer {
      const indices = new Uint16Array(instances * FIRE_CONTROL_VERTICES);
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
          const data = store.data.subarray(0, store.count * FIRE_CONTROL_VERTICES * FIRE_CONTROL_WORDS);
          this.vertexBufferLayout.buffer.viewF32!.set(data, 0);
          this.vertexBufferLayout.buffer.update(data.byteLength, 0);
          this.uploadedVersion = store.version;
        }
        const m = context.camera!.getViewMatrix(!context.useCanvas);
        renderer!.setProjectionMatrixFromDrawingContext(context);
        program.setUniform('uProjectionMatrix', renderer!.projectionMatrix.val);
        program.setUniform('uViewMatrix', [m.a, m.b, 0, m.c, m.d, 0, m.tx, m.ty, 1]);
        program.setUniform('uTime', store.time);
        // World units per framebuffer pixel keeps every arc one pixel soft at any zoom.
        program.setUniform('uPixel', 1 / Math.max(1e-4, Math.hypot(m.a, m.b)));
        program.setUniform('uAlpha', image.alpha);
        program.applyUniforms(suite.program);
        renderer!.drawElements(context, [image.frame.source.glTexture!], suite.program, suite.vao,
          Math.max(1, store.count) * FIRE_CONTROL_VERTICES, 0, this.topology);
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

  const batch = new FireControlPortalBatch();
  class FireControlPortalSubmitter extends Phaser.Renderer.WebGL.RenderNodes.RenderNode {
    constructor() { super('SubmitterFireControlPortal', manager); }
    run(context: Phaser.Renderer.WebGL.DrawingContext): void {
      if (store.count === 0 && ready) return;
      manager.startStandAloneRender(); this.onRunBegin(context);
      batch.run(context);
      this.onRunEnd(context);
    }
  }
  image.setRenderNodeRole('Submitter', new FireControlPortalSubmitter());
  image.once(Phaser.GameObjects.Events.DESTROY, () => batch.dispose());
  return {
    image,
    isReady: () => ready,
    destroy: () => image.destroy(),
    prepare(context) {
      manager.startStandAloneRender();
      batch.run(context);
      return ready;
    },
  };
}
