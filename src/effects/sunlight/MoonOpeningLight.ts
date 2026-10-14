import * as Phaser from 'phaser';
import { cloudShadowAt } from './SunFieldModel';
import type { SunCloudState } from './cloudShadow';
import type { LightMapAmbientLayer } from '../LightingSystem';

/** World px per sample: fine enough for recognisable island shapes, linear upscaling keeps rims soft. */
const SAMPLE_PX = 32;
const MAX_SAMPLES = 96;
/** Opening values mapped to light: below the lower edge nothing, above the upper edge full moonlight. */
const ISLAND_EDGE = [0.45, 0.8] as const;
let nextTexture = 0;

/**
 * Moonlight through cloud openings (Dawn blood moon, D-47): a coarse world-anchored sample of the
 * shared cloud field, added to the light map after its ambient fill. Lamps and other lights add on
 * top unchanged; ground, fog and plants below the light map receive it like any other light.
 */
export class MoonOpeningLight implements LightMapAmbientLayer {
  private readonly key = `__moon_openings_${nextTexture++}`;
  private readonly texture: Phaser.Textures.CanvasTexture;
  private readonly image: Phaser.GameObjects.Image;
  private readonly pixels: ImageData;
  /** Light added in a full opening, RGB 0..1, already scaled by the fade weight. */
  private readonly light = [0, 0, 0];

  constructor(scene: Phaser.Scene, private readonly clouds: SunCloudState) {
    this.texture = scene.textures.createCanvas(this.key, MAX_SAMPLES, MAX_SAMPLES)!;
    this.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.pixels = this.texture.context.createImageData(MAX_SAMPLES, MAX_SAMPLES);
    this.image = new Phaser.GameObjects.Image(scene, 0, 0, this.key).setOrigin(0).setBlendMode(Phaser.BlendModes.ADD);
  }

  setLight(rgb: readonly number[], weight: number): void {
    for (let channel = 0; channel < 3; channel++) this.light[channel] = Math.max(0, Math.min(1, rgb[channel] * weight));
  }

  update(worldX: number, worldY: number, worldWidth: number, worldHeight: number, width: number, height: number):
    Phaser.GameObjects.GameObject | null {
    if (this.light.every(channel => channel <= 0)) return null;
    const cols = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil(worldWidth / SAMPLE_PX) + 1));
    const rows = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil(worldHeight / SAMPLE_PX) + 1));
    const data = this.pixels.data;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const opening = cloudShadowAt(worldX + col / (cols - 1) * worldWidth, worldY + row / (rows - 1) * worldHeight, this.clouds);
        // A soft but clear rim: distinct islands of full moonlight instead of a wide red veil.
        const edge = Math.max(0, Math.min(1, (opening - ISLAND_EDGE[0]) / (ISLAND_EDGE[1] - ISLAND_EDGE[0])));
        const amount = edge * edge * (3 - 2 * edge), index = (row * MAX_SAMPLES + col) * 4;
        data[index] = Math.round(this.light[0] * amount * 255);
        data[index + 1] = Math.round(this.light[1] * amount * 255);
        data[index + 2] = Math.round(this.light[2] * amount * 255);
        data[index + 3] = 255;
      }
    }
    this.texture.context.putImageData(this.pixels, 0, 0, 0, 0, cols, rows);
    this.texture.refresh();
    // Sample centres sit on the texel centres of the used sub-rectangle.
    const texelX = width / (cols - 1), texelY = height / (rows - 1);
    this.image.setCrop(0, 0, cols, rows).setPosition(-texelX / 2, -texelY / 2)
      .setScale(texelX, texelY);
    return this.image;
  }

  destroy(): void {
    this.image.destroy();
    this.texture.destroy();
  }
}
