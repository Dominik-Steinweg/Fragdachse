import { DEATH_DISINTEGRATION_VFX } from '../../config';

/** Instance-local presentation values. No mutation of production configuration. */
export type DeathSpawnTuning = { readonly [K in keyof typeof DEATH_DISINTEGRATION_VFX]: number };

export const DEATH_MORPH_TIMING = Object.freeze({
  frayedAt: 0.125, porousAt: 0.25, fragmentedAt: 0.3125, dustAt: 0.375,
  fineDustAt: 0.4375, hazeAt: 0.5, vaporAt: 0.875,
});
export type DeathMorphTiming = { readonly [K in keyof typeof DEATH_MORPH_TIMING]: number };
export type DeathTuning = DeathSpawnTuning & DeathMorphTiming;
export const DEATH_TUNING_DEFAULTS: DeathTuning = Object.freeze({
  ...DEATH_DISINTEGRATION_VFX, ...DEATH_MORPH_TIMING,
});

/** Reject incomplete phase order, non-finite values and expensive/unbounded previews atomically. */
export function resolveDeathTuning(patch: unknown, base: DeathTuning = DEATH_TUNING_DEFAULTS): DeathTuning {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('tuning: Objekt erwartet.');
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwnProperty.call(DEATH_TUNING_DEFAULTS, key)) throw new Error(`Unbekanntes Tuning: ${key}`);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2000) {
      throw new Error(`${key}: endliche Zahl zwischen 0 und 2000 erwartet.`);
    }
    // The template cache uses the production analysis grid, not this instance's preview values.
    if (['chunkSizePx', 'referenceDisplaySizePx', 'glowCount'].includes(key)
      && value !== DEATH_TUNING_DEFAULTS[key as keyof DeathTuning]) throw new Error(`${key}: im Lab unveränderlich.`);
    (result as Record<string, number>)[key] = value;
  }
  const phases = [0, ...Object.keys(DEATH_MORPH_TIMING).map(key => result[key as keyof DeathMorphTiming]), 1];
  if (phases.some((v, i) => i > 0 && v - phases[i - 1] < 0.01)) throw new Error('Morph-Phasen brauchen mindestens 0,01 Abstand.');
  if (result.durationMs < 300 || result.durationMs + result.lifetimeVarianceMs > 1500
    || result.durationMs - result.lifetimeVarianceMs < 100) throw new Error('Lebensdauer muss innerhalb 100–1500 ms liegen (Dauer mindestens 300 ms).');
  if (result.morphDesyncMaxScale < 1 || result.morphDesyncMaxScale > 2) throw new Error('morphDesyncMaxScale: 1–2 (One-Shot-Schutz).');
  for (const [min, max] of [['travelMinPx', 'travelMaxPx'], ['glowTravelMinPx', 'glowTravelMaxPx'],
    ['glowScaleMin', 'glowScaleMax'], ['microLifetimeMinMs', 'microLifetimeMaxMs']] as const) {
    if (result[min] > result[max]) throw new Error(`${min} darf ${max} nicht überschreiten.`);
  }
  if (result.microLifetimeMinMs < 100 || result.microLifetimeMaxMs > 1500) throw new Error('Micro-Lebensdauer: 100–1500 ms.');
  for (const key of ['alpha', 'auraTintMix', 'neutralTargetColorBoost', 'mainFragmentContrast',
    'glowAlpha', 'playerFragmentGlowRatio', 'playerFragmentGlowAlpha'] as const) {
    if (result[key] > 1) throw new Error(`${key}: 0–1.`);
  }
  for (const key of ['maxChunksPerEffect', 'playerFragmentGlowMaxCount'] as const) {
    if (!Number.isInteger(result[key]) || result[key] > 64) throw new Error(`${key}: ganze Zahl 0–64.`);
  }
  for (const key of ['scaleStart', 'scaleEnd', 'mainFragmentScaleBoost', 'playerFragmentGlowScale',
    'glowScaleMin', 'glowScaleMax', 'mainHitImpulse', 'microHitImpulse', 'glowHitImpulse'] as const) {
    if (result[key] > 4) throw new Error(`${key}: 0–4.`);
  }
  return Object.freeze(result);
}

export function deathPhaseBands(tuning: DeathTuning) {
  const fast = tuning.durationMs - tuning.lifetimeVarianceMs;
  const slow = Math.round((tuning.durationMs + tuning.lifetimeVarianceMs) * tuning.morphDesyncMaxScale) + 1;
  return Object.entries(DEATH_MORPH_TIMING).map(([name]) => ({ name,
    earliestMs: (fast + 1) * tuning[name as keyof DeathMorphTiming],
    latestMs: Math.min(tuning.durationMs + tuning.lifetimeVarianceMs, slow * tuning[name as keyof DeathMorphTiming]),
    nominalMs: (tuning.durationMs + 1) * tuning[name as keyof DeathMorphTiming],
  }));
}
