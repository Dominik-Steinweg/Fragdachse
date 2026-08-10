/**
 * Deterministische Logik der Blutdarstellung am Bildschirmrand bei wenig Leben. Ohne
 * Phaser-Import, damit Einsatzschwelle, Glättung und Herzschlag unit-testbar bleiben.
 *
 * Der Zustand ist bewusst kontinuierlich und nicht tween-getrieben: die Gesundheit wird pro
 * Frame gelesen, und ein Tween pro Trefferereignis liefe gegen die Glättung.
 */

import { LOW_HEALTH_BLOOD_VFX } from '../config';

export interface LowHealthBloodState {
  /** 0 = unsichtbar, 1 = volle Stärke. Folgt der Zielintensität verzögert. */
  readonly intensity: number;
  /** Laufende Phase des Herzschlags in Millisekunden. */
  readonly pulsePhaseMs: number;
}

export interface LowHealthBloodAlphas {
  readonly filmAlpha: number;
  readonly speckleAlpha: number;
}

export const NEUTRAL_LOW_HEALTH_BLOOD_STATE: LowHealthBloodState = {
  intensity: 0,
  pulsePhaseMs: 0,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Zielintensität allein aus der Gesundheit: weicher Einstieg an der Schwelle, voll nahe 0 HP. */
export function resolveLowHealthBloodTarget(hpFraction: number): number {
  const onset = LOW_HEALTH_BLOOD_VFX.onsetHpFraction;
  if (onset <= 0) return 0;
  return smoothstep(clamp01((onset - clamp01(hpFraction)) / onset));
}

/**
 * Schreibt Intensität und Herzschlagphase um `deltaMs` fort.
 *
 * Anstieg und Rückgang sind bewusst unterschiedlich schnell: ein Treffer soll sofort am Rand
 * stehen, eine Heilung soll ausbluten statt zu blinken. Bei Intensität 0 wird die Phase
 * zurückgesetzt, damit der nächste Einsatz nicht mitten im Puls beginnt.
 */
export function stepLowHealthBlood(
  state: LowHealthBloodState,
  hpFraction: number,
  deltaMs: number,
): LowHealthBloodState {
  const step = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0;
  const target = resolveLowHealthBloodTarget(hpFraction);
  const timeConstant = target > state.intensity ? LOW_HEALTH_BLOOD_VFX.riseMs : LOW_HEALTH_BLOOD_VFX.fallMs;
  const approach = timeConstant > 0 ? Math.min(1, step / timeConstant) : 1;
  const intensity = clamp01(state.intensity + (target - state.intensity) * approach);

  if (intensity <= 0.0005 && target <= 0) {
    return NEUTRAL_LOW_HEALTH_BLOOD_STATE;
  }

  const period = resolveLowHealthPulsePeriodMs(intensity);
  return {
    intensity,
    pulsePhaseMs: (state.pulsePhaseMs + step) % period,
  };
}

/** Der Puls wird zum kritischen Bereich hin schneller – dieselbe Lesart wie ein Herzschlag. */
export function resolveLowHealthPulsePeriodMs(intensity: number): number {
  const t = clamp01(intensity);
  return (
    LOW_HEALTH_BLOOD_VFX.pulsePeriodOnsetMs
    + (LOW_HEALTH_BLOOD_VFX.pulsePeriodCriticalMs - LOW_HEALTH_BLOOD_VFX.pulsePeriodOnsetMs) * t
  );
}

/**
 * Deckkraft beider Schichten. Der Spritzer-Layer hat eine eigene, spätere Schwelle: die
 * großflächige Fläche trägt den Zustand, die einzelnen Tropfen markieren erst den kritischen
 * Bereich.
 */
export function resolveLowHealthBloodAlphas(state: LowHealthBloodState): LowHealthBloodAlphas {
  if (state.intensity <= 0) return { filmAlpha: 0, speckleAlpha: 0 };

  const period = resolveLowHealthPulsePeriodMs(state.intensity);
  const pulse = 1 + LOW_HEALTH_BLOOD_VFX.pulseAmplitude * Math.sin((state.pulsePhaseMs / period) * Math.PI * 2);

  const onset = LOW_HEALTH_BLOOD_VFX.onsetHpFraction;
  const speckleOnset = LOW_HEALTH_BLOOD_VFX.speckleOnsetHpFraction;
  // Die Spritzerschwelle steht in HP; sie wird über dieselbe Kurve in Intensität übersetzt,
  // damit beide Schichten denselben weichen Einstieg teilen.
  const speckleFloor = onset > 0 ? smoothstep(clamp01((onset - speckleOnset) / onset)) : 1;
  const speckleT = speckleFloor < 1
    ? clamp01((state.intensity - speckleFloor) / (1 - speckleFloor))
    : (state.intensity >= 1 ? 1 : 0);

  return {
    filmAlpha: Math.max(0, LOW_HEALTH_BLOOD_VFX.filmAlphaMax * state.intensity * pulse),
    speckleAlpha: Math.max(0, LOW_HEALTH_BLOOD_VFX.speckleAlphaMax * smoothstep(speckleT) * pulse),
  };
}
