import * as Phaser from 'phaser';
import { AMBIENT_WILDLIFE as TUNING } from './AmbientWildlifeConfig';
import type { ChunkWorldRect } from './chunks/ArenaChunkGrid';
import type { WildlifeVisual } from './AmbientWildlifeGeometry';
import type { SunCloudState } from '../effects/sunlight/cloudShadow';
import { wildlifeFogCover } from './AmbientWildlifeAppearance';

/** Where and how strongly a presampled visual is drawn in one layer this frame. */
export interface WildlifeLayerProjection {
  x: number;
  y: number;
  angle: number;
  scale: number;
  /** Multiplies alpha; at or below zero the visual is culled from this layer. */
  weight: number;
  /** Multiplied into every vertex colour; 0xffffff leaves colours untouched. */
  tint: number;
  /** Culling radius around (x, y) in world pixels. */
  radius: number;
}

export interface WildlifeLayerOptions<V extends WildlifeVisual = WildlifeVisual> {
  /** The owner samples each visual once per frame for all its layers; this only places it. */
  readonly project: (visual: V, out: WildlifeLayerProjection) => void;
}

interface Entry<V extends WildlifeVisual> {
  readonly visual: V;
  readonly vertexOffset: number;
  readonly indices: number[];
  readonly pose: WildlifeLayerProjection;
  visible: boolean;
}

/** World-owned layer reusing Graphics' render roles, camera handling and flat-triangle batch.
 * Overrides command replay entirely; there are no Graphics drawing commands or private GL resources.
 */
export type AmbientWildlifeLayer = ReturnType<typeof createAmbientWildlifeLayer>;

