import { describe, expect, it } from 'vitest';
import { LOW_HEALTH_BLOOD_VFX } from '../src/config';
import {
  NEUTRAL_LOW_HEALTH_BLOOD_STATE,
  resolveLowHealthBloodAlphas,
  resolveLowHealthBloodTarget,
  resolveLowHealthPulsePeriodMs,
  stepLowHealthBlood,
  type LowHealthBloodState,
} from '../src/effects/lowHealthBloodModel';

/** Faehrt das Modell so lange fort, bis die Intensitaet praktisch am Ziel steht. */
function settle(hpFraction: number, frames = 400, deltaMs = 16): LowHealthBloodState {
  let state = NEUTRAL_LOW_HEALTH_BLOOD_STATE;
  for (let i = 0; i < frames; i += 1) state = stepLowHealthBlood(state, hpFraction, deltaMs);
  return state;
}

describe('resolveLowHealthBloodTarget', () => {
  it('bleibt oberhalb der Schwelle vollstaendig aus', () => {
    expect(resolveLowHealthBloodTarget(1)).toBe(0);
    expect(resolveLowHealthBloodTarget(LOW_HEALTH_BLOOD_VFX.onsetHpFraction)).toBe(0);
    expect(resolveLowHealthBloodTarget(LOW_HEALTH_BLOOD_VFX.onsetHpFraction + 0.1)).toBe(0);
  });

  it('waechst monoton zur Null-Gesundheit hin', () => {
    const steps = [0.45, 0.35, 0.25, 0.15, 0.05, 0];
    for (let i = 1; i < steps.length; i += 1) {
      expect(resolveLowHealthBloodTarget(steps[i]))
        .toBeGreaterThan(resolveLowHealthBloodTarget(steps[i - 1]));
    }
    expect(resolveLowHealthBloodTarget(0)).toBe(1);
  });

  it('faengt unsinnige Eingaben ab', () => {
    expect(resolveLowHealthBloodTarget(Number.NaN)).toBe(1);
    expect(resolveLowHealthBloodTarget(-5)).toBe(1);
    expect(resolveLowHealthBloodTarget(12)).toBe(0);
  });
});

describe('stepLowHealthBlood', () => {
  it('faellt bei voller Gesundheit auf den neutralen Zustand zurueck', () => {
    expect(settle(1)).toBe(NEUTRAL_LOW_HEALTH_BLOOD_STATE);
  });

  it('steigt schneller als es faellt', () => {
    const hurtStep = stepLowHealthBlood(NEUTRAL_LOW_HEALTH_BLOOD_STATE, 0, 100);
    const healedStep = stepLowHealthBlood({ intensity: 1, pulsePhaseMs: 0 }, 1, 100);
    expect(hurtStep.intensity).toBeGreaterThan(1 - healedStep.intensity);
  });

  it('erreicht bei null Gesundheit die volle Staerke', () => {
    expect(settle(0).intensity).toBeGreaterThan(0.99);
  });

  it('setzt die Pulsphase zurueck, sobald der Effekt aus ist', () => {
    const active = settle(0);
    expect(active.pulsePhaseMs).toBeGreaterThanOrEqual(0);

    let state = active;
    for (let i = 0; i < 400; i += 1) state = stepLowHealthBlood(state, 1, 16);
    expect(state.pulsePhaseMs).toBe(0);
    expect(state.intensity).toBe(0);
  });

  it('ignoriert einen Zeitschritt von null', () => {
    const state = settle(0.2);
    expect(stepLowHealthBlood(state, 0.2, 0).intensity).toBeCloseTo(state.intensity, 10);
  });
});

describe('resolveLowHealthBloodAlphas', () => {
  it('ist ohne Intensitaet vollstaendig unsichtbar', () => {
    expect(resolveLowHealthBloodAlphas(NEUTRAL_LOW_HEALTH_BLOOD_STATE))
      .toEqual({ filmAlpha: 0, speckleAlpha: 0 });
  });

  /** Der Rand bleibt Rahmen, nie Schleier – auch nicht auf dem Puls-Hochpunkt. */
  it('bleibt in jeder Pulsphase deutlich unter voller Deckkraft', () => {
    const filmCeiling = LOW_HEALTH_BLOOD_VFX.filmAlphaMax * (1 + LOW_HEALTH_BLOOD_VFX.pulseAmplitude);
    const speckleCeiling = LOW_HEALTH_BLOOD_VFX.speckleAlphaMax * (1 + LOW_HEALTH_BLOOD_VFX.pulseAmplitude);

    for (let phase = 0; phase < 1400; phase += 25) {
      const alphas = resolveLowHealthBloodAlphas({ intensity: 1, pulsePhaseMs: phase });
      expect(alphas.filmAlpha).toBeLessThanOrEqual(filmCeiling + 1e-9);
      expect(alphas.speckleAlpha).toBeLessThanOrEqual(speckleCeiling + 1e-9);
      expect(alphas.filmAlpha).toBeGreaterThan(0);
    }
    expect(filmCeiling).toBeLessThan(0.6);
  });

  it('zeigt Spritzer erst im kritischen Bereich, die Flaeche aber schon vorher', () => {
    const early = resolveLowHealthBloodAlphas(settle(LOW_HEALTH_BLOOD_VFX.onsetHpFraction - 0.05));
    expect(early.filmAlpha).toBeGreaterThan(0);
    expect(early.speckleAlpha).toBe(0);

    const critical = resolveLowHealthBloodAlphas(settle(0.05));
    expect(critical.speckleAlpha).toBeGreaterThan(0);
    expect(critical.speckleAlpha).toBeLessThan(critical.filmAlpha);
  });
});

describe('resolveLowHealthPulsePeriodMs', () => {
  it('schlaegt im kritischen Bereich schneller', () => {
    expect(resolveLowHealthPulsePeriodMs(1)).toBeLessThan(resolveLowHealthPulsePeriodMs(0));
    expect(resolveLowHealthPulsePeriodMs(0)).toBe(LOW_HEALTH_BLOOD_VFX.pulsePeriodOnsetMs);
    expect(resolveLowHealthPulsePeriodMs(1)).toBe(LOW_HEALTH_BLOOD_VFX.pulsePeriodCriticalMs);
  });
});
