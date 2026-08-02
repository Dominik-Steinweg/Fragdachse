import * as Phaser from 'phaser';
import {
  getGraphicsQualityController,
  getGraphicsQualityProfile,
  type GraphicsQualityController,
} from '../../graphics/GraphicsQuality';
import {
  composePostFx,
  type PostFxPulse,
  PostFxPulseSet,
  type ResolvedPostFxState,
} from './PostFxComposer';
import { BARREL_MIN_PRIORITY, getPostFxPreset, type PostFxEvent } from './postFxPresets';
import { buildTintMatrix, NEUTRAL_WORLD_GRADE, type WorldGrade } from './worldGrade';
import {
  RADIAL_FOCUS_MASK_TEXTURE_KEY,
  RadialFocusMaskTexture,
  RadialFocusParallelFilters,
  type RadialFocusFrame,
} from './RadialFocusFilter';
import {
  RADIAL_FOCUS_DARKEN,
  RADIAL_FOCUS_DESATURATE,
  resolveRadialFocusSampling,
} from './radialFocusState';

/** Minimalverträge der Phaser-4-Filter, die diese Kette verwendet. */
interface ColorMatrixLike {
  active: boolean;
  colorMatrix: {
    reset(): unknown;
    brightness(value: number, multiply?: boolean): unknown;
    saturate(value: number, multiply?: boolean): unknown;
    contrast(value: number, multiply?: boolean): unknown;
    multiply(matrix: number[], multiply?: boolean): unknown;
  };
}
interface VignetteLike { active: boolean; radius: number; strength: number; }
interface BarrelLike { active: boolean; amount: number; }
interface ThresholdLike { setEdge(edge1: number, edge2: number): unknown; }
interface BlendLike { blendMode: number; amount: number; }
interface BlurLike {
  active: boolean;
  quality: number;
  x: number;
  y: number;
  strength: number;
  steps: number;
}
interface MaskLike { active: boolean; }
interface ParallelLike {
  active: boolean;
  top: { addThreshold(e1?: number, e2?: number): ThresholdLike; addBlur(q?: number, x?: number, y?: number, s?: number, c?: number, steps?: number): unknown };
  blend: BlendLike;
}
interface RadialFocusParallelLike {
  active: boolean;
  setEffectActive(value: boolean): void;
  top: {
    addBlur(q?: number, x?: number, y?: number, s?: number, c?: number, steps?: number): BlurLike;
    addColorMatrix(): ColorMatrixLike;
    addMask(texture?: string): MaskLike;
  };
  blend: BlendLike;
}
interface DisplacementLike {
  active: boolean;
  x: number;
  y: number;
  setPaddingOverride(left?: number | null, top?: number, right?: number, bottom?: number): unknown;
}

interface FilterChain {
  displacement: DisplacementLike | null;
  parallel: ParallelLike | null;
  threshold: ThresholdLike | null;
  colorMatrix: ColorMatrixLike | null;
  vignette: VignetteLike | null;
  radialFocus: {
    parallel: RadialFocusParallelLike;
    blur: BlurLike;
    grade: ColorMatrixLike;
    mask: MaskLike;
  } | null;
  barrel: BarrelLike | null;
}

/**
 * Breite der Threshold-Rampe. Phasers Threshold ist eine **lineare** Rampe
 * (`clamp((c - edge1) / (edge2 - edge1))`), kein harter Schnitt. Eine schmale Rampe lässt fast
 * nur ausgebrannte Pixel durch; erst eine breitere lässt auch helle Kerne teilweise beitragen
 * und macht den Bloom als Leuchten lesbar.
 */
const BLOOM_EDGE_WIDTH = 0.22;

/**
 * Streuung des Bloom-Blurs. Der Shader rechnet `offset = 1.333 · x · strength` in Pixeln je
 * Schritt – die vorherigen 2 px über 2 Schritte ergaben rund 5 px Gesamtstreuung und waren
 * schlicht nicht als Leuchten wahrnehmbar.
 */
const BLOOM_BLUR_OFFSET_PX = 8;
const BLOOM_BLUR_STEPS = 3;

