import * as Phaser from 'phaser';
import { HEAT_EMISSION_FRAGMENT_SHADER, HEAT_EMISSION_VERTEX_SHADER } from './heatEmissionShader';

/** Bodies drawn per frame; more are skipped (a heat wave never fields this many on screen). */
export const HEAT_EMISSION_CAPACITY = 96;
const VERTICES = 6;
const FLOATS_PER_VERTEX = 24;
const QUAD_CORNERS: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [0, 1], [0, 1], [1, 0], [1, 1]];

/** One body's overlay this frame: its sprite placement, sheet frame and heat. */
export interface HeatEmissionQuad {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly width: number;
  readonly height: number;
  readonly originX: number;
  readonly originY: number;
  readonly flipX: boolean;
  readonly flipY: boolean;
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
  /** Fissure pattern offset of this body. */
  readonly seed: number;
  /** Glow colour (0xRRGGBB) and strength (alpha incl. day/night damping). */
  readonly color: number;
  readonly strength: number;
  /** Zones lit (all zones ≤ this stage). */
  readonly litStage: number;
  /** Zone of the last step and its flare in [0, 1]. */
  readonly freshStage: number;
  readonly flare: number;
  readonly flareColor: number;
  /** Meltdown fissures in [0, 1] and their colour. */
  readonly fissures: number;
  readonly fissureColor: number;
}

/** Per-frame vertex data of all heat overlays. Pure data: no Phaser, no GL. */
export class HeatEmissionBatchData {
  readonly data = new Float32Array(HEAT_EMISSION_CAPACITY * VERTICES * FLOATS_PER_VERTEX);
  count = 0;
  version = 0;

  begin(): void { this.count = 0; this.version++; }

  push(quad: HeatEmissionQuad): void {
    if (this.count >= HEAT_EMISSION_CAPACITY) return;
    const cos = Math.cos(quad.rotation), sin = Math.sin(quad.rotation);
    const [r, g, b] = rgb(quad.color), [fr, fg, fb] = rgb(quad.flareColor), [cr, cg, cb] = rgb(quad.fissureColor);
    let offset = this.count * VERTICES * FLOATS_PER_VERTEX;
    for (const [cx, cy] of QUAD_CORNERS) {
      const lx = (cx - quad.originX) * quad.width, ly = (cy - quad.originY) * quad.height;
      const ux = quad.flipX ? 1 - cx : cx, uy = quad.flipY ? 1 - cy : cy;
      const d = this.data;
      d[offset++] = quad.x + lx * cos - ly * sin; d[offset++] = quad.y + lx * sin + ly * cos;
      d[offset++] = quad.u0 + (quad.u1 - quad.u0) * ux; d[offset++] = quad.v0 + (quad.v1 - quad.v0) * uy;
      d[offset++] = ux - 0.5; d[offset++] = uy - 0.5; d[offset++] = quad.seed; d[offset++] = 0;
      d[offset++] = r; d[offset++] = g; d[offset++] = b; d[offset++] = quad.strength;
      d[offset++] = quad.litStage; d[offset++] = quad.freshStage; d[offset++] = quad.flare; d[offset++] = quad.fissures;
      d[offset++] = fr; d[offset++] = fg; d[offset++] = fb; d[offset++] = 0;
      d[offset++] = cr; d[offset++] = cg; d[offset++] = cb; d[offset++] = 0;
    }
    this.count++;
  }
}

function rgb(color: number): [number, number, number] {
  return [((color >> 16) & 0xff) / 255, ((color >> 8) & 0xff) / 255, (color & 0xff) / 255];
}

export interface HeatEmissionGpuLayer {
  readonly image: Phaser.GameObjects.Image;
  isReady(): boolean;
}

/**
 * One display-list entry and one draw call for the heat overlays of all bodies of one sheet: the
 * zone-lit emission sheet and the beauty sheet's alpha (fissure mask) bound side by side. ADD just
 * above the light map. WebGL only; null for headless or canvas renderers.
 */
