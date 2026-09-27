import * as Phaser from 'phaser';
import { DEPTH, DEPTH_LIGHTING } from '../../config';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { getEmissiveScale } from '../EmissiveScale';
import { EARTHBREAK_FISSURE_FRAGMENT_SHADER, EARTHBREAK_FISSURE_VERTEX_SHADER } from './earthbreakFissureShader';
import {
  FISSURE_CAPACITY, FISSURE_INSTANCE_FLOATS, FISSURE_VERTICES, type EarthbreakFissureStore,
} from './EarthbreakFissureStore';

export const FissurePass = { Ground: 0, Emissive: 1 } as const;
export type FissurePass = (typeof FissurePass)[keyof typeof FissurePass];

const DETAIL = { high: 1, medium: 1, low: 0 } as const;

/**
 * One display-list entry and one draw call per pass for every Earthbreak fissure on screen.
 * The store owns the data; this node uploads the committed dirty slot range (or everything
 * after a skipped version) and sets the per-frame uniforms. WebGL-only, like SpriteGPULayer;
 * returns null for headless or canvas renderers.
 */
export function createEarthbreakFissureGpuLayer(scene: Phaser.Scene, store: EarthbreakFissureStore, pass: FissurePass,
  depth: number, time: () => number, alpha: () => number = () => 1): Phaser.GameObjects.Image | null {
  const renderer = scene.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
  if (!renderer?.gl) return null;
  const manager = renderer.renderNodes;
  const image = scene.add.image(0, 0, '__WHITE');
  image.name = pass === FissurePass.Ground ? 'earthbreak-fissures' : 'earthbreak-fissure-glow';
  if (pass === FissurePass.Emissive) image.setBlendMode(Phaser.BlendModes.ADD);
  image.setDepth(depth);
  let ready = false;

  class FissureBatch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    private uploadedVersion = -1;
    constructor() {
      super(manager, {
        name: `BatchHandlerEarthbreakFissure${pass}`, shaderName: 'EARTHBREAK_FISSURE',
        instancesPerBatch: FISSURE_CAPACITY,
        verticesPerInstance: FISSURE_VERTICES, indicesPerInstance: FISSURE_VERTICES,
        topology: renderer!.gl.TRIANGLES,
        vertexSource: EARTHBREAK_FISSURE_VERTEX_SHADER, fragmentSource: EARTHBREAK_FISSURE_FRAGMENT_SHADER,
        vertexBufferLayout: { usage: 'DYNAMIC_DRAW', layout: [
          { name: 'inPosition', size: 2 }, { name: 'inLocal', size: 2 }, { name: 'inShape', size: 4 },
          { name: 'inJoin', size: 4 }, { name: 'inTime', size: 4 }, { name: 'inMisc', size: 4 },
          { name: 'inColor', size: 4 },
        ] },
      });
    }
    // Phaser calls this virtual hook in its constructor (omitted from Phaser's public d.ts).
    _generateElementIndices(instances: number): ArrayBuffer {
      const indices = new Uint16Array(instances * FISSURE_VERTICES);
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
          // A layer that skipped a version (hidden camera, first frame) needs the whole live range.
          const incremental = this.uploadedVersion >= 0 && this.uploadedVersion + 1 === store.version;
          const first = incremental ? Math.min(store.dirtyStart, store.count) : 0;
          const end = incremental ? Math.min(store.dirtyEnd, store.count) : store.count;
          if (end > first) {
            const offset = first * FISSURE_INSTANCE_FLOATS;
            const data = store.data.subarray(offset, end * FISSURE_INSTANCE_FLOATS);
            this.vertexBufferLayout.buffer.viewF32!.set(data, offset);
            this.vertexBufferLayout.buffer.update(data.byteLength, offset * Float32Array.BYTES_PER_ELEMENT);
          }
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
        program.setUniform('uDetail', DETAIL[getGraphicsQualityProfile(scene).level]);
        program.applyUniforms(suite.program);
        renderer!.drawElements(context, [image.frame.source.glTexture!], suite.program, suite.vao,
          Math.max(1, store.count) * FISSURE_VERTICES, 0, this.topology);
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

  const batch = new FissureBatch();
  class FissureSubmitter extends Phaser.Renderer.WebGL.RenderNodes.RenderNode {
    constructor() { super(`SubmitterEarthbreakFissure${pass}`, manager); }
    run(context: Phaser.Renderer.WebGL.DrawingContext): void {
      manager.startStandAloneRender(); this.onRunBegin(context);
      batch.run(context);
      this.onRunEnd(context);
    }
  }
  image.setRenderNodeRole('Submitter', new FissureSubmitter());
  image.once(Phaser.GameObjects.Events.DESTROY, () => batch.dispose());
  return image;
}

export interface EarthbreakFissureLayers { destroy(): void }

/**
 * Ground pass below actors and dust, and an emissive copy of the glow above the night lightmap.
 * `now` is the presentation clock the store's times are written in.
 */
export function createEarthbreakFissureLayers(scene: Phaser.Scene, store: EarthbreakFissureStore,
  now: () => number): EarthbreakFissureLayers {
  const time = (): number => store.time(now());
  const layers = [
    createEarthbreakFissureGpuLayer(scene, store, FissurePass.Ground, DEPTH.DECALS + 0.05, time),
    createEarthbreakFissureGpuLayer(scene, store, FissurePass.Emissive, DEPTH_LIGHTING + 0.07, time,
      nightGlowAlpha),
  ];
  return { destroy: () => { for (const layer of layers) layer?.destroy(); layers.length = 0; } };
}

/**
 * The ground pass already carries the glow by day. Above the lightmap the emissive copy only
 * restores what the night darkens: noon (emissive scale 0.55) adds nothing, full night all of it.
 */
function nightGlowAlpha(): number {
  return Math.max(0, Math.min(1, (getEmissiveScale() - 0.55) / 0.45)) * 0.9;
}
