import * as Phaser from 'phaser';
import { AMBIENT_WILDLIFE as TUNING } from './AmbientWildlifeConfig';
import type { ChunkWorldRect } from './chunks/ArenaChunkGrid';
import type { WildlifeVisual } from './AmbientWildlifeGeometry';

interface Entry {
  readonly visual: WildlifeVisual;
  readonly vertexOffset: number;
  readonly indices: number[];
  visible: boolean;
}

/** World-owned layer reusing Graphics' render roles, camera handling and flat-triangle batch.
 * Overrides command replay entirely; there are no Graphics drawing commands or private GL resources.
 */
export type AmbientWildlifeLayer = ReturnType<typeof createAmbientWildlifeLayer>;

export function createAmbientWildlifeLayer(scene: Phaser.Scene, visuals: readonly WildlifeVisual[], depth: number, name: string) {
  // Define the Phaser subclass only for a World with presentation; renderer-free imports
  // and World construction must not need a live Phaser Graphics constructor.
  class WildlifeLayer extends Phaser.GameObjects.Graphics {
    private readonly entries: Entry[];
    private vertices: Float64Array;
    private colors: Uint32Array;
    private indices: Uint32Array;
    private activeIndices: Uint32Array;
    private indexCount = 0;

    constructor(scene: Phaser.Scene, visuals: readonly WildlifeVisual[], depth: number, name: string) {
      super(scene);
      let vertexCount = 0, indexCount = 0;
      this.entries = visuals.map(visual => {
        const vertexOffset = vertexCount;
        vertexCount += visual.mesh.channels.length;
        indexCount += visual.mesh.indices.length;
        return { visual, vertexOffset, indices: visual.mesh.indices.map(i => i + vertexOffset), visible: false };
      });
      this.vertices = new Float64Array(vertexCount * 2);
      this.colors = new Uint32Array(vertexCount);
      this.indices = new Uint32Array(indexCount);
      this.activeIndices = this.indices.subarray(0, 0);
      this.setDepth(depth).setName(name);
      scene.add.existing(this);
    }

    updatePose(view: ChunkWorldRect, time: number): void {
      let count = 0;
      for (const entry of this.entries) {
        const a = entry.visual.animal, margin = a.appearance.footprint;
        entry.visible = a.opacity > .005 && a.x >= view.x - margin && a.y >= view.y - margin
          && a.x <= view.x + view.width + margin && a.y <= view.y + view.height + margin;
        if (!entry.visible) continue;
        entry.visual.sample(time);
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
        const scale = animal.kind === 'fish' ? 1 : TUNING.visualScale;
        const cos = Math.cos(animal.angle) * scale, sin = Math.sin(animal.angle) * scale;
        // Compose camera, World pose and animation once per animal, not per triangle.
        const ax = m.a * cos + m.c * sin, ay = m.b * cos + m.d * sin;
        const bx = m.c * cos - m.a * sin, by = m.d * cos - m.b * sin;
        const tx = m.getX(animal.x, animal.y), ty = m.getY(animal.x, animal.y);
        for (let i = 0; i < mesh.channels.length; i++) {
          const p = mesh.poses[mesh.channels[i]];
          const x = mesh.xy[i * 2] * p.sx + p.x, y = mesh.xy[i * 2 + 1] * p.sy + p.y;
          const vertex = entry.vertexOffset + i;
          this.vertices[vertex * 2] = ax * x + bx * y + tx;
          this.vertices[vertex * 2 + 1] = ay * x + by * y + ty;
          const power = mesh.opacityPower[i];
          const opacity = power === 0 ? 1 : power === 1 ? animal.opacity : animal.opacity * animal.opacity;
          this.colors[vertex] = pack(mesh.rgb[i], mesh.alpha[i] * opacity * this.alpha);
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
