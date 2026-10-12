import type * as Phaser from 'phaser';

/** DrawingContextPool is shared. Charge its complete growth since activation to Kraken,
 * including retained targets at a phase transition (conservative if another effect grew it).
 * The baseline is taken after the World has become resident, before boss pages are loaded.
 */
export class KrakenGpuBudget {
  private baseline: number | null = null;
  constructor(private readonly scene: Phaser.Scene) {}
  private poolBytes(): number {
    const renderer = this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    const bytesPerPixel = (renderer.config as { stencil?: boolean }).stencil ? 5 : 4;
    return renderer.drawingContextPool.agePool.reduce((sum, context) => sum + context.width * context.height * bytesPerPixel, 0);
  }
  begin(): void { this.baseline ??= this.poolBytes(); }
  get retainedFilterBytes(): number { return this.baseline === null ? 0 : Math.max(0, this.poolBytes() - this.baseline); }
}
