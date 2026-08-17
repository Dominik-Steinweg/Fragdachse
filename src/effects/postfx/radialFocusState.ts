export type RadialFocusQualityLevel = 'high' | 'medium' | 'low';

export interface RadialFocusFrame {
  /** Screen coordinates in the 1920x1080 design space, after camera feedback. */
  readonly focusX: number;
  readonly focusY: number;
  /** Radius of the fully sharp core in design pixels. */
  readonly radiusPx: number;
  /** Overall overlay strength, 0..1. */
  readonly alpha: number;
}

export interface RadialFocusSampling {
  readonly filterActive: boolean;
  /** Phaser Blur quality: 0 low, 1 medium, 2 high. */
  readonly blurQuality: 0 | 1 | 2;
  /** Small, fixed Phaser Blur offsets that avoid repeated contour copies. */
  readonly blurX: number;
  readonly blurY: number;
  readonly blurStrength: number;
  readonly blurSteps: number;
  /** Quality-specific desaturation applied to the blurred branch. */
  readonly desaturate: number;
}

export const RADIAL_FOCUS_SOFTNESS_PX = 96;
export const RADIAL_FOCUS_DARKEN = 0.18;
export const RADIAL_FOCUS_DESATURATE = 0.58;
export const RADIAL_FOCUS_DESATURATE_HIGH = 0.72;

/**
 * Der Schleier ist bildschirmfest und deckt immer den gesamten Designraum ab. Eine Begrenzung
 * auf das Arenarechteck lässt die Ränder außerhalb (`ARENA_OFFSET_Y` oben, die Randspalten
 * links/rechts) ungefiltert stehen – das war als scharfer Streifen am oberen Bildrand sichtbar.
 * Weltkamera-Fläche und Maskentextur teilen denselben Designraum, deshalb gibt es hier kein
 * Rechteck mehr.
 */
export function resolveRadialFocusFrame(
  focusWorldX: number,
  focusWorldY: number,
  cameraScrollX: number,
  cameraScrollY: number,
  radiusPx: number,
  alpha: number,
): RadialFocusFrame {
  return {
    focusX: focusWorldX - cameraScrollX,
    focusY: focusWorldY - cameraScrollY,
    radiusPx,
    alpha: Math.max(0, Math.min(1, alpha)),
  };
}

export function resolveRadialFocusSampling(level: RadialFocusQualityLevel): RadialFocusSampling {
  if (level === 'low') {
    return {
      filterActive: false,
      blurQuality: 0,
      blurX: 0,
      blurY: 0,
      blurStrength: 0,
      blurSteps: 0,
      desaturate: 0,
    };
  }
  return level === 'high'
    ? {
      filterActive: true,
      blurQuality: 2,
      blurX: 1.5,
      blurY: 1.5,
      blurStrength: 1,
      blurSteps: 3,
      desaturate: RADIAL_FOCUS_DESATURATE_HIGH,
    }
    : {
      filterActive: true,
      blurQuality: 1,
      blurX: 1.25,
      blurY: 1.25,
      blurStrength: 1,
      blurSteps: 2,
      desaturate: RADIAL_FOCUS_DESATURATE,
    };
}
