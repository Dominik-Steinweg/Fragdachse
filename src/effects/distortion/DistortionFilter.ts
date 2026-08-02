import * as Phaser from 'phaser';

/**
 * Displacement mit getrennter Qualitäts- und Effektaktivität.
 *
 * `GraphicsQualityController` ruft bei jedem Stufenwechsel `setActive(true)` auf allen
 * getrackten Filtern. Ohne diese Trennung würde ein Qualitätswechsel den Verzerrungspass
 * einschalten, obwohl gerade gar keine Quelle lebt – ein Vollbildpass für ein neutrales Bild.
 *
 * Dasselbe Muster wie {@link RadialFocusParallelFilters}: die Qualitätsstufe erteilt die
 * Erlaubnis, der Effekt entscheidet über die Nutzung, und nur beides zusammen schaltet ein.
 */
export class DistortionFilter extends Phaser.Filters.Displacement {
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

  isEffectActive(): boolean {
    return this.effectActive;
  }
}
