import type * as Phaser from 'phaser';
import { getGraphicsQualityController, type GraphicsQualityController } from '../../graphics/GraphicsQuality';
import { GPU_VFX_EFFECTS, type GpuVfxEffectId, type GpuVfxImportance } from './GpuVfxEffects';

/**
 * GpuVfxQuality – die zentrale Qualitaetspolitik des GPU-VFX-Backends.
 *
 * Bis hierhin las jeder migrierte Effekt selbst `getGraphicsQualityController(scene)` und legte
 * seine eigene Auslegung der Faktoren daneben. Das skaliert nicht: jede weitere Migration haette
 * ihre eigene Sonderlogik mitgebracht, und die Airstrike-Luecke (gar kein Quality-Konsum) waere
 * unsichtbar geblieben.
 *
 * `GRAPHICS_QUALITY_PROFILES` bleibt die Quelle der Wahrheit; diese Klasse uebersetzt sie nur in
 * die zwei Formen, die Partikeleffekte brauchen:
 *
 * - **Frequenz strecken** (`scaleFrequency`) – die Semantik von `applyEmitterProfile()` fuer
 *   Flow-Emission. Skaliert wird das Intervall, nicht zusaetzlich die Quantity, sonst ginge der
 *   Faktor quadratisch ein.
 * - **Burst skalieren** (`scaleBurst`) – die Semantik des `emitParticleAt`-Wrappers, mit
 *   Bruchteil-Uebertrag je Effekt, damit auch Faktor 0.35 nicht jeden zweiten Burst verschluckt.
 *
 * Das Backend veraendert bewusst *nicht* selbst die Frequenzen: die Effekte haben
 * unterschiedliche Scheduler-Semantik (die Wolke setzt ihren Countdown pro Frame zurueck, der
 * Exhaust nicht). Sie konsumieren die Politik, statt sie aufgezwungen zu bekommen.
 */
export class GpuVfxQuality {
  private readonly controller: GraphicsQualityController | null;
  private readonly unsubscribe: (() => void) | null;
  /** Gecacht statt pro Frame und Effekt gelesen; wird beim Qualitaetswechsel ungueltig. */
  private factors: Record<GpuVfxImportance, number> | null = null;
  /** Bruchteil-Uebertrag je Effekt fuer `scaleBurst`. */
  private readonly carry: Float64Array;

  constructor(scene: Phaser.Scene) {
    this.controller = getGraphicsQualityController(scene);
    this.carry = new Float64Array(GPU_VFX_EFFECTS.length);
    this.unsubscribe = this.controller?.subscribe(() => { this.factors = null; }) ?? null;
  }

  getFactor(importance: GpuVfxImportance): number {
    if (!this.factors) {
      const profile = this.controller?.getProfile();
      this.factors = profile
        ? { ...profile.particleFactors }
        : { critical: 1, standard: 1, decorative: 1 };
    }
    return this.factors[importance];
  }

  /** Importance eines Effekts aus dem Manifest – Controller muessen sie nicht mitschleppen. */
  getEmissionFactor(effect: GpuVfxEffectId): number {
    return this.getFactor(GPU_VFX_EFFECTS[effect].importance);
  }

  /**
   * Emissionsintervall wie `applyEmitterProfile()`: `max(1, round(base / factor))`. Faktor 0
   * stellt die Emission ganz ab und liefert 0.
   */
  scaleFrequency(baseMs: number, effect: GpuVfxEffectId): number {
    const factor = this.getEmissionFactor(effect);
    if (factor <= 0) return 0;
    return Math.max(1, Math.round(baseMs / factor));
  }

  /**
   * Burst-Menge wie der `emitParticleAt`-Wrapper: pro Aufruf kommt `count * factor` auf den
   * Uebertrag, emittiert wird der ganzzahlige Anteil.
   */
  scaleBurst(effect: GpuVfxEffectId, count: number): number {
    const factor = this.getEmissionFactor(effect);
    if (factor <= 0) return 0;
    const total = this.carry[effect] + count * factor;
    const emitted = Math.floor(total);
    this.carry[effect] = total - emitted;
    return emitted;
  }

  /** Beim Teardown: ein halber Burst darf nicht in die naechste Runde uebertragen werden. */
  resetCarry(effect: GpuVfxEffectId): void {
    this.carry[effect] = 0;
  }

  resetAllCarry(): void {
    this.carry.fill(0);
  }

  destroy(): void {
    this.unsubscribe?.();
  }
}
