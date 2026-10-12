import type * as Phaser from 'phaser';
import type { WaterSurfaceModel } from '../../arena/WaterSurfaceModel';
import { addSubmersionFilter, KRAKEN_LAND_EXPOSURE, KRAKEN_WORLD_EXPOSURE, type SubmersionFilter } from '../../effects/kraken/submersionShader';
import type { LoadedReviewAsset, ReviewPose } from './KrakenReviewAssets';

let serial = 0;
/** Rasterize in full, untrimmed sprite space. The model's coordinates are world-local. */
export function reviewWaterMask(model: Pick<WaterSurfaceModel, 'sample'>, width: number, height: number,
  sprite: { x: number; y: number; originX: number; originY: number; scaleX: number; scaleY: number; rotation: number },
  offset: { x: number; y: number }): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  const cos = Math.cos(sprite.rotation), sin = Math.sin(sprite.rotation);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const lx = (x + .5 - width * sprite.originX) * sprite.scaleX;
    const ly = (y + .5 - height * sprite.originY) * sprite.scaleY;
    const distance = model.sample(sprite.x + lx * cos - ly * sin - offset.x,
      sprite.y + lx * sin + ly * cos - offset.y);
    const i = (y * width + x) * 4;
    // Fade only inward: no wet tint on the dry side of the model's shoreline.
    data[i] = Math.round(Math.max(0, Math.min(1, distance)) * 255); data[i + 3] = 255;
  }
  return data;
}

/** Fixture owns its mask, sprite owns its filter, asset loader owns elevation textures. */
export class KrakenReviewSubmersion {
  private readonly mask: Phaser.Textures.CanvasTexture;
  readonly filter: SubmersionFilter;
  private signature = '';
  constructor(private readonly sprite: Phaser.GameObjects.Sprite, asset: LoadedReviewAsset, pose: ReviewPose,
    private readonly model: WaterSurfaceModel, private readonly offset: { x: number; y: number }) {
    this.mask = sprite.scene.textures.createCanvas(`kraken-water-mask-${++serial}`, sprite.width, sprite.height)!;
    this.filter = addSubmersionFilter(sprite, sprite.scene.textures.getFrame(pose.elevationKey!, pose.elevationFrame), asset.elevation!, this.mask.key);
    this.filter.params.exposure = asset.clips.some(c => c.name === 'ashore') ? KRAKEN_LAND_EXPOSURE : KRAKEN_WORLD_EXPOSURE;
  }
  update(pose: ReviewPose, level: number, time: number): void {
    const s = this.sprite;
    this.filter.elevationFrame = s.scene.textures.getFrame(pose.elevationKey!, pose.elevationFrame);
    this.filter.params.waterLevel = level; this.filter.params.time = time;
    const signature = [s.width, s.height, s.x, s.y, s.originX, s.originY, s.scaleX, s.scaleY, s.rotation].join(',');
    if (signature === this.signature) return;
    this.signature = signature;
    this.mask.setSize(s.width, s.height);
    const pixels = this.mask.context.createImageData(s.width, s.height);
    pixels.data.set(reviewWaterMask(this.model, s.width, s.height, s, this.offset));
    this.mask.context.putImageData(pixels, 0, 0); this.mask.refresh();
  }
  destroy(): void { this.mask.destroy(); }
}