export function createHeatEmissionGpuLayer(scene: Phaser.Scene, data: HeatEmissionBatchData, emissionKey: string,
  beautyKey: string, zones: number, depth: number, time: () => number): HeatEmissionGpuLayer | null {
  const renderer = scene.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
  if (!renderer?.gl || !scene.textures.exists(emissionKey) || !scene.textures.exists(beautyKey)) return null;
  const manager = renderer.renderNodes;
  const image = scene.add.image(0, 0, emissionKey);
  image.name = 'heat-emission';
  image.setBlendMode(Phaser.BlendModes.ADD);
  image.setDepth(depth);
  const beauty = scene.textures.get(beautyKey);
  let ready = false;

  class HeatEmissionBatch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    private uploadedVersion = -1;
    constructor() {
      super(manager, {
        name: `BatchHandlerHeatEmission:${emissionKey}`, shaderName: 'HEAT_EMISSION',
        instancesPerBatch: HEAT_EMISSION_CAPACITY, verticesPerInstance: VERTICES, indicesPerInstance: VERTICES,
        topology: renderer!.gl.TRIANGLES,
        vertexSource: HEAT_EMISSION_VERTEX_SHADER, fragmentSource: HEAT_EMISSION_FRAGMENT_SHADER,
        vertexBufferLayout: { usage: 'DYNAMIC_DRAW', layout: [
          { name: 'inPosition', size: 2 }, { name: 'inUv', size: 2 }, { name: 'inLocal', size: 4 },
          { name: 'inColor', size: 4 }, { name: 'inStage', size: 4 }, { name: 'inFresh', size: 4 }, { name: 'inFissure', size: 4 },
        ] },
      });
    }
    // Phaser calls this virtual hook in its constructor (omitted from Phaser's public d.ts).
    _generateElementIndices(instances: number): ArrayBuffer {
      const indices = new Uint16Array(instances * VERTICES);
      for (let i = 0; i < indices.length; i++) indices[i] = i;
      return indices.buffer;
    }
    run(context: Phaser.Renderer.WebGL.DrawingContext): void {
      // Until linked, one all-zero (degenerate) quad compiles the program outside combat.
      if (data.count === 0 && ready) return;
      this.onRunBegin(context);
      const program = this.programManager;
      const suite = program.getCurrentProgramSuite() as {
        program: Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper;
        vao: Phaser.Renderer.WebGL.Wrappers.WebGLVAOWrapper;
      } | null;
      if (suite) {
        ready = true;
        if (this.uploadedVersion !== data.version && data.count > 0) {
          const slice = data.data.subarray(0, data.count * VERTICES * FLOATS_PER_VERTEX);
          this.vertexBufferLayout.buffer.viewF32!.set(slice, 0);
          this.vertexBufferLayout.buffer.update(slice.byteLength, 0);
          this.uploadedVersion = data.version;
        }
        const m = context.camera!.getViewMatrix(!context.useCanvas);
        renderer!.setProjectionMatrixFromDrawingContext(context);
        program.setUniform('uProjectionMatrix', renderer!.projectionMatrix.val);
        program.setUniform('uViewMatrix', [m.a, m.b, 0, m.c, m.d, 0, m.tx, m.ty, 1]);
        program.setUniform('uEmission', 0);
        program.setUniform('uBeauty', 1);
        program.setUniform('uZones', zones);
        program.setUniform('uTime', time());
        program.applyUniforms(suite.program);
        renderer!.drawElements(context, [image.frame.source.glTexture!, beauty.source[0].glTexture!], suite.program, suite.vao,
          Math.max(1, data.count) * VERTICES, 0, this.topology);
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

  const batch = new HeatEmissionBatch();
  class HeatEmissionSubmitter extends Phaser.Renderer.WebGL.RenderNodes.RenderNode {
    constructor() { super(`SubmitterHeatEmission:${emissionKey}`, manager); }
    run(context: Phaser.Renderer.WebGL.DrawingContext): void {
      manager.startStandAloneRender(); this.onRunBegin(context);
      batch.run(context);
      this.onRunEnd(context);
    }
  }
  image.setRenderNodeRole('Submitter', new HeatEmissionSubmitter());
  image.once(Phaser.GameObjects.Events.DESTROY, () => batch.dispose());
  return { image, isReady: () => ready };
}
