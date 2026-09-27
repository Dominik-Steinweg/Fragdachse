import * as Phaser from 'phaser';
import { ENEMY_CLAW_FRAGMENT_SHADER, ENEMY_CLAW_VERTEX_SHADER } from './enemyClawShader';
import {
  CLAW_VFX_CAPACITY, CLAW_VFX_FLOATS_PER_VERTEX, CLAW_VFX_VERTICES, type EnemyClawVfxStore,
} from './EnemyClawVfxStore';

export const ClawVfxPass = { Ground: 0, Top: 1, Night: 2 } as const;
export type ClawVfxPass = (typeof ClawVfxPass)[keyof typeof ClawVfxPass];

export interface EnemyClawGpuLayer {
  readonly image: Phaser.GameObjects.Image;
  /** True once the pass's shader program is linked (or cannot be probed any further). */
  isReady(): boolean;
}

/**
 * One display-list entry and one draw call per pass for every claw on screen. The store owns
 * the data; this node only uploads the dirty live range and sets the per-frame uniforms.
 * WebGL-only, like SpriteGPULayer; returns null for headless or canvas renderers.
 */
export function createEnemyClawGpuLayer(scene: Phaser.Scene, store: EnemyClawVfxStore, pass: ClawVfxPass,
  depth: number, time: () => number, alpha: () => number = () => 1): EnemyClawGpuLayer | null {
  const renderer = scene.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
  if (!renderer?.gl) return null;
  const manager = renderer.renderNodes;
  const image = scene.add.image(0, 0, '__WHITE');
  image.name = ['enemy-claw-telegraphs', 'enemy-claw-strikes', 'enemy-claw-night'][pass];
  if (pass === ClawVfxPass.Night) image.setBlendMode(Phaser.BlendModes.ADD);
  image.setDepth(depth);
  let ready = false;

  class ClawBatch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    private uploadedVersion = -1;
    constructor() {
      super(manager, {
        name: `BatchHandlerEnemyClaw${pass}`, shaderName: 'ENEMY_CLAW',
        instancesPerBatch: CLAW_VFX_CAPACITY,
        verticesPerInstance: CLAW_VFX_VERTICES, indicesPerInstance: CLAW_VFX_VERTICES,
        topology: renderer!.gl.TRIANGLES,
        vertexSource: ENEMY_CLAW_VERTEX_SHADER, fragmentSource: ENEMY_CLAW_FRAGMENT_SHADER,
        vertexBufferLayout: { usage: 'DYNAMIC_DRAW', layout: [
          { name: 'inPosition', size: 2 }, { name: 'inLocal', size: 2 }, { name: 'inTiming', size: 4 },
          { name: 'inShape', size: 4 }, { name: 'inColor', size: 4 },
        ] },
      });
    }
    // Phaser calls this virtual hook in its constructor (omitted from Phaser's public d.ts).
    _generateElementIndices(instances: number): ArrayBuffer {
      const indices = new Uint16Array(instances * CLAW_VFX_VERTICES);
      for (let i = 0; i < indices.length; i++) indices[i] = i;
      return indices.buffer;
    }
    run(context: Phaser.Renderer.WebGL.DrawingContext): void {
      // Until linked, one all-zero (degenerate) quad compiles the program outside combat.
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
          const data = store.data.subarray(0, store.count * CLAW_VFX_VERTICES * CLAW_VFX_FLOATS_PER_VERTEX);
          this.vertexBufferLayout.buffer.viewF32!.set(data, 0);
          this.vertexBufferLayout.buffer.update(data.byteLength, 0);
          this.uploadedVersion = store.version;
        }
        const m = context.camera!.getViewMatrix(!context.useCanvas);
        renderer!.setProjectionMatrixFromDrawingContext(context);
        program.setUniform('uProjectionMatrix', renderer!.projectionMatrix.val);
        program.setUniform('uViewMatrix', [m.a, m.b, 0, m.c, m.d, 0, m.tx, m.ty, 1]);
        program.setUniform('uTime', time());
        program.setUniform('uPass', pass);
        // World units per framebuffer pixel keeps every edge one pixel soft at any zoom.
        program.setUniform('uPixel', 1 / Math.max(1e-4, Math.hypot(m.a, m.b)));
        program.setUniform('uAlpha', image.alpha * alpha());
        program.applyUniforms(suite.program);
        renderer!.drawElements(context, [image.frame.source.glTexture!], suite.program, suite.vao,
          Math.max(1, store.count) * CLAW_VFX_VERTICES, 0, this.topology);
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

  const batch = new ClawBatch();
  class ClawSubmitter extends Phaser.Renderer.WebGL.RenderNodes.RenderNode {
    constructor() { super(`SubmitterEnemyClaw${pass}`, manager); }
    run(context: Phaser.Renderer.WebGL.DrawingContext): void {
      manager.startStandAloneRender(); this.onRunBegin(context);
      batch.run(context);
      this.onRunEnd(context);
    }
  }
  image.setRenderNodeRole('Submitter', new ClawSubmitter());
  image.once(Phaser.GameObjects.Events.DESTROY, () => batch.dispose());
  return { image, isReady: () => ready };
}