export function createAmbientWildlifeLayer<V extends WildlifeVisual>(scene: Phaser.Scene, visuals: readonly V[], depth: number,
  name: string, options?: WildlifeLayerOptions<V>) {
  const project = options?.project;
  // Define the Phaser subclass only for a World with presentation; renderer-free imports
  // and World construction must not need a live Phaser Graphics constructor.
  class WildlifeLayer extends Phaser.GameObjects.Graphics {
    private readonly entries: Entry<V>[];
    private vertices: Float64Array;
    private colors: Uint32Array;
    private indices: Uint32Array;
    private activeIndices: Uint32Array;
    private indexCount = 0;

    constructor(scene: Phaser.Scene, visuals: readonly V[], depth: number, name: string) {
      super(scene);
      let vertexCount = 0, indexCount = 0;
      this.entries = visuals.map(visual => {
        const vertexOffset = vertexCount;
        vertexCount += visual.mesh.channels.length;
        indexCount += visual.mesh.indices.length;
        return { visual, vertexOffset, indices: visual.mesh.indices.map(i => i + vertexOffset), visible: false,
          pose: { x: 0, y: 0, angle: 0, scale: 1, weight: 0, tint: 0xffffff, radius: 0 } };
      });
      this.vertices = new Float64Array(vertexCount * 2);
      this.colors = new Uint32Array(vertexCount);
      this.indices = new Uint32Array(indexCount);
      this.activeIndices = this.indices.subarray(0, 0);
      this.setDepth(depth).setName(name);
      scene.add.existing(this);
    }

    updatePose(view: ChunkWorldRect, time: number, fog?: SunCloudState): void {
      let count = 0;
      for (const entry of this.entries) {
        const a = entry.visual.animal;
        if (project) {
          const p = entry.pose;
          project(entry.visual, p);
          entry.visible = p.weight > .002 && a.opacity > .005 && p.x >= view.x - p.radius && p.y >= view.y - p.radius
            && p.x <= view.x + view.width + p.radius && p.y <= view.y + view.height + p.radius;
        } else {
          const margin = a.appearance.footprint * (fog ? 1.36 : 1);
          entry.visible = a.opacity > .005 && a.x >= view.x - margin && a.y >= view.y - margin
            && a.x <= view.x + view.width + margin && a.y <= view.y + view.height + margin;
          if (!entry.visible) continue;
          if (fog) entry.visual.sample(time, wildlifeFogCover(a.x, a.y, fog));
          else entry.visual.sample(time);
        }
        if (!entry.visible) continue;
        for (let i = 0; i < entry.indices.length; i++) this.indices[count++] = entry.indices[i];
      }
      // Only a tiny view changes when the visible count changes. The backing allocation
      // stays resident, including through fully culled frames; no cache of visibility sets.
      if (count !== this.indexCount) this.activeIndices = this.indices.subarray(0, count);
      this.indexCount = count;
    }

    renderWebGL(_renderer: Phaser.Renderer.WebGL.WebGLRenderer, src: WildlifeLayer,
      context: Phaser.Renderer.WebGL.DrawingContext, parentMatrix?: Phaser.GameObjects.Components.TransformMatrix): void {
      // RenderSteps invokes this callback unbound.
      src.renderBatch(context, parentMatrix);
    }

    private renderBatch(context: Phaser.Renderer.WebGL.DrawingContext,
      parentMatrix?: Phaser.GameObjects.Components.TransformMatrix): void {
      if (!this.indexCount) return;
      const camera = context.camera!;
      camera.addToRenderList(this);
      const m = Phaser.GameObjects.GetCalcMatrix(this, camera, parentMatrix, !context.useCanvas).calc;
      const pack = Phaser.Renderer.WebGL.Utils.getTintAppendFloatAlpha;
      for (const entry of this.entries) {
        if (!entry.visible) continue;
        const { animal, mesh } = entry.visual;
        const p = entry.pose;
        const x0 = project ? p.x : animal.x, y0 = project ? p.y : animal.y;
        const angle = project ? p.angle : animal.angle;
        const scale = project ? p.scale : animal.kind === 'fish' ? 1 : TUNING.visualScale;
        const alphaScale = (project ? p.weight : 1) * this.alpha;
        const tint = project ? p.tint : 0xffffff;
        const tr = ((tint >> 16) & 255) / 255, tg = ((tint >> 8) & 255) / 255, tb = (tint & 255) / 255;
        const cos = Math.cos(angle) * scale, sin = Math.sin(angle) * scale;
        // Compose camera, World pose and animation once per animal, not per triangle.
        const ax = m.a * cos + m.c * sin, ay = m.b * cos + m.d * sin;
        const bx = m.c * cos - m.a * sin, by = m.d * cos - m.b * sin;
        const tx = m.getX(x0, y0), ty = m.getY(x0, y0);
        for (let i = 0; i < mesh.channels.length; i++) {
          const q = mesh.poses[mesh.channels[i]];
          const lx = mesh.xy[i * 2] * q.sx, ly = mesh.xy[i * 2 + 1] * q.sy;
          const x = mesh.rotated ? lx * q.c - ly * q.s + q.x : lx + q.x;
          const y = mesh.rotated ? lx * q.s + ly * q.c + q.y : ly + q.y;
          const vertex = entry.vertexOffset + i;
          this.vertices[vertex * 2] = ax * x + bx * y + tx;
          this.vertices[vertex * 2 + 1] = ay * x + by * y + ty;
          const power = mesh.opacityPower[i];
          const opacity = power === 0 ? 1 : power === 1 ? animal.opacity : animal.opacity * animal.opacity;
          let rgb = mesh.rgb[i];
          // A multiply only: tinted copies above the lightmap never become brighter than their material.
          if (tint !== 0xffffff) rgb = (Math.round(((rgb >> 16) & 255) * tr) << 16)
            | (Math.round(((rgb >> 8) & 255) * tg) << 8) | Math.round((rgb & 255) * tb);
          this.colors[vertex] = pack(rgb, mesh.alpha[i] * opacity * alphaScale);
        }
      }
      // Phaser 4.2.1 exposes these role maps as plain object in its declarations.
      const roles = this.customRenderNodes as { Submitter?: Phaser.Renderer.WebGL.RenderNodes.BatchHandlerTriFlat };
      const defaults = this.defaultRenderNodes as { Submitter: Phaser.Renderer.WebGL.RenderNodes.BatchHandlerTriFlat };
      // The installed batch only indexes/reads these arrays; its declarations require number[].
      (roles.Submitter || defaults.Submitter).batch(context, this.activeIndices as unknown as number[],
        this.vertices as unknown as number[], this.colors as unknown as number[], false);
    }

    preDestroy(): void {
      super.preDestroy();
      this.entries.length = 0;
      this.vertices = new Float64Array(0);
      this.colors = this.indices = this.activeIndices = new Uint32Array(0);
      this.indexCount = 0;
    }
  }
  return new WildlifeLayer(scene, visuals, depth, name);
}
