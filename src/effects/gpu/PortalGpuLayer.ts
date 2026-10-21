import * as Phaser from 'phaser';
import type { ShaderWarmupProbe } from '../../graphics/ShaderWarmupProbe';
import { registerGraphicsObject } from '../EffectUtils';
import {
  PORTAL_APERTURE_FRAGMENT, PORTAL_APERTURE_VERTEX, PORTAL_PARTICLE_FRAGMENT, PORTAL_PARTICLE_VERTEX,
} from './PortalShader';

/**
 * Shared GPU layer of every portal. Three bounded draws per frame regardless of portal count:
 * the aperture's ground material (seat, throat, destination view), its emissive rim and the
 * analytic particles. Owners never touch this layer; `PortalPresentation` fills it.
 */
export interface PortalPassDepths { readonly material: number; readonly emissive: number; readonly particles: number }
export const PORTAL_PASS_DEPTHS: PortalPassDepths = { material: 9.3, emissive: 19.6, particles: 19.62 };
/** Placement previews (where a portal will open) stay readable above the world, like other aiming aids. */
export const PORTAL_PREVIEW_PASS_DEPTHS: PortalPassDepths = { material: 98.96, emissive: 98.98, particles: 98.99 };
export const PORTAL_APERTURE_CAPACITY = 192;
export const PORTAL_PARTICLE_CAPACITY = 3072;
const VERTICES = 6;
export const PORTAL_APERTURE_WORDS = 24;
export const PORTAL_PARTICLE_WORDS = 16;
const CORNERS = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];

export const enum PortalApertureKind { Portal = 0, ReleaseWave = 1, Collapse = 2, SwallowFlare = 3 }
export const enum PortalMoteKind { SpiralIn = 0, SpiralOut = 1, Direction = 2, Swallow = 3, Release = 4,
  CometOut = 5, CometIn = 6, Collapse = 7 }

export interface PortalApertureInstance {
  x: number; y: number; radius: number; extent: number;
  open: number; strength: number; seed: number;
  dx: number; dy: number; ground: number;
  meter: number; charge: number; flash: number; t0: number;
  rim: number; hot: number;
  angle: number; aspect: number; pulse: number; kind: PortalApertureKind;
}
export interface PortalMoteInstance {
  x: number; y: number; radius: number; kind: PortalMoteKind; seed: number; t0: number;
  dx: number; dy: number; strength: number; size: number;
  rim: number; hot: number; life: number; reach: number;
}

export interface PortalGpuFrameUniforms {
  /** Seconds, wrapped; the same clock as every event start (`t0`). */
  readonly time: number;
  /** 0 by day, 1 at full night; lifts halo and wake where they matter. */
  readonly night: number;
  readonly detail: number;
  readonly terrain: Phaser.Textures.Texture | null;
  /** World x, y, width, height covered by the terrain texture. */
  readonly terrainRect: readonly [number, number, number, number];
}

class PortalStore {
  readonly data: Float32Array;
  count = 0;
  version = 0;
  constructor(readonly capacity: number, readonly words: number) {
    this.data = new Float32Array(capacity * VERTICES * words);
  }
  begin(): void { this.count = 0; this.version++; }
}

export class PortalGpuLayer {
  private readonly apertures = new PortalStore(PORTAL_APERTURE_CAPACITY, PORTAL_APERTURE_WORDS);
  private readonly motes = new PortalStore(PORTAL_PARTICLE_CAPACITY, PORTAL_PARTICLE_WORDS);
  private readonly images: Phaser.GameObjects.Image[] = [];
  private readonly batches: PortalBatchPort[] = [];
  private uniforms: PortalGpuFrameUniforms = { time: 0, night: 0, detail: 1, terrain: null, terrainRect: [0, 0, 1, 1] };

  constructor(private readonly scene: Phaser.Scene, depths: PortalPassDepths = PORTAL_PASS_DEPTHS) {
    const renderer = scene.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
    if (!renderer?.gl) return;
    const passes: { name: string; depth: number; blend: number; pass: number; particles: boolean }[] = [
      { name: 'material', depth: depths.material, blend: Phaser.BlendModes.NORMAL, pass: 0, particles: false },
      { name: 'emissive', depth: depths.emissive, blend: Phaser.BlendModes.ADD, pass: 1, particles: false },
      { name: 'particles', depth: depths.particles, blend: Phaser.BlendModes.ADD, pass: 2, particles: true },
    ];
    for (const spec of passes) {
      const image = scene.add.image(0, 0, '__WHITE').setDepth(spec.depth).setBlendMode(spec.blend).setVisible(false);
      image.name = `portal-${spec.name}`;
      registerGraphicsObject(scene, 'teleportEffects', image);
      const store = spec.particles ? this.motes : this.apertures;
      const batch = createPortalBatch(renderer, image, spec.pass, store, () => this.uniforms, spec.particles);
      const manager = renderer.renderNodes;
      class Submitter extends Phaser.Renderer.WebGL.RenderNodes.RenderNode {
        constructor() { super(`SubmitterPortal${spec.pass}`, manager); }
        run(context: Phaser.Renderer.WebGL.DrawingContext): void {
          manager.startStandAloneRender(); this.onRunBegin(context); batch.run(context); this.onRunEnd(context);
        }
      }
      image.setRenderNodeRole('Submitter', new Submitter());
      image.once(Phaser.GameObjects.Events.DESTROY, () => batch.dispose());
      this.images.push(image);
      this.batches.push(batch);
    }
  }