/**
 * Bildkomposition der **Weltkamera**. Objektbezogene Glows bleiben in `utils/phaserFx.ts`;
 * dieser Controller ist ausschließlich für Screen-Space zuständig.
 *
 * Aufbauregeln, die den Rest der Klasse erklären:
 *
 * - **Die Filterkette entsteht genau einmal.** Filter zur Laufzeit hinzuzufügen oder zu
 *   entfernen reallokiert Render-Targets. Nicht benötigte Filter werden deshalb auf
 *   `active = false` gesetzt, nie abgebaut.
 * - **Alles wird bei `GraphicsQualityController.trackFilter` registriert**, sonst wäre die Kette
 *   für Qualitätsstufen und den Ablationsmodus unsichtbar. Bewusst nichts als `critical`: die
 *   gesamte Komposition muss abschaltbar bleiben.
 * - **Phaser 4 hat keine Bloom-Klasse.** Der kontrollierte Bloom entsteht aus Phasers eigenem
 *   Rezept: `ParallelFilters` mit `Threshold` und `Blur` im oberen Zweig, additiv
 *   zurückgemischt. Nur Spitzlichter gehen ein, die Schärfe des Bildes bleibt erhalten.
 * - **Filter sind WebGL-only.** Ohne WebGL wird nichts konstruiert und jede Methode ist ein
 *   No-op; das Spiel läuft mit den bestehenden lokalen Effekten weiter.
 */
export class CameraPostFxController {
  private readonly pulses = new PostFxPulseSet();
  private readonly chain: FilterChain = {
    displacement: null, parallel: null, threshold: null,
    colorMatrix: null, vignette: null, radialFocus: null, barrel: null,
  };

