import * as Phaser from 'phaser';
import { attachBarSdf, type BarSdfSource } from './BarSdfGpu';
import {
  BAR_SDF_KIND, createBarSdfInstance, setFillFlash, setFillInstance, setFillSpan, setTroughInstance,
  type BarSdfInstance, type BarSdfPalette,
} from './barSdfInstance';

/** Recessed channel behind a fill; omitted where the frame already paints the groove. */
export interface BarSdfTroughStyle {
  readonly top: number;
  readonly bottom: number;
  readonly alpha?: number;
  readonly border: number;
  readonly borderAlpha?: number;
  readonly borderWidth?: number;
  readonly shadow?: number;
}

export interface BarSdfViewConfig {
  readonly radius: number;
  readonly palette: BarSdfPalette;
  readonly trough?: BarSdfTroughStyle;
  /** Colour revealed between the fill end and a delayed trail end (damage catch-up). */
  readonly trail?: number;
  /** The fill sits this far inside the trough contour, clear of its border ring. */
  readonly inset?: number;
  readonly gloss?: number;
  readonly edge?: number;
  readonly shade?: number;
  readonly scrollFactor?: number;
}

/**
 * A HUD bar drawn by the shared SDF program: an optional trough Image and a fill Image, both in
 * the owner's container at the bar's top-left. Two Images of the same batch handler draw in one
 * call when adjacent. The fill Image's alpha footprint is exactly the filled part, so external
 * glow filters keep hugging the fill as they did with the former cropped gradient texture.
 */
export class BarSdfView {
  readonly trough: Phaser.GameObjects.Image | null;
  readonly fill: Phaser.GameObjects.Image;
  private readonly troughInstance: BarSdfInstance | null;
  private readonly fillInstance: BarSdfInstance;
  private readonly troughSource: BarSdfSource | null;
  private readonly fillSource: BarSdfSource;
  private readonly troughStyle: BarSdfTroughStyle | null;
  private readonly config: BarSdfViewConfig;
  private fillStart = 0;
  private fillEnd = 0;
  private trailEnd = 0;
  private widthValue: number;
  private heightValue: number;
  private borderAlphaValue = 1;
  private borderColor = 0;
  private borderWidth = 1;

  constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number, config: BarSdfViewConfig) {
    this.config = config;
    this.troughStyle = config.trough ?? null;
    this.borderColor = this.troughStyle?.border ?? 0;
    this.borderWidth = this.troughStyle?.borderWidth ?? 1;
    this.widthValue = Math.max(1, width);
    this.heightValue = Math.max(1, height);
    const image = () => {
      const created = scene.add.image(x, y, '__WHITE').setOrigin(0, 0);
      created.setSize(this.widthValue, this.heightValue);
      if (config.scrollFactor !== undefined) created.setScrollFactor(config.scrollFactor);
      return created;
    };
    if (this.troughStyle) {
      this.trough = image();
      this.troughInstance = createBarSdfInstance(BAR_SDF_KIND.trough);
      this.troughSource = { instances: [this.troughInstance], unitWidth: this.widthValue, unitHeight: this.heightValue };
      attachBarSdf(this.trough, this.troughSource);
    } else {
      this.trough = null; this.troughInstance = null; this.troughSource = null;
    }
    this.fill = image();
    this.fillInstance = createBarSdfInstance(BAR_SDF_KIND.fill);
    this.fillSource = { instances: [this.fillInstance], unitWidth: this.widthValue, unitHeight: this.heightValue };
    attachBarSdf(this.fill, this.fillSource);
    this.writeTrough();
    this.writeFill(config.palette);
  }

  get width(): number { return this.widthValue; }
  get height(): number { return this.heightValue; }
  get objects(): Phaser.GameObjects.Image[] { return this.trough ? [this.trough, this.fill] : [this.fill]; }
  /** Filled extent in local units; a trail at or behind it stays hidden. */
  get filledWidth(): number { return this.fillEnd - this.fillStart; }

  /** Tween target for the delayed damage catch-up, in local units. */
  get trailWidth(): number { return this.trailEnd; }
  set trailWidth(value: number) {
    this.trailEnd = Number.isFinite(value) ? Phaser.Math.Clamp(value, 0, this.widthValue) : 0;
    setFillSpan(this.fillInstance, this.fillStart, this.fillEnd, this.trailEnd);
  }

  /** Tween target for border flashes. */
  get borderAlpha(): number { return this.borderAlphaValue; }
  set borderAlpha(value: number) {
    this.borderAlphaValue = Phaser.Math.Clamp(Number.isFinite(value) ? value : 1, 0, 1);
    this.writeTrough();
  }

  /** Fills `[start, end]` in local units (left-anchored bars pass start 0). */
  setSpan(start: number, end: number): this {
    this.fillStart = Phaser.Math.Clamp(Number.isFinite(start) ? start : 0, 0, this.widthValue);
    this.fillEnd = Phaser.Math.Clamp(Number.isFinite(end) ? end : 0, this.fillStart, this.widthValue);
    setFillSpan(this.fillInstance, this.fillStart, this.fillEnd, this.trailEnd);
    return this;
  }

  setFlash(amount: number): this { setFillFlash(this.fillInstance, amount); return this; }

  setPalette(palette: BarSdfPalette): this { this.writeFill(palette); return this; }

  /** Temporary border (flash feedback); `resetBorder` restores the authored ring. */
  setBorder(color: number, width: number): this {
    this.borderColor = color;
    this.borderWidth = width;
    this.writeTrough();
    return this;
  }

  resetBorder(): this {
    this.borderColor = this.troughStyle?.border ?? 0;
    this.borderWidth = this.troughStyle?.borderWidth ?? 1;
    this.borderAlphaValue = 1;
    this.writeTrough();
    return this;
  }

  setPosition(x: number, y: number): this {
    for (const object of this.objects) object.setPosition(x, y);
    return this;
  }

  setX(x: number): this {
    for (const object of this.objects) object.x = x;
    return this;
  }

  setVisible(visible: boolean): this {
    for (const object of this.objects) object.setVisible(visible);
    return this;
  }

  setSize(width: number, height: number): this {
    const w = Math.max(1, width), h = Math.max(1, height);
    if (w === this.widthValue && h === this.heightValue) return this;
    const scale = w / this.widthValue;
    this.widthValue = w; this.heightValue = h;
    for (const object of this.objects) object.setSize(w, h);
    for (const source of [this.troughSource, this.fillSource]) if (source) { source.unitWidth = w; source.unitHeight = h; }
    this.fillInstance.width = w; this.fillInstance.height = h;
    this.fillInstance.radius = Math.min(this.config.radius, h / 2);
    this.writeTrough();
    this.fillStart *= scale; this.fillEnd *= scale; this.trailEnd *= scale;
    setFillSpan(this.fillInstance, this.fillStart, this.fillEnd, this.trailEnd);
    return this;
  }

  destroy(): void {
    for (const object of this.objects) object.destroy();
  }

  private writeTrough(): void {
    const style = this.troughStyle;
    if (!style || !this.troughInstance) return;
    setTroughInstance(this.troughInstance, this.widthValue, this.heightValue, Math.min(this.config.radius, this.heightValue / 2), {
      ...style, border: this.borderColor, borderWidth: this.borderWidth,
      borderAlpha: (style.borderAlpha ?? 1) * this.borderAlphaValue,
    });
  }

  private writeFill(palette: BarSdfPalette): void {
    setFillInstance(this.fillInstance, this.widthValue, this.heightValue, Math.min(this.config.radius, this.heightValue / 2), palette, {
      trail: this.config.trail, inset: this.config.inset, gloss: this.config.gloss, edge: this.config.edge, shade: this.config.shade,
    });
    setFillSpan(this.fillInstance, this.fillStart, this.fillEnd, this.trailEnd);
  }
}
