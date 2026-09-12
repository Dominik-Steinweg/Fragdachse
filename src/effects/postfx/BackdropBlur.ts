import * as Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config';
import { getGraphicsQualityController, getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { getRenderScale } from '../../graphics/RenderResolution';
import { QualityControlledParallelFilters } from './QualityControlledParallelFilters';

export interface BackdropSurface {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly alpha: number;
}

/** World-camera blur behind screen-fixed surfaces. Clarity-camera UI remains sharp. */
export class BackdropBlur {
  private readonly texture: Phaser.Textures.CanvasTexture;
  private readonly parallel: QualityControlledParallelFilters;
  private readonly blur: Phaser.Filters.Blur;
  private readonly textureKey: string;
  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  private lastMask = '';
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene,
    private readonly surfaces: () => readonly (BackdropSurface | null)[]) {
    this.textureKey = '__backdrop_blur_' + Phaser.Utils.String.UUID();
    this.texture = scene.textures.createCanvas(this.textureKey, GAME_WIDTH / 2, GAME_HEIGHT / 2)!;
    this.texture.setSmoothPixelArt(false);
    this.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.texture.refresh();
    const camera = this.camera = scene.cameras.main;
    this.parallel = new QualityControlledParallelFilters(camera);
    camera.filters.internal.add(this.parallel);
    this.blur = this.parallel.top.addBlur(1, 2, 2, 1, 0xffffff, 3);
    this.parallel.top.addMask(this.textureKey);
    this.parallel.blend.blendMode = Phaser.BlendModes.NORMAL;
    this.parallel.blend.amount = 1;
    getGraphicsQualityController(scene)?.trackFilter(camera, this.parallel, false, 'standard', 'camera');
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.update);
    this.update();
  }

  private readonly update = (): void => {
    const surfaces = this.surfaces().filter((surface): surface is BackdropSurface =>
      surface !== null && surface.alpha > 0 && surface.y < GAME_HEIGHT
      && surface.y + surface.height > 0);
    this.parallel.setEffectActive(surfaces.length > 0);
    if (surfaces.length === 0) return;
    const scale = getRenderScale(this.scene.scale);
    this.blur.x = this.blur.y = 2 * scale;
    this.blur.steps = getGraphicsQualityProfile(this.scene).level === 'low' ? 2 : 3;
    const key = JSON.stringify(surfaces);
    if (key === this.lastMask) return;
    this.lastMask = key;
    const context = this.texture.context;
    context.clearRect(0, 0, this.texture.width, this.texture.height);
    context.save();
    context.scale(this.texture.width / GAME_WIDTH, this.texture.height / GAME_HEIGHT);
    context.fillStyle = '#ffffff';
    for (const surface of surfaces) {
      context.globalAlpha = surface.alpha;
      context.beginPath();
      context.roundRect(surface.x, surface.y, surface.width, surface.height, surface.radius);
      context.fill();
    }
    context.restore();
    this.texture.refresh();
  };

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.update);
    getGraphicsQualityController(this.scene)?.untrackFilter(this.parallel);
    this.parallel.setEffectActive(false);
    // CameraManager may already have cleared scene.cameras.main during Scene shutdown.
    this.camera.filters.internal.remove(this.parallel);
    this.scene.textures.remove(this.textureKey);
  }
}
