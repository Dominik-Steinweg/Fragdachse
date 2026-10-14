import * as Phaser from 'phaser';
import { toDesignSpace } from '../graphics/RenderResolution';
import { addDawnMerchantSlice } from '../assets/DawnMerchantUiAssets';

/** A bounded UI surface, redrawn only on content/scroll changes. The viewport clips all
 * children (including NineSlice), without scene-wide masks or offscreen input targets. */
export class DawnMerchantScrollPane {
  readonly content: Phaser.GameObjects.Container;
  readonly surface: Phaser.GameObjects.RenderTexture;
  private readonly thumb: Phaser.GameObjects.NineSlice;
  private readonly track: Phaser.GameObjects.NineSlice;
  private height = 0;
  private offset = 0;
  private down: { x: number; y: number; offset: number; bar: boolean; moved: boolean } | null = null;

  constructor(private readonly scene: Phaser.Scene, parent: Phaser.GameObjects.Container,
    readonly x: number, readonly y: number, readonly width: number, readonly viewportHeight: number,
    private readonly active: () => boolean,
    private readonly click: (x: number, y: number) => void,
    private readonly hover?: (x: number, y: number) => void) {
    this.content = scene.add.container(0, 0);
    this.content.removeFromDisplayList();
    this.content.cameraFilter = 0;
    this.surface = scene.add.renderTexture(x, y, width - 22, viewportHeight).setOrigin(0);
    parent.add(this.surface);
    this.track = addDawnMerchantSlice(scene, parent, 'scrollbar-track', x + width - 14, y, 12, viewportHeight);
    this.thumb = addDawnMerchantSlice(scene, parent, 'scrollbar-thumb', x + width - 12, y, 8, 48);
    const hit = scene.add.rectangle(x, y, width, viewportHeight, 0, 0).setOrigin(0).setInteractive();
    parent.add(hit);
    hit.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.active()) return;
      const point = this.point(pointer);
      this.down = { ...point, offset: this.offset, bar: point.x >= width - 22, moved: false };
      if (this.down.bar) this.move(pointer);
    });
    scene.input.on('pointermove', this.move);
    scene.input.on('pointerup', this.release);
    scene.input.on('wheel', this.wheel);
    scene.sys.renderer?.on(Phaser.Renderer.Events.RESTORE_WEBGL, this.restore);
  }

  private point(pointer: Phaser.Input.Pointer) {
    return { x: toDesignSpace(this.scene.scale, pointer.x) - this.x, y: toDesignSpace(this.scene.scale, pointer.y) - this.y };
  }
  private get maxOffset() { return Math.max(0, this.height - this.viewportHeight); }
  get scrollOffset() { return this.offset; }

  reset(): void { this.down = null; this.offset = 0; }
  cancelDrag(): void { this.down = null; }
  clear(): void { this.content.removeAll(true); }
  setContentHeight(height: number): void { this.height = height; this.scrollTo(this.offset); }
  scrollTo(offset: number): void {
    this.offset = Phaser.Math.Clamp(offset, 0, this.maxOffset);
    this.draw();
  }
  reveal(top: number, bottom: number): void {
    if (top < this.offset) this.scrollTo(top);
    else if (bottom > this.offset + this.viewportHeight) this.scrollTo(bottom - this.viewportHeight);
  }
  draw(): void {
    this.surface.clear().draw(this.content, 0, -this.offset).render();
    const size = Math.max(37, this.viewportHeight * this.viewportHeight / Math.max(this.viewportHeight, this.height));
    this.thumb.setSize(8, size).setY(this.y + (this.viewportHeight - size) * this.offset / Math.max(1, this.maxOffset));
    this.track.setAlpha(this.maxOffset > 0 ? 1 : 0.3);
    this.thumb.setVisible(this.maxOffset > 0);
  }
  private readonly move = (pointer: Phaser.Input.Pointer): void => {
    if (!this.active()) return;
    const p = this.point(pointer), down = this.down;
    if (down) {
      down.moved ||= Math.abs(p.y - down.y) + Math.abs(p.x - down.x) > 6;
      if (down.bar) {
        this.scrollTo((p.y - this.thumb.height / 2) / Math.max(1, this.viewportHeight - this.thumb.height) * this.maxOffset);
      } else if (down.moved) this.scrollTo(down.offset + down.y - p.y);
    } else this.hover?.(p.x, p.y + this.offset);
  };
  private readonly release = (pointer: Phaser.Input.Pointer): void => {
    const down = this.down;
    this.down = null;
    if (!down || !this.active() || down.bar || down.moved) return;
    const p = this.point(pointer);
    if (p.x >= 0 && p.x < this.width - 22 && p.y >= 0 && p.y < this.viewportHeight) this.click(p.x, p.y + this.offset);
  };
  private readonly wheel = (pointer: Phaser.Input.Pointer, _over: unknown[], _dx: number, dy: number): void => {
    if (!this.active()) return;
    const p = this.point(pointer);
    if (p.x >= 0 && p.x < this.width && p.y >= 0 && p.y < this.viewportHeight) this.scrollTo(this.offset + dy * 0.7);
  };
  // Render targets lose their pixels on context restoration. Wait until all textures
  // have restored before repopulating this content cache, including hidden menus.
  private readonly restore = (): void => { this.scene.events.once(Phaser.Scenes.Events.POST_UPDATE, this.redraw); };
  private readonly redraw = (): void => { this.draw(); };
  destroy(): void {
    this.scene.input.off('pointermove', this.move);
    this.scene.input.off('pointerup', this.release);
    this.scene.input.off('wheel', this.wheel);
    this.scene.sys.renderer?.off(Phaser.Renderer.Events.RESTORE_WEBGL, this.restore);
    this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.redraw);
    this.content.destroy(true);
    // The parent owns the visible surface, hit area and scrollbar.
  }
}
