import type * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH } from '../../config';
import { WORLD_SHADOW_CONFIG, CHARACTER_SHADOW_CONFIG } from '../ShadowConfig';
type Elevation = { min: number; max: number };
type ShadowPose = { key: string; frame: string | number; elevationKey?: string; elevationFrame?: string | number };

let serial = 0;
const SAMPLE_SIZE = 128;
export function tentacleShadowHeight(encoded: number, min: number, max: number, waterLevel: number, contact = 1): number {
  return Math.max(0, min + encoded * (max - min) - waterLevel) * CELL_SIZE * contact;
}

/** Dev-only silhouette projection. One bounded texture per tentacle, rebuilt only when
 * pose/transform changes. Independent trimmed color/elevation pages share logical space.
 * Sprite alpha supplies coverage; height projects it along the existing shadow direction. */
export class KrakenTentacleShadow {
  readonly image: Phaser.GameObjects.Image;
  private readonly texture: Phaser.Textures.CanvasTexture;
  private readonly scratch = document.createElement('canvas');
  private signature = '';
  private destroyed = false;
  constructor(private readonly sprite: Phaser.GameObjects.Sprite, private readonly asset: { elevation?: Elevation },
    private readonly waterAt: (x: number, y: number) => number) {
    this.texture = sprite.scene.textures.createCanvas(`kraken-tentacle-shadow-${++serial}`, 1, 1)!;
    this.image = sprite.scene.add.image(0, 0, this.texture.key).setDepth(DEPTH.PLAYERS - .3).setVisible(false);
    this.image.enableFilters();
    this.image.filters!.internal.addBlur(0, 2, 2, 1, 0xffffff, 2);
    this.scratch.width = this.scratch.height = SAMPLE_SIZE;
  }
  private pixels(frame: Phaser.Textures.Frame): Uint8ClampedArray {
    const ctx = this.scratch.getContext('2d', { willReadFrequently: true })!;
    ctx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    ctx.drawImage(frame.source.image as CanvasImageSource, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight,
      frame.x / frame.realWidth * SAMPLE_SIZE, frame.y / frame.realHeight * SAMPLE_SIZE,
      frame.cutWidth / frame.realWidth * SAMPLE_SIZE, frame.cutHeight / frame.realHeight * SAMPLE_SIZE);
    return ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
  }
  update(pose: ShadowPose, waterLevel: number, contact = 1): void {
    const s = this.sprite, encoding = this.asset.elevation;
    this.image.setVisible(s.visible && !!encoding && !!pose.elevationKey);
    if (!this.image.visible || !encoding || !pose.elevationKey) return;
    const signature = [pose.key, pose.frame, pose.elevationKey, pose.elevationFrame, s.x, s.y, s.rotation,
      s.originX, s.originY, s.displayWidth, s.displayHeight, waterLevel, contact].join(',');
    if (signature === this.signature) return;
    this.signature = signature;
    const color = this.pixels(s.frame), height = this.pixels(s.scene.textures.getFrame(pose.elevationKey, pose.elevationFrame));
    const reach = Math.max(0, encoding.max - waterLevel) * CELL_SIZE;
    const span = Math.ceil(Math.hypot(s.displayWidth, s.displayHeight) * 2 + reach * 2 + 16);
    const size = Math.min(768, span), scale = size / span;
    this.texture.setSize(size, size);
    const result = this.texture.context.createImageData(size, size), data = result.data;
    const c = Math.cos(s.rotation), sn = Math.sin(s.rotation), direction = WORLD_SHADOW_CONFIG.lightDirection;
    const radius = Math.max(1, Math.ceil(Math.max(s.displayWidth, s.displayHeight) / SAMPLE_SIZE * scale * .65));
    for (let y = 0; y < SAMPLE_SIZE; y++) for (let x = 0; x < SAMPLE_SIZE; x++) {
      const i = (y * SAMPLE_SIZE + x) * 4;
      if (!color[i + 3] || !height[i + 3]) continue;
      const z = encoding.min + height[i] / 255 * (encoding.max - encoding.min);
      if (z < waterLevel) continue;
      const h = tentacleShadowHeight(height[i] / 255, encoding.min, encoding.max, waterLevel, contact);
      const lx = ((x + .5) / SAMPLE_SIZE - s.originX) * s.displayWidth;
      const ly = ((y + .5) / SAMPLE_SIZE - s.originY) * s.displayHeight;
      const dx = lx * c - ly * sn + direction.x * h, dy = lx * sn + ly * c + direction.y * h;
      const wet = Math.max(0, Math.min(1, this.waterAt(s.x + dx, s.y + dy)));
      const alpha = color[i + 3] * CHARACTER_SHADOW_CONFIG.directOpacity / (1 + h / 180) * (1 - wet * (1 - CHARACTER_SHADOW_CONFIG.waterResponse));
      const px = Math.round(size / 2 + dx * scale), py = Math.round(size / 2 + dy * scale);
      for (let yy = Math.max(0, py - radius); yy <= Math.min(size - 1, py + radius); yy++) {
        for (let xx = Math.max(0, px - radius); xx <= Math.min(size - 1, px + radius); xx++) {
          const out = (yy * size + xx) * 4;
          data[out] = 5; data[out + 1] = 7; data[out + 2] = 11;
          data[out + 3] = Math.max(data[out + 3], alpha);
        }
      }
    }
    this.texture.context.putImageData(result, 0, 0); this.texture.refresh();
    this.image.setTexture(this.texture.key).setPosition(s.x, s.y).setDisplaySize(span, span);
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.image.destroy(); this.texture.destroy(); this.scratch.width = this.scratch.height = 0;
  }
}
