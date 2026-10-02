import { DEATH_DISINTEGRATION_VFX } from '../../config';

/** Instance-local presentation values. No mutation of production configuration. */
export type DeathSpawnTuning = { readonly [K in keyof typeof DEATH_DISINTEGRATION_VFX]: number };

export const C1_DEATH_MORPH_TIMING = Object.freeze({
  frayedAt: 0.125, porousAt: 0.25, fragmentedAt: 0.3125, dustAt: 0.375,
  fineDustAt: 0.4375, hazeAt: 0.5, vaporAt: 0.875,
});
export const DEATH_MORPH_TIMING = Object.freeze({
  frayedAt: 0.125, porousAt: 0.22, fragmentedAt: 0.30, dustAt: 0.44,
  fineDustAt: 0.54, hazeAt: 0.64, vaporAt: 0.875,
});
export type DeathMorphTiming = { readonly [K in keyof typeof DEATH_MORPH_TIMING]: number };
const MATERIAL_DEFAULTS = Object.freeze({
  legacyMorph: 0, dissolveWindowMs: 150, grainRadiusPx: 1.25, grainDriftPx: 4.8,
  grainAlpha: 0.82, dustBodyAlpha: 0.45, dustBodyRadiusPx: 3, hazeGrowth: 1.7, hazeAlpha: 0.32,
  darkFragmentAlpha: 0.08, darkFragmentCutoff: 0.42, microAlpha: 0.75,
  grainOrganic: 1, grainSeed: 713, grainSpacingPx: 3.1, grainJitter: 1,
  grainSizeVariance: 0.55, grainEdgeRelease: 0.7, grainEdgeDrift: 0.6,
  grainFlowBias: 0.65, grainRoughness: 0.18,
});
export type DeathMaterialTuning = { readonly [K in keyof typeof MATERIAL_DEFAULTS]: number };
export type DeathTuning = DeathSpawnTuning & DeathMorphTiming & DeathMaterialTuning;
export const DEATH_TUNING_DEFAULTS: DeathTuning = Object.freeze({
  ...DEATH_DISINTEGRATION_VFX, ...DEATH_MORPH_TIMING, ...MATERIAL_DEFAULTS,
  microLifetimeMinMs: 860, microLifetimeMaxMs: 1120, morphDesyncMaxScale: 1.16,
});
/** Exact C1 reference for lab A and the original spawn-byte regression, never the runtime default. */
export const C1_DEATH_TUNING: DeathTuning = Object.freeze({
  ...DEATH_DISINTEGRATION_VFX, ...C1_DEATH_MORPH_TIMING, ...MATERIAL_DEFAULTS,
  legacyMorph: 1, darkFragmentAlpha: 1, microAlpha: 1,
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
  if (![0, 1].includes(result.legacyMorph)) throw new Error('legacyMorph: 0 oder 1.');
  if (![0, 1].includes(result.grainOrganic)) throw new Error('grainOrganic: 0 oder 1.');
  if (!Number.isInteger(result.grainSeed)) throw new Error('grainSeed: ganze Zahl 0–2000.');
  if (result.grainSpacingPx < 2 || result.grainSpacingPx > 5) throw new Error('grainSpacingPx: 2–5.');
  if (result.grainSizeVariance > 0.65 || result.grainRoughness > 0.4) throw new Error('Groessenvarianz: 0–0.65; Formrauschen: 0–0.4.');
  if (result.dissolveWindowMs < 60 || result.dissolveWindowMs > 300) throw new Error('dissolveWindowMs: 60–300 ms.');
  if (!result.legacyMorph && result.dissolveWindowMs > (result.dustAt - result.fragmentedAt) * result.durationMs) {
    throw new Error('Zerfallsfenster muss zwischen fragmentedAt und dustAt passen.');
  }
  if (result.grainRadiusPx < 0.8 || result.grainRadiusPx > 2.5 || result.grainDriftPx > 8
    || result.hazeGrowth < 1 || result.hazeGrowth > 2.5) throw new Error('Kornradius: 0.8–2.5; Drift: 0–8; Haze-Wachstum: 1–2.5.');
  if (result.dustBodyRadiusPx < 2 || result.dustBodyRadiusPx > 4) throw new Error('dustBodyRadiusPx: 2–4.');
  if (result.darkFragmentCutoff < 0.05 || result.darkFragmentCutoff > 1) throw new Error('darkFragmentCutoff: 0.05–1.');
  for (const key of ['alpha', 'auraTintMix', 'neutralTargetColorBoost', 'mainFragmentContrast',
    'glowAlpha', 'playerFragmentGlowRatio', 'playerFragmentGlowAlpha', 'darkFragmentAlpha',
    'microAlpha', 'grainAlpha', 'dustBodyAlpha', 'hazeAlpha', 'grainJitter',
    'grainEdgeRelease', 'grainEdgeDrift', 'grainFlowBias'] as const) {
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

/** Dark sprite texels must not become opaque rectangular plates. Keep their hue, reduce coverage. */
export function deathFragmentOpacity(color: number, tuning: DeathTuning): number {
  const brightness = Math.max(color >>> 16 & 255, color >>> 8 & 255, color & 255) / 255;
  const t = Math.max(0, Math.min(1, (brightness / tuning.darkFragmentCutoff - 0.5) * 2));
  return tuning.darkFragmentAlpha + (1 - tuning.darkFragmentAlpha) * t * t * (3 - 2 * t);
}

export function deathPhaseBands(tuning: DeathTuning) {
  const fast = tuning.durationMs - tuning.lifetimeVarianceMs;
  const slow = Math.round((tuning.durationMs + tuning.lifetimeVarianceMs) * tuning.morphDesyncMaxScale) + 1;
  const bands = Object.entries(DEATH_MORPH_TIMING).map(([name]) => ({ name,
    earliestMs: (fast + 1) * tuning[name as keyof DeathMorphTiming],
    latestMs: Math.min(tuning.durationMs + tuning.lifetimeVarianceMs, slow * tuning[name as keyof DeathMorphTiming]),
    nominalMs: (tuning.durationMs + 1) * tuning[name as keyof DeathMorphTiming],
  }));
  if (!tuning.legacyMorph) {
    const phase = tuning.dustAt - tuning.dissolveWindowMs / tuning.durationMs;
    bands.push({ name: 'dissolveStart', earliestMs: (fast + 1) * phase,
      latestMs: slow * phase, nominalMs: (tuning.durationMs + 1) * phase });
  }
  return bands.sort((a, b) => a.nominalMs - b.nominalMs);
}
