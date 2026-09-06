import * as Phaser from 'phaser';
import { GPU_VFX_ATLAS_KEY, GpuVfxFrameId, getGpuVfxFrame } from './GpuVfxAtlas';
import { FLIGHT_RIBBON_PAGE_SIZE, FLIGHT_RIBBON_SLOT_WORDS, FLIGHT_RIBBON_VERTICES, type GpuFlightRibbonStore } from './GpuFlightRibbon';

// Eight attributes, including UVs from the existing atlas; compatible with WebGL's minimum.
export const FLIGHT_RIBBON_VERTEX_SHADER = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform mat4 uProjectionMatrix;
uniform mat3 uViewMatrix;
uniform float uTime;
attribute vec2 inCenter;
attribute vec2 inOffset;
attribute vec2 inDrift;
attribute vec2 inTime;
attribute vec2 inWidth;
attribute vec4 inColor;
attribute vec2 inStyle;
attribute vec2 inUV;
varying vec2 timeData;
varying vec4 colorData;
varying vec2 styleData;
varying vec2 uv;
void main() {
  float age = clamp((uTime - inTime.x) / max(0.001, inTime.y), 0.0, 1.0);
  float cubic = age * age * age;
  vec2 position = inCenter + inOffset * (inWidth.x + inWidth.y * cubic) + inDrift * cubic;
  vec3 view = uViewMatrix * vec3(position, 1.0);
  gl_Position = uProjectionMatrix * vec4(view.xy, 0.0, 1.0);
  timeData = inTime; colorData = inColor; styleData = inStyle; uv = inUV;
}`;

export const FLIGHT_RIBBON_FRAGMENT_SHADER = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform sampler2D uMainSampler;
uniform float uTime;
uniform float uAlpha;
varying vec2 timeData;
varying vec4 colorData;
varying vec2 styleData;
varying vec2 uv;
void main() {
  float age = clamp((uTime - timeData.x) / max(0.001, timeData.y), 0.0, 1.0);
  float fade = (1.0 - age) * (1.0 - age);
  vec4 texel = texture2D(uMainSampler, uv);
  float alpha = texel.a * colorData.a * fade * uAlpha;
  vec3 color = mix(vec3(1.0), colorData.rgb, mix(styleData.x, 1.0, age));
  // Phaser uploads premultiplied textures. Do not multiply their RGB by texture alpha twice.
  gl_FragColor = vec4(texel.rgb * color * colorData.a * fade * uAlpha, alpha);
}`;

