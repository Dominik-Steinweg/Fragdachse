import * as Phaser from 'phaser';

/** Keeps live effect state separate from quality/ablation permission. */
export class QualityControlledParallelFilters extends Phaser.Filters.ParallelFilters {
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
