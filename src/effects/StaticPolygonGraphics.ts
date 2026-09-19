import * as Phaser from 'phaser';

interface Point { readonly x: number; readonly y: number }
export interface StaticPolygonLayer {
  readonly polygons: readonly (readonly Point[])[];
  readonly color: number;
  readonly opacity: number;
}
type LayerConstructor = new (scene: Phaser.Scene, layers: readonly StaticPolygonLayer[]) => Phaser.GameObjects.Graphics;
let Layer: LayerConstructor | undefined;
interface CompiledLayers {
  coordinates: number[]; indices: number[]; commands: number[];
  ranges: { start: number; end: number; color: number; opacity: number }[];
  bounds: { left: number; top: number; right: number; bottom: number };
}
const compiledLayers = new WeakMap<readonly StaticPolygonLayer[], CompiledLayers>();

/** Immutable contours use Graphics' existing flat-triangle batch, without per-frame Earcut. */
export function createStaticPolygonGraphics(scene: Phaser.Scene, layers: readonly StaticPolygonLayer[]): Phaser.GameObjects.Graphics {
  if (!Layer) {
    // Resolve Phaser lazily once, keeping renderer-free imports and a stable constructor.
    class StaticPolygonGraphics extends Phaser.GameObjects.Graphics {
      private coordinates: number[] = [];
      private indices: number[] = [];
      private vertices: number[] = [];
      private colors: number[] = [];
      private ranges: CompiledLayers['ranges'] = [];
      private bounds: CompiledLayers['bounds'] = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };

      constructor(scene: Phaser.Scene, layers: readonly StaticPolygonLayer[]) {
        super(scene);
        const compiled = compiledLayers.get(layers);
        if (compiled) {
          this.coordinates = compiled.coordinates; this.indices = compiled.indices; this.ranges = compiled.ranges;
          this.bounds = compiled.bounds;
          // Keep a private Canvas command buffer: clearing one instance cannot change another.
          this.commandBuffer = compiled.commands.slice();
        } else for (const layer of layers) {
          const start = this.coordinates.length / 2;
          this.fillStyle(layer.color, layer.opacity);
          for (const polygon of layer.polygons) {
            const coordinates = new Array<number>(polygon.length * 2);
            for (let i = 0; i < polygon.length; i++) {
              coordinates[i * 2] = polygon[i].x; coordinates[i * 2 + 1] = polygon[i].y;
              this.bounds.left = Math.min(this.bounds.left, polygon[i].x);
              this.bounds.top = Math.min(this.bounds.top, polygon[i].y);
              this.bounds.right = Math.max(this.bounds.right, polygon[i].x);
              this.bounds.bottom = Math.max(this.bounds.bottom, polygon[i].y);
            }
            const offset = this.coordinates.length / 2;
            const indices = Phaser.Geom.Polygon.Earcut(coordinates);
            this.coordinates.push(...coordinates);
            this.indices.push(...indices.map(index => index + offset));
            // Preserve the Canvas renderer too; WebGL bypasses command replay.
            for (let i = 0; i < indices.length; i += 3) {
              const a = polygon[indices[i]], b = polygon[indices[i + 1]], c = polygon[indices[i + 2]];
              this.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
            }
          }
          this.ranges.push({ start, end: this.coordinates.length / 2, color: layer.color, opacity: layer.opacity });
        }
        if (!compiled) compiledLayers.set(layers, { coordinates: this.coordinates, indices: this.indices,
          ranges: this.ranges, bounds: this.bounds, commands: this.commandBuffer.slice() });
        this.vertices = new Array(this.coordinates.length);
        this.colors = new Array(this.coordinates.length / 2);
        scene.add.existing(this);
      }

      renderWebGL(_renderer: Phaser.Renderer.WebGL.WebGLRenderer, src: StaticPolygonGraphics,
        context: Phaser.Renderer.WebGL.DrawingContext, parentMatrix?: Phaser.GameObjects.Components.TransformMatrix): void {
        // Phaser invokes this callback unbound, as for AmbientWildlifeLayer.
        src.renderBatch(context, parentMatrix);
      }

      private renderBatch(context: Phaser.Renderer.WebGL.DrawingContext,
        parentMatrix?: Phaser.GameObjects.Components.TransformMatrix): void {
        if (!this.indices.length) return;
        const camera = context.camera!;
        const matrix = Phaser.GameObjects.GetCalcMatrix(this, camera, parentMatrix, !context.useCanvas).calc;
        // Graphics nested inside a Container has no automatic camera bounds culling.
        // Test the transformed contour against this actual framebuffer, including parent
        // rotation/scale and offscreen camera coordinates, before transforming every vertex.
        const { left, top, right, bottom } = this.bounds;
        const x0 = matrix.getX(left, top), x1 = matrix.getX(right, top);
        const x2 = matrix.getX(right, bottom), x3 = matrix.getX(left, bottom);
        const y0 = matrix.getY(left, top), y1 = matrix.getY(right, top);
        const y2 = matrix.getY(right, bottom), y3 = matrix.getY(left, bottom);
        if (Math.max(x0, x1, x2, x3) < -1 || Math.min(x0, x1, x2, x3) > context.width + 1
          || Math.max(y0, y1, y2, y3) < -1 || Math.min(y0, y1, y2, y3) > context.height + 1) return;
        camera.addToRenderList(this);
        for (let i = 0; i < this.coordinates.length; i += 2) {
          this.vertices[i] = matrix.getX(this.coordinates[i], this.coordinates[i + 1]);
          this.vertices[i + 1] = matrix.getY(this.coordinates[i], this.coordinates[i + 1]);
        }
        for (const range of this.ranges) {
          const tint = Phaser.Renderer.WebGL.Utils.getTintAppendFloatAlpha(range.color, range.opacity * this.alpha);
          this.colors.fill(tint, range.start, range.end);
        }
        const roles = this.customRenderNodes as { Submitter?: Phaser.Renderer.WebGL.RenderNodes.BatchHandlerTriFlat };
        const defaults = this.defaultRenderNodes as { Submitter: Phaser.Renderer.WebGL.RenderNodes.BatchHandlerTriFlat };
        // Phaser's own Graphics renderer passes this boolean; the batch declaration says object|false.
        (roles.Submitter || defaults.Submitter).batch(context, this.indices, this.vertices, this.colors,
          this.lighting as unknown as false | object);
      }

      preDestroy(): void {
        super.preDestroy();
        this.coordinates = []; this.indices = []; this.ranges = [];
        this.vertices.length = this.colors.length = 0;
      }
    }
    Layer = StaticPolygonGraphics;
  }
  return new Layer(scene, layers);
}