  private baseGrade: WorldGrade = NEUTRAL_WORLD_GRADE;
  private radialFocusFrame: RadialFocusFrame | null = null;
  private lastState: ResolvedPostFxState | null = null;
  private lastBloomThreshold = Number.NaN;
  private enabled = true;
  private readonly supported: boolean;
  private readonly radialFocusMask: RadialFocusMaskTexture | null;
  private unsubscribeQuality: (() => void) | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly worldCamera: Phaser.Cameras.Scene2D.Camera,
  ) {
    this.supported = CameraPostFxController.isSupported(scene, worldCamera);
    if (!this.supported) {
      this.radialFocusMask = null;
      console.info('[PostFX] Kamerafilter nicht verfügbar (kein WebGL) – Bildkomposition bleibt aus.');
      return;
    }
    this.radialFocusMask = new RadialFocusMaskTexture(scene);
    this.buildChain();
    const quality = getGraphicsQualityController(scene);
    // Ein Qualitätswechsel darf die Kette nicht neu aufbauen, aber der Bloom-Zweig muss
    // seinen Aktivzustand sofort übernehmen statt erst beim nächsten Ereignis.
    this.unsubscribeQuality = quality?.subscribe(() => this.applyState(this.lastState)) ?? null;
  }

  /** Filter existieren nur unter WebGL; unter Canvas fehlt der Renderpfad vollständig. */
  static isSupported(scene: Phaser.Scene, camera: Phaser.Cameras.Scene2D.Camera): boolean {
    if (scene.game.renderer.type !== Phaser.WEBGL) return false;
    const list = (camera as unknown as { filters?: { internal?: { addParallelFilters?: unknown } } }).filters?.internal;
    return typeof list?.addParallelFilters === 'function';
  }

  isActive(): boolean {
    return this.supported && this.enabled;
  }

  setBaseGrade(grade: WorldGrade): void {
    this.baseGrade = grade;
  }

  /**
   * Sets the current spawn/death focus without changing the filter chain. The frame is kept
   * independently from the global grade pulses because it is spatial rather than additive.
   */
  setRadialFocus(frame: RadialFocusFrame | null): void {
    this.radialFocusFrame = frame;
    if (frame) this.radialFocusMask?.update(frame);
    this.applyRadialFocus();
  }

  isRadialFocusFilterActive(): boolean {
    return this.chain.radialFocus?.parallel.active ?? false;
  }

  /** Ereignisse laufen ausschließlich über die Whitelist in `postFxPresets`. */
  pulseEvent(event: PostFxEvent, overrides?: Partial<PostFxPulse>): void {
    if (!this.supported || !this.enabled) return;
    if (!getGraphicsQualityProfile(this.scene).eventPostFx) return;
    const preset = getPostFxPreset(event);
    this.pulses.request({ ...preset, ...overrides, id: overrides?.id ?? event }, this.scene.time.now);
  }

  /** Für die Ereignis-Choreografien aus Stufe 3, die eigene Phasen zusammensetzen. */
  pulse(pulse: PostFxPulse): void {
    if (!this.supported || !this.enabled) return;
    if (!getGraphicsQualityProfile(this.scene).eventPostFx) return;
    this.pulses.request(pulse, this.scene.time.now);
  }

  release(id: string): void {
    this.pulses.release(id);
  }

  update(_deltaMs: number): void {
    if (!this.supported) return;
    if (!this.enabled) {
      this.applyState(null);
      return;
    }
    const now = this.scene.time.now;
    const state = composePostFx(this.baseGrade, this.pulses.prune(now), now);
    this.lastState = state;
    this.applyState(state);
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.pulses.clear();
      this.applyState(null);
    }
  }

  /** Rundenende: laufende Ereignisse fallen lassen und auf Normalwerte zurückkehren. */
  reset(): void {
    this.pulses.clear();
    this.baseGrade = NEUTRAL_WORLD_GRADE;
    this.radialFocusFrame = null;
    this.lastState = null;
    this.applyState(null);
  }

  destroy(): void {
    this.unsubscribeQuality?.();
    this.unsubscribeQuality = null;
    this.reset();
    this.radialFocusMask?.destroy();
  }

  getMetrics(): { activePulses: number; neutral: boolean; supported: boolean } {
    return {
      activePulses: this.lastState?.activePulses ?? 0,
      neutral: this.lastState?.neutral ?? true,
      supported: this.supported,
    };
  }

  private buildChain(): void {
    const list = this.worldCamera.filters.internal;
    const quality = getGraphicsQualityController(this.scene);

    // 1. Platzhalter für die lokale Verzerrung aus Stufe 3. Er entsteht bereits hier, damit die
    //    Kettenform später nicht mehr angefasst werden muss.
    const displacement = list.addDisplacement() as unknown as DisplacementLike;
    displacement.setPaddingOverride();
    displacement.x = 0;
    displacement.y = 0;
    displacement.active = false;
    this.chain.displacement = displacement;

    // 2. Schwellenwert-Bloom nach Phasers eigenem Rezept.
    const parallel = list.addParallelFilters() as unknown as ParallelLike;
    this.chain.threshold = parallel.top.addThreshold(
      this.baseGrade.bloomThreshold,
      this.baseGrade.bloomThreshold + BLOOM_EDGE_WIDTH,
    );
    parallel.top.addBlur(1, BLOOM_BLUR_OFFSET_PX, BLOOM_BLUR_OFFSET_PX, 1, 0xffffff, BLOOM_BLUR_STEPS);
    parallel.blend.blendMode = Phaser.BlendModes.ADD;
    parallel.blend.amount = 0;
    parallel.active = false;
    this.chain.parallel = parallel;

    const colorMatrix = list.addColorMatrix() as unknown as ColorMatrixLike;
    colorMatrix.active = false;
    this.chain.colorMatrix = colorMatrix;

    const vignette = list.addVignette(0.5, 0.5, 1, 0, 0x000000) as unknown as VignetteLike;
    vignette.active = false;
    this.chain.vignette = vignette;

    // The empty bottom branch is the unmodified camera image. The top branch uses only
    // Phaser's built-in Gaussian blur, a spatial color grade, and the persistent radial mask.
    const radialFocusParallel = list.add(
      new RadialFocusParallelFilters(this.worldCamera),
    ) as unknown as RadialFocusParallelLike;
    const highSampling = resolveRadialFocusSampling('high');
    const radialFocusBlur = radialFocusParallel.top.addBlur(
      highSampling.blurQuality,
      this.resolveBlurOffset(highSampling),
      this.resolveBlurOffset(highSampling),
      1,
      0xffffff,
      highSampling.blurSteps,
    );
    const radialFocusGrade = radialFocusParallel.top.addColorMatrix();
    radialFocusGrade.colorMatrix.reset();
    radialFocusGrade.colorMatrix.brightness(1 - RADIAL_FOCUS_DARKEN, true);
    radialFocusGrade.colorMatrix.saturate(-RADIAL_FOCUS_DESATURATE, true);
    const radialFocusMask = radialFocusParallel.top.addMask(RADIAL_FOCUS_MASK_TEXTURE_KEY);
    radialFocusParallel.blend.blendMode = Phaser.BlendModes.NORMAL;
    radialFocusParallel.blend.amount = 1;
    radialFocusParallel.active = false;
    this.chain.radialFocus = {
      parallel: radialFocusParallel,
      blur: radialFocusBlur,
      grade: radialFocusGrade,
      mask: radialFocusMask,
    };

    const barrel = list.addBarrel(1) as unknown as BarrelLike;
    barrel.active = false;
    this.chain.barrel = barrel;

    // Bloom und Barrel sind dekorativ und fallen damit auf `low` weg; Grading und Vignette
    // gelten als Standard. Nichts davon ist kritisch – die gesamte Kette muss ablatierbar sein.
    quality?.trackFilter(this.worldCamera, parallel, false, 'decorative');
    quality?.trackFilter(this.worldCamera, barrel, false, 'decorative');
    quality?.trackFilter(this.worldCamera, colorMatrix, false, 'standard');
    quality?.trackFilter(this.worldCamera, vignette, false, 'standard');
    quality?.trackFilter(this.worldCamera, radialFocusParallel, false, 'standard');
    quality?.trackFilter(this.worldCamera, displacement, false, 'standard');
  }

  /**
   * Schreibt den aufgelösten Zustand in die Kette. `null` bedeutet neutral.
   *
   * Jeder Filter wird abgeschaltet, sobald sein Beitrag null ist: ein inaktiver Filter
   * überspringt seinen Renderpass vollständig, und genau das ist im Normalfall der teuerste
   * vermeidbare Posten.
   */
  private applyState(state: ResolvedPostFxState | null): void {
    const profile = getGraphicsQualityProfile(this.scene);
    const { colorMatrix, vignette, parallel, barrel } = this.chain;

    if (!state || state.neutral) {
      if (colorMatrix) colorMatrix.active = false;
      if (vignette) vignette.active = false;
      if (parallel) parallel.active = false;
      if (barrel) barrel.active = false;
      this.applyRadialFocus();
      return;
    }

    if (colorMatrix) {
      const wanted = profile.worldColorGrade
        && (state.saturation !== 1 || state.contrast !== 1 || state.brightness !== 1 || state.tintStrength > 0);
      colorMatrix.active = wanted;
      if (wanted) {
        const m = colorMatrix.colorMatrix;
        m.reset();
        // Semantik geprüft: `brightness` ist ein Faktor (1 = neutral), `saturate` und
        // `contrast` sind Deltas (0 = neutral).
        m.brightness(state.brightness, true);
        m.saturate(state.saturation - 1, true);
        m.contrast(state.contrast - 1, true);
        if (state.tintStrength > 0) {
          m.multiply(buildTintMatrix(state.temperature, state.tint, state.tintStrength), true);
        }
      }
    }

    if (vignette) {
      const wanted = profile.worldVignette && state.vignetteStrength > 0;
      vignette.active = wanted;
      if (wanted) {
        vignette.radius = state.vignetteRadius;
        vignette.strength = state.vignetteStrength;
      }
    }

    if (parallel) {
      const mode = profile.worldBloom;
      // `event` heißt: kein Dauer-Bloom, aber außergewöhnliche Ereignisse dürfen ihn kurz
      // hochziehen. Der Schwellenwert bleibt derselbe, nur der Grundanteil fehlt.
      const amount = mode === 'off'
        ? 0
        : mode === 'event'
          ? Math.max(0, state.bloomAmount - this.baseGrade.bloomAmount)
          : state.bloomAmount;
      parallel.active = amount > 0;
      parallel.blend.amount = amount;
      if (amount > 0 && this.chain.threshold && state.bloomThreshold !== this.lastBloomThreshold) {
        this.lastBloomThreshold = state.bloomThreshold;
        this.chain.threshold.setEdge(state.bloomThreshold, state.bloomThreshold + BLOOM_EDGE_WIDTH);
      }
    }

    if (barrel) {
      // Verzerrung bleibt außergewöhnlichen Ereignissen vorbehalten und ist nie Teil des
      // Dauerbildes – auch dann nicht, wenn ein Puls sie versehentlich anfordert.
      const wanted = profile.worldBloom === 'full' && state.barrel !== 1;
      barrel.active = wanted;
      if (wanted) barrel.amount = state.barrel;
    }

    this.applyRadialFocus();
  }

  private applyRadialFocus(): void {
    const radialFocus = this.chain.radialFocus;
    if (!radialFocus) return;

    const profile = getGraphicsQualityProfile(this.scene);
    const wanted = this.enabled
      && profile.level !== 'low'
      && this.radialFocusFrame !== null
      && this.radialFocusFrame.alpha > 0.01;
    const sampling = resolveRadialFocusSampling(profile.level === 'high' ? 'high' : 'medium');
    radialFocus.blur.quality = sampling.blurQuality;
    radialFocus.blur.steps = sampling.blurSteps;
    radialFocus.blur.x = this.resolveBlurOffset(sampling);
    radialFocus.blur.y = this.resolveBlurOffset(sampling);
    radialFocus.parallel.setEffectActive(wanted && sampling.filterActive);
  }

  /** Phaser's built-in Blur uses quality-dependent per-step padding constants. */
  private resolveBlurOffset(sampling: ReturnType<typeof resolveRadialFocusSampling>): number {
    if (sampling.blurSteps <= 0 || sampling.blurRadiusPx <= 0) return 0;
    const qualityStepFactor = sampling.blurQuality === 1 ? 3.2307692308 : 1.333;
    return sampling.blurRadiusPx / (qualityStepFactor * sampling.blurSteps);
  }
}

export { BARREL_MIN_PRIORITY };
export type { GraphicsQualityController };
