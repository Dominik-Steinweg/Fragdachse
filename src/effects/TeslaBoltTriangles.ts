import * as Phaser from 'phaser';

/** Tesla's changing ribbons use Phaser's shared flat batch, without replaying a Graphics
 * command and allocating two temporary arrays for every individual triangle. No private
 * GPU resources: blend/depth/camera ownership and teardown remain ordinary Graphics. */
export class TeslaBoltTriangles extends Phaser.GameObjects.Graphics {
  private readonly positions: number[] = [];
  private readonly indices: number[] = [];
  private readonly colors: number[] = [];
  private readonly alphas: number[] = [];
  private readonly projected: number[] = [];
  private readonly tints: number[] = [];
  private vertexCount = 0;

  resetTriangles(): void {
    this.vertexCount = 0;
    this.clear();
  }

  addSection(lx: number, ly: number, rx: number, ry: number,
    nextLx: number, nextLy: number, nextRx: number, nextRy: number, color: number, alpha: number): void {
    // Preserve the ordinary Canvas path; only WebGL submission changes.
    if (!(this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl) {
      this.fillStyle(color, alpha);
      this.fillTriangle(lx, ly, rx, ry, nextLx, nextLy);
      this.fillTriangle(rx, ry, nextRx, nextRy, nextLx, nextLy);
      return;
    }
    const v = this.vertexCount;
    const p = v * 2;
    this.positions[p] = lx; this.positions[p + 1] = ly;
    this.positions[p + 2] = rx; this.positions[p + 3] = ry;
    this.positions[p + 4] = nextLx; this.positions[p + 5] = nextLy;
    this.positions[p + 6] = nextRx; this.positions[p + 7] = nextRy;
    this.colors[v / 4] = color;
    this.alphas[v / 4] = alpha;
    const i = v / 4 * 6;
    this.indices[i] = v; this.indices[i + 1] = v + 1; this.indices[i + 2] = v + 2;
    this.indices[i + 3] = v + 1; this.indices[i + 4] = v + 3; this.indices[i + 5] = v + 2;
    this.vertexCount += 4;
  }

  renderWebGL(_renderer: Phaser.Renderer.WebGL.WebGLRenderer, src: TeslaBoltTriangles,
    context: Phaser.Renderer.WebGL.DrawingContext, parentMatrix?: Phaser.GameObjects.Components.TransformMatrix): void {
    if (!src.vertexCount) return;
    const camera = context.camera!;
    camera.addToRenderList(src);
    // Identical transform to Graphics, including camera framebuffer/viewport handling.
    const matrix = Phaser.GameObjects.GetCalcMatrix(src, camera, parentMatrix, !context.useCanvas).calc;
    for (let v = 0; v < src.vertexCount; v += 4) {
      const tint = Phaser.Renderer.WebGL.Utils.getTintAppendFloatAlpha(src.colors[v / 4], src.alphas[v / 4] * src.alpha);
      for (let k = v; k < v + 4; k++) {
        const x = src.positions[k * 2], y = src.positions[k * 2 + 1];
        src.projected[k * 2] = matrix.getX(x, y);
        src.projected[k * 2 + 1] = matrix.getY(x, y);
        src.tints[k] = tint;
      }
    }
    src.indices.length = src.vertexCount / 4 * 6;
    const custom = src.customRenderNodes as { Submitter?: Phaser.Renderer.WebGL.RenderNodes.BatchHandlerTriFlat };
    const defaults = src.defaultRenderNodes as { Submitter: Phaser.Renderer.WebGL.RenderNodes.BatchHandlerTriFlat };
    const submitter = custom.Submitter ?? defaults.Submitter;
    // These emissive ribbons do not use Phaser's shape lighting.
    submitter.batch(context, src.indices, src.projected, src.tints, false);
  }
}