  begin(uniforms: PortalGpuFrameUniforms): void {
    this.uniforms = uniforms;
    this.apertures.begin();
    this.motes.begin();
  }

  addAperture(i: PortalApertureInstance): boolean {
    const store = this.apertures;
    if (store.count >= store.capacity) return false;
    let o = store.count++ * VERTICES * PORTAL_APERTURE_WORDS;
    const d = store.data;
    for (let v = 0; v < VERTICES; v++) {
      const lx = CORNERS[v * 2] * i.extent, ly = CORNERS[v * 2 + 1] * i.extent;
      d[o++] = i.x + lx; d[o++] = i.y + ly; d[o++] = lx; d[o++] = ly;
      d[o++] = i.radius; d[o++] = i.open; d[o++] = i.strength; d[o++] = i.seed;
      d[o++] = i.dx; d[o++] = i.dy; d[o++] = i.ground; d[o++] = 0;
      d[o++] = i.meter; d[o++] = i.charge; d[o++] = i.flash; d[o++] = i.t0;
      d[o++] = i.rim; d[o++] = i.hot; d[o++] = 0; d[o++] = 0;
      d[o++] = i.angle; d[o++] = i.aspect; d[o++] = i.pulse; d[o++] = i.kind;
    }
    return true;
  }

  addMote(i: PortalMoteInstance): boolean {
    const store = this.motes;
    if (store.count >= store.capacity) return false;
    let o = store.count++ * VERTICES * PORTAL_PARTICLE_WORDS;
    const d = store.data;
    for (let v = 0; v < VERTICES; v++) {
      d[o++] = i.x; d[o++] = i.y; d[o++] = CORNERS[v * 2]; d[o++] = CORNERS[v * 2 + 1];
      d[o++] = i.radius; d[o++] = i.kind; d[o++] = i.seed; d[o++] = i.t0;
      d[o++] = i.dx; d[o++] = i.dy; d[o++] = i.strength; d[o++] = i.size;
      d[o++] = i.rim; d[o++] = i.hot; d[o++] = i.life; d[o++] = i.reach;
    }
    return true;
  }

  /** Publishes this frame's instances; empty passes are hidden and cost nothing. */
  end(): void {
    this.images[0]?.setVisible(this.apertures.count > 0);
    this.images[1]?.setVisible(this.apertures.count > 0);
    this.images[2]?.setVisible(this.motes.count > 0);
  }

  get counts(): { apertures: number; motes: number } {
    return { apertures: this.apertures.count, motes: this.motes.count };
  }

  /** Shader warmup: links all three passes with one degenerate instance each. */
  prepare(context: Phaser.Renderer.WebGL.DrawingContext): boolean {
    context.renderer.renderNodes.startStandAloneRender();
    return this.batches.map(batch => batch.run(context, true)).every(Boolean);
  }

  destroy(): void {
    for (const image of this.images) image.destroy();
    this.images.length = 0;
    this.batches.length = 0;
  }
}

/** Links the portal programs during the loading barrier, so the first portal never stalls. */
export function createPortalShaderProbe(scene: Phaser.Scene): ShaderWarmupProbe {
  let layer: PortalGpuLayer | null = null;
  return {
    name: 'portal',
    prepare: context => {
      layer ??= new PortalGpuLayer(scene);
      return layer.prepare(context);
    },
    destroy: () => { layer?.destroy(); layer = null; },
  };
}

interface PortalBatchPort { run(context: Phaser.Renderer.WebGL.DrawingContext, preparing?: boolean): boolean; dispose(): void }

