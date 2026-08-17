import * as Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config';
import {
  RADIAL_FOCUS_SOFTNESS_PX,
  type RadialFocusFrame,
} from './radialFocusState';

/** Texture used by Phaser's built-in Mask filter in the blurred ParallelFilters branch. */
export const RADIAL_FOCUS_MASK_TEXTURE_KEY = '__radial_focus_blur_mask';

const RADIAL_FOCUS_MASK_SCALE = 0.25;
const RADIAL_FOCUS_MASK_WIDTH = Math.ceil(GAME_WIDTH * RADIAL_FOCUS_MASK_SCALE);
const RADIAL_FOCUS_MASK_HEIGHT = Math.ceil(GAME_HEIGHT * RADIAL_FOCUS_MASK_SCALE);
const RADIAL_FOCUS_MASK_COLOR = '255,255,255';

export type { RadialFocusFrame } from './radialFocusState';

/**
 * Built-in ParallelFilters with a separate quality permission and live effect state.
 * GraphicsQualityController can disable the persistent controller without a later frame update
 * re-enabling it while the focus animation is still alive.
 */
export class RadialFocusParallelFilters extends Phaser.Filters.ParallelFilters {
  private effectActive = false;
  private qualityEnabled = true;

  override setActive(value: boolean): this {
    this.qualityEnabled = value;
    super.setActive(value && this.effectActive);
    return this;
  }

  setEffectActive(value: boolean): void {
    this.effectActive = value;
    super.setActive(this.qualityEnabled && value);
  }
}

/**
 * Persistent, low-resolution radial alpha mask for the built-in Mask filter.
 * The texture is updated in place as the focus frame changes; no filter or render target is
 * created during a countdown, death close, or respawn reveal.
 */
export class RadialFocusMaskTexture {
  readonly texture: Phaser.Textures.CanvasTexture;
  private lastFrameKey: string | null = null;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    if (scene.textures.exists(RADIAL_FOCUS_MASK_TEXTURE_KEY)) {
      scene.textures.remove(RADIAL_FOCUS_MASK_TEXTURE_KEY);
    }

    this.texture = scene.textures.createCanvas(
      RADIAL_FOCUS_MASK_TEXTURE_KEY,
      RADIAL_FOCUS_MASK_WIDTH,
      RADIAL_FOCUS_MASK_HEIGHT,
    ) as Phaser.Textures.CanvasTexture;
    this.texture.setSmoothPixelArt(false);
    this.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.texture.refresh();
  }

  update(frame: RadialFocusFrame): void {
    if (this.destroyed) return;

    const key = [
      frame.focusX,
      frame.focusY,
      frame.radiusPx,
      frame.alpha,
    ].map((value) => Math.round(value * 100) / 100).join('|');
    if (key === this.lastFrameKey) return;
    this.lastFrameKey = key;

    const context = this.texture.context;
    const scaleX = this.texture.width / GAME_WIDTH;
    const scaleY = this.texture.height / GAME_HEIGHT;
    const maskWidth = this.texture.width;
    const maskHeight = this.texture.height;
    const focusX = frame.focusX * scaleX;
    const focusY = frame.focusY * scaleY;
    const alpha = Phaser.Math.Clamp(frame.alpha, 0, 1);

    // Die Maske wird über die gesamte Fläche der Weltkamera gestreckt und deckt sie deshalb
    // vollständig ab. Jede Aussparung bliebe als ungefilterter Streifen am Bildrand stehen.
    context.clearRect(0, 0, maskWidth, maskHeight);

    if (frame.radiusPx <= 0) {
      context.fillStyle = `rgba(${RADIAL_FOCUS_MASK_COLOR},${alpha})`;
      context.fillRect(0, 0, maskWidth, maskHeight);
    } else {
      const radius = Math.max(0, frame.radiusPx * scaleX);
      const softness = RADIAL_FOCUS_SOFTNESS_PX * scaleX;
      const outerRadius = Math.max(1, radius + softness);
      const gradient = context.createRadialGradient(
        focusX,
        focusY,
        radius,
        focusX,
        focusY,
        outerRadius,
      );

      // The mask mirrors a smoothstep transition: transparent core, broad soft ramp,
      // and a fully blended blurred branch in the outer arena.
      gradient.addColorStop(0, `rgba(${RADIAL_FOCUS_MASK_COLOR},0)`);
      gradient.addColorStop(0.28, `rgba(${RADIAL_FOCUS_MASK_COLOR},${alpha * 0.05})`);
      gradient.addColorStop(0.62, `rgba(${RADIAL_FOCUS_MASK_COLOR},${alpha * 0.42})`);
      gradient.addColorStop(0.84, `rgba(${RADIAL_FOCUS_MASK_COLOR},${alpha * 0.82})`);
      gradient.addColorStop(1, `rgba(${RADIAL_FOCUS_MASK_COLOR},${alpha})`);
      context.fillStyle = gradient;
      context.fillRect(0, 0, maskWidth, maskHeight);
    }

    this.texture.refresh();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.scene.textures.exists(RADIAL_FOCUS_MASK_TEXTURE_KEY)) {
      this.scene.textures.remove(RADIAL_FOCUS_MASK_TEXTURE_KEY);
    }
  }
}
