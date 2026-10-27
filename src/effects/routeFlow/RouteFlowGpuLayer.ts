import * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { getEmissiveScale } from '../EmissiveScale';
import { ROUTE_FLOW_FRAGMENT_SHADER, ROUTE_FLOW_VERTEX_SHADER } from './routeFlowShader';
import { ROUTE_FLOW_CAPACITY, ROUTE_FLOW_INSTANCE_FLOATS, ROUTE_FLOW_VERTICES, type RouteFlowStore } from './RouteFlowStore';

export const RouteFlowPass = { Ground: 0, Bed: 1, Emissive: 2 } as const;
export type RouteFlowPass = (typeof RouteFlowPass)[keyof typeof RouteFlowPass];

const DETAIL = { high: 1, medium: 1, low: 0 } as const;

/**
 * One display-list entry and one draw call per pass for every route on screen. The store owns the
 * data; this node uploads it after a new plan and sets the per-frame uniforms. WebGL-only, like
 * SpriteGPULayer; returns null for headless or canvas renderers.
 */
export function createRouteFlowGpuLayer(scene: Phaser.Scene, store: RouteFlowStore, pass: RouteFlowPass,
  depth: number, time: () => number, options: { readonly unit?: number; readonly glow?: () => number } = {}): Phaser.GameObjects.Image | null {
  const renderer = scene.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
  if (!renderer?.gl) return null;
  const manager = renderer.renderNodes;
  const image = scene.add.image(0, 0, '__WHITE');
  image.name = pass === RouteFlowPass.Ground ? 'route-flow-stain' : pass === RouteFlowPass.Bed ? 'route-flow-bed' : 'route-flow-glow';
  if (pass === RouteFlowPass.Emissive) image.setBlendMode(Phaser.BlendModes.ADD);
  image.setDepth(depth);
  const unit = options.unit ?? 1;
  const glow = options.glow ?? (() => 1);
  let ready = false;

  class RouteFlowBatch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    private uploadedVersion = -1;
    constructor() {
      super(manager, {
        name: `BatchHandlerRouteFlow${pass}`, shaderName: 'ROUTE_FLOW',
        instancesPerBatch: ROUTE_FLOW_CAPACITY,
        verticesPerInstance: ROUTE_FLOW_VERTICES, indicesPerInstance: ROUTE_FLOW_VERTICES,
        topology: renderer!.gl.TRIANGLES,
        vertexSource: ROUTE_FLOW_VERTEX_SHADER, fragmentSource: ROUTE_FLOW_FRAGMENT_SHADER,
        vertexBufferLayout: { usage: 'DYNAMIC_DRAW', layout: [
          { name: 'inPosition', size: 2 }, { name: 'inLocal', size: 2 }, { name: 'inShape', size: 4 },
          { name: 'inJoin', size: 4 }, { name: 'inFlow', size: 4 }, { name: 'inMisc', size: 4 },
        ] },
      });
    }
    // Phaser calls this virtual hook in its constructor (omitted from Phaser's public d.ts).
    _generateElementIndices(instances: number): ArrayBuffer {
      const indices = new Uint16Array(instances * ROUTE_FLOW_VERTICES);
      for (let i = 0; i < indices.length; i++) indices[i] = i;
      return indices.buffer;
    }
    run(context: Phaser.Renderer.WebGL.DrawingContext): void {
      // Until linked, one all-zero (degenerate) quad compiles the program before the first plan.
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
          const data = store.data.subarray(0, store.count * ROUTE_FLOW_INSTANCE_FLOATS);
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
        // Layer units per framebuffer pixel keeps every edge one pixel soft at any zoom.
        program.setUniform('uPixel', 1 / Math.max(1e-4, Math.hypot(m.a, m.b)));
        program.setUniform('uAlpha', image.alpha);
        program.setUniform('uDetail', DETAIL[getGraphicsQualityProfile(scene).level]);
        program.setUniform('uUnit', unit);
        program.setUniform('uGlow', glow());
        program.applyUniforms(suite.program);
        renderer!.drawElements(context, [image.frame.source.glTexture!], suite.program, suite.vao,
          Math.max(1, store.count) * ROUTE_FLOW_VERTICES, 0, this.topology);
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

  const batch = new RouteFlowBatch();
  class RouteFlowSubmitter extends Phaser.Renderer.WebGL.RenderNodes.RenderNode {
    constructor() { super(`SubmitterRouteFlow${pass}`, manager); }
    run(context: Phaser.Renderer.WebGL.DrawingContext): void {
      manager.startStandAloneRender(); this.onRunBegin(context);
      batch.run(context);
      this.onRunEnd(context);
    }
  }
  image.setRenderNodeRole('Submitter', new RouteFlowSubmitter());
  image.once(Phaser.GameObjects.Events.DESTROY, () => batch.dispose());
  return image;
}

export interface RouteFlowLayers { destroy(): void }

/**
 * Ink in the decal band, the stream bed above water and below rocks, and the current's light
 * above the canopies, where trees would otherwise hide a route.
 */
export function createRouteFlowLayers(scene: Phaser.Scene, store: RouteFlowStore, time: () => number): RouteFlowLayers {
  const layers = [
    createRouteFlowGpuLayer(scene, store, RouteFlowPass.Ground, DEPTH.DECALS + 0.06, time),
    createRouteFlowGpuLayer(scene, store, RouteFlowPass.Bed, DEPTH.GROUND_FOG + 0.05, time),
    createRouteFlowGpuLayer(scene, store, RouteFlowPass.Emissive, DEPTH.CANOPY + 0.3, time, { glow: canopyGlow }),
  ];
  return { destroy: () => { for (const layer of layers) layer?.destroy(); layers.length = 0; } };
}

/**
 * The current's light on the minimap, in the panel's space. Only the light is drawn there: on the
 * dark overview the glowing current is the whole route.
 */
export function createRouteFlowMinimapLayer(scene: Phaser.Scene, store: RouteFlowStore, time: () => number,
  unit: number): Phaser.GameObjects.Image | null {
  return createRouteFlowGpuLayer(scene, store, RouteFlowPass.Emissive, 0, time, { unit, glow: () => 1.4 });
}

/** By day the bed carries the stream and the light above the canopies stays subtle; at night it is the stream. */
function canopyGlow(): number {
  return 0.5 + 0.5 * Math.max(0, Math.min(1, (getEmissiveScale() - 0.55) / 0.45));
}