function createPortalBatch(renderer: Phaser.Renderer.WebGL.WebGLRenderer, image: Phaser.GameObjects.Image, pass: number,
  store: PortalStore, uniforms: () => PortalGpuFrameUniforms, particles: boolean): PortalBatchPort {
  const words = particles ? PORTAL_PARTICLE_WORDS : PORTAL_APERTURE_WORDS;
  const layout = particles
    ? [{ name: 'inGeom', size: 4 }, { name: 'inMote', size: 4 }, { name: 'inDir', size: 4 }, { name: 'inColor', size: 4 }]
    : [{ name: 'inGeom', size: 4 }, { name: 'inShape', size: 4 }, { name: 'inLink', size: 4 },
      { name: 'inState', size: 4 }, { name: 'inColor', size: 4 }, { name: 'inForm', size: 4 }];
  class PortalBatch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    private uploadedVersion = -1;
    private disposed = false;
    constructor() {
      super(renderer.renderNodes, {
        name: `BatchHandlerPortal${pass}`, shaderName: particles ? 'PORTAL_PARTICLES' : 'PORTAL_APERTURE',
        instancesPerBatch: store.capacity, verticesPerInstance: VERTICES, indicesPerInstance: VERTICES,
        topology: renderer.gl.TRIANGLES,
        vertexSource: particles ? PORTAL_PARTICLE_VERTEX : PORTAL_APERTURE_VERTEX,
        fragmentSource: particles ? PORTAL_PARTICLE_FRAGMENT : PORTAL_APERTURE_FRAGMENT,
        vertexBufferLayout: { usage: 'DYNAMIC_DRAW', layout },
      });
    }
    // Phaser calls this virtual hook in its constructor (omitted from Phaser's public d.ts).
    _generateElementIndices(instances: number): ArrayBuffer {
      const indices = new Uint16Array(instances * VERTICES);
      for (let i = 0; i < indices.length; i++) indices[i] = i;
      return indices.buffer;
    }
    run(context: Phaser.Renderer.WebGL.DrawingContext, preparing = false): boolean {
      if (!preparing && store.count === 0) return false;
      const instances = Math.max(preparing ? 1 : 0, store.count);
      this.onRunBegin(context);
      const program = this.programManager;
      // Phaser 4.2.1 documents the suite but types its return as plain Object.
      const suite = program.getCurrentProgramSuite() as {
        program: Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper;
        vao: Phaser.Renderer.WebGL.Wrappers.WebGLVAOWrapper;
      } | null;
      if (suite) {
        if (preparing && store.count === 0) store.data.fill(0, 0, VERTICES * words);
        if (this.uploadedVersion !== store.version || preparing) {
          const data = store.data.subarray(0, instances * VERTICES * words);
          this.vertexBufferLayout.buffer.viewF32!.set(data);
          this.vertexBufferLayout.buffer.update(data.byteLength, 0);
          this.uploadedVersion = store.version;
        }
        const frame = uniforms();
        const m = context.camera!.getViewMatrix(!context.useCanvas);
        renderer.setProjectionMatrixFromDrawingContext(context);
        program.setUniform('uProjectionMatrix', renderer.projectionMatrix.val);
        program.setUniform('uViewMatrix', [m.a, m.b, 0, m.c, m.d, 0, m.tx, m.ty, 1]);
        program.setUniform('uTime', frame.time);
        program.setUniform('uAlpha', image.alpha);
        const textures: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper[] = [];
        if (!particles) {
          const terrain = frame.terrain?.source[0]?.glTexture ?? null;
          program.setUniform('uPass', pass);
          // World units per framebuffer pixel keep the aperture edge one pixel soft at any zoom.
          program.setUniform('uPixel', 1 / Math.max(1e-4, Math.hypot(m.a, m.b)));
          program.setUniform('uNight', frame.night);
          program.setUniform('uDetail', frame.detail);
          program.setUniform('uHasTerrain', terrain ? 1 : 0);
          program.setUniform('uTerrainRect', [...frame.terrainRect]);
          program.setUniform('uTerrain', 0);
          textures.push(terrain ?? image.frame.source.glTexture!);
        }
        program.applyUniforms(suite.program);
        renderer.drawElements(context, textures, suite.program, suite.vao, instances * VERTICES, 0, this.topology);
      }
      this.onRunEnd(context);
      return !!suite;
    }
    dispose(): void {
      if (this.disposed) return;
      this.disposed = true;
      // RenderNodeManager mixes in EventEmitter; its d.ts omits that inheritance.
      (this.manager as unknown as Phaser.Events.EventEmitter).off(
        Phaser.Renderer.Events.SET_PARALLEL_TEXTURE_UNITS, this.updateTextureCount, this);
      for (const suite of Object.values(this.programManager.programs)) {
        Phaser.Utils.Array.Remove(renderer.glVAOWrappers, suite.vao);
        suite.vao.destroy();
      }
      this.programManager.programs = {};
      renderer.deleteBuffer(this.indexBuffer);
      renderer.deleteBuffer(this.vertexBufferLayout.buffer);
    }
  }
  return new PortalBatch();
}