/** One display-list entry, fixed-size persistent pages, GPU animation between data changes. */
export function createFlightRibbonLayer(scene: Phaser.Scene, store: GpuFlightRibbonStore, depth: number,
  now: () => number): Phaser.GameObjects.Image | null {
  const renderer = scene.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
  // Like SpriteGPULayer, this primitive is WebGL-only. Pure stores remain usable headlessly.
  if (!renderer?.gl) return null;
  const manager = renderer.renderNodes;
  const layer = scene.add.image(0, 0, GPU_VFX_ATLAS_KEY, getGpuVfxFrame(GpuVfxFrameId.FlightCoreStrip).name);
  layer.name = 'flight-signature-ribbons';
  layer.setDepth(depth).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);

  class RibbonPage extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    private uploadedVersion = -1;
    constructor(readonly page: number) {
      super(manager, {
        name: `BatchHandlerFlightRibbon${page}`, shaderName: 'FLIGHT_RIBBON',
        instancesPerBatch: FLIGHT_RIBBON_PAGE_SIZE,
        verticesPerInstance: FLIGHT_RIBBON_VERTICES, indicesPerInstance: FLIGHT_RIBBON_VERTICES,
        topology: renderer!.gl.TRIANGLES,
        vertexSource: FLIGHT_RIBBON_VERTEX_SHADER, fragmentSource: FLIGHT_RIBBON_FRAGMENT_SHADER,
        vertexBufferLayout: { usage: 'DYNAMIC_DRAW', layout: [
          { name: 'inCenter', size: 2 }, { name: 'inOffset', size: 2 }, { name: 'inDrift', size: 2 },
          { name: 'inTime', size: 2 }, { name: 'inWidth', size: 2 }, { name: 'inColor', size: 4 },
          { name: 'inStyle', size: 2 }, { name: 'inUV', size: 2 },
        ] },
      });
    }
    // Phaser calls this virtual hook in its constructor (omitted from Phaser's public d.ts).
    _generateElementIndices(instances: number): ArrayBuffer {
      const indices = new Uint16Array(instances * FLIGHT_RIBBON_VERTICES);
      for (let i = 0; i < indices.length; i++) indices[i] = i;
      return indices.buffer;
    }
    run(context: Phaser.Renderer.WebGL.DrawingContext): void {
      if (!store.pageLive[this.page]) return;
      this.onRunBegin(context);
      const program = this.programManager;
      // Phaser 4.2.1 documents the suite but types its return as plain Object.
      const suite = program.getCurrentProgramSuite() as {
        program: Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper;
        vao: Phaser.Renderer.WebGL.Wrappers.WebGLVAOWrapper;
      } | null;
      if (suite) {
        if (this.uploadedVersion !== store.pageVersion[this.page]) {
          const start = this.page * FLIGHT_RIBBON_PAGE_SIZE * FLIGHT_RIBBON_SLOT_WORDS;
          const data = store.data.subarray(start, start + FLIGHT_RIBBON_PAGE_SIZE * FLIGHT_RIBBON_SLOT_WORDS);
          this.vertexBufferLayout.buffer.viewF32!.set(data);
          this.vertexBufferLayout.buffer.update(data.byteLength);
          this.uploadedVersion = store.pageVersion[this.page];
        }
        // The view matrix already includes scroll and selects the PostFX framebuffer space.
        const m = context.camera!.getViewMatrix();
        renderer!.setProjectionMatrixFromDrawingContext(context);
        program.setUniform('uProjectionMatrix', renderer!.projectionMatrix.val);
        program.setUniform('uViewMatrix', [m.a, m.b, 0, m.c, m.d, 0, m.tx, m.ty, 1]);
        program.setUniform('uTime', now());
        program.setUniform('uAlpha', layer.alpha);
        program.setUniform('uMainSampler', 0);
        program.applyUniforms(suite.program);
        renderer!.drawElements(context, [layer.frame.source.glTexture!], suite.program, suite.vao,
          FLIGHT_RIBBON_PAGE_SIZE * FLIGHT_RIBBON_VERTICES, 0, this.topology);
      }
      this.onRunEnd(context);
    }
    dispose(): void {
      // RenderNodeManager mixes in EventEmitter; its d.ts omits that inheritance.
      (manager as unknown as Phaser.Events.EventEmitter).off(
        Phaser.Renderer.Events.SET_PARALLEL_TEXTURE_UNITS, this.updateTextureCount, this);
      for (const suite of Object.values(this.programManager.programs)) {
        // The renderer revisits this list on context restoration; remove dead wrappers too.
        Phaser.Utils.Array.Remove(renderer!.glVAOWrappers, suite.vao);
        suite.vao.destroy();
      }
      this.programManager.programs = {};
      // Shader programs belong to Phaser's shared factory; only this node's buffers/VAOs die.
      renderer!.deleteBuffer(this.indexBuffer);
      renderer!.deleteBuffer(this.vertexBufferLayout.buffer);
    }
  }
  // Lazy pages avoid reserving all GPU buffers for scenes with little projectile activity.
  const pages = new Map<number, RibbonPage>();
  class RibbonSubmitter extends Phaser.Renderer.WebGL.RenderNodes.RenderNode {
    constructor() { super('SubmitterFlightRibbon', manager); }
    run(context: Phaser.Renderer.WebGL.DrawingContext): void {
      manager.startStandAloneRender(); this.onRunBegin(context);
      for (let i = 0; i < store.pageLive.length; i++) if (store.pageLive[i]) {
        let page = pages.get(i);
        if (!page) { page = new RibbonPage(i); pages.set(i, page); }
        page.run(context);
      }
      this.onRunEnd(context);
    }
  }
  layer.setRenderNodeRole('Submitter', new RibbonSubmitter());
  layer.once(Phaser.GameObjects.Events.DESTROY, () => {
    for (const page of pages.values()) page.dispose();
    pages.clear();
  });
  return layer;
}
