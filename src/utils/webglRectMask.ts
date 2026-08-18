import * as Phaser from 'phaser';

export interface WebGLRectMaskBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type FilterListLike = {
  addMask: (textureKey: string) => Phaser.Filters.Mask;
  remove: (filter: Phaser.Filters.Mask, forceDestroy?: boolean) => unknown;
};

type FilterTargetLike = {
  enableFilters?: () => unknown;
  filters?: { internal?: FilterListLike | null } | null;
  filtersFocusContext?: boolean;
};

/**
 * A screen-space rectangle stored as a static alpha texture for Phaser 4's WebGL Mask filter.
 *
 * The texture is refreshed only when the rectangle changes. Consumers can therefore share one
 * instance across a camera or a filter target without causing Phaser to capture a mask GameObject
 * on every frame.
 */
export class WebGLRectMaskTexture {
  private readonly texture: Phaser.Textures.CanvasTexture | null;
  private lastBounds: WebGLRectMaskBounds | null = null;
  private cameraAttachment: { list: FilterListLike; filter: Phaser.Filters.Mask } | null = null;
  private objectAttachment: { target: FilterTargetLike; list: FilterListLike; filter: Phaser.Filters.Mask } | null = null;
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly textureKey: string,
    width: number,
    height: number,
  ) {
    const texture = scene.game.renderer.type === Phaser.WEBGL
      ? scene.textures.createCanvas(textureKey, width, height)
      : null;
    if (texture) {
      // A hard alpha boundary matches the former filled rectangle without a blended fringe.
      texture.setSmoothPixelArt(false);
      texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    this.texture = texture;
  }

  update(bounds: WebGLRectMaskBounds): void {
    if (this.destroyed || !this.texture || this.isSameBounds(bounds)) return;

    const context = this.texture.context;
    context.clearRect(0, 0, this.texture.width, this.texture.height);
    context.fillStyle = '#ffffff';
    context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    this.texture.refresh();
    this.lastBounds = { ...bounds };
  }

  attachToCamera(camera: Phaser.Cameras.Scene2D.Camera): Phaser.Filters.Mask | null {
    if (this.destroyed || !this.texture || this.cameraAttachment) return this.cameraAttachment?.filter ?? null;

    const list = camera.filters.internal as unknown as FilterListLike;
    const filter = list.addMask(this.textureKey);
    this.cameraAttachment = { list, filter };
    return filter;
  }

  attachToGameObject(target: object): Phaser.Filters.Mask | null {
    if (this.destroyed || !this.texture || this.objectAttachment) return this.objectAttachment?.filter ?? null;

    const filterTarget = target as FilterTargetLike;
    filterTarget.enableFilters?.();
    const list = filterTarget.filters?.internal;
    if (!list) return null;

    // Containers have no useful intrinsic bounds here. Matching the active camera context keeps
    // the texture in the same screen-space coordinates as the original rectangle clip.
    filterTarget.filtersFocusContext = true;
    const filter = list.addMask(this.textureKey);
    this.objectAttachment = { target: filterTarget, list, filter };
    return filter;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cameraAttachment?.list.remove(this.cameraAttachment.filter);
    this.cameraAttachment = null;
    this.objectAttachment?.list.remove(this.objectAttachment.filter);
    this.objectAttachment = null;
    if (this.scene.textures.exists(this.textureKey)) {
      this.scene.textures.remove(this.textureKey);
    }
  }

  private isSameBounds(bounds: WebGLRectMaskBounds): boolean {
    const previous = this.lastBounds;
    return previous !== null
      && previous.x === bounds.x
      && previous.y === bounds.y
      && previous.width === bounds.width
      && previous.height === bounds.height;
  }
}
