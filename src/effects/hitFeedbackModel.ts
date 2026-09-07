/** Pure presentation rules. Bands label camera/kill semantics, never flash/jolt intensity. */
import { BLOOD_HIT_VFX, HIT_FEEDBACK_VFX } from '../config';
import type { SyncedHitEffect } from '../types';

export type HitBand = 'light' | 'medium' | 'heavy' | 'lethal';
export type FlashAction = 'spawn' | 'rearm' | 'skip';
export interface HitFeedbackTuning {
  readonly strength: number;
  readonly flashStrength: number;
  readonly joltStrength: number;
  readonly durationMs: number;
}
export interface HitFlashProfile {
  band: HitBand;
  intensity: number;
  alpha: number;
  durationMs: number;
  scaleBoost: number;
  whiteMix: number;
  joltPx: number;
  joltMs: number;
  cameraKickPx: number;
}
export interface ActiveFlashState {
  readonly intensity: number;
  readonly ageMs: number;
  readonly totalLifeMs: number;
  readonly darkRemainingMs: number;
}

export function resolveHitBand(totalDamage: number, hpLost: number, armorLost: number, isKill: boolean): HitBand {
  if (isKill) return 'lethal';
  const damage = Number.isFinite(totalDamage) ? totalDamage : 0;
  if (damage <= BLOOD_HIT_VFX.bands.light.maxDamage) return 'light';
  if (damage <= BLOOD_HIT_VFX.bands.medium.maxDamage || (hpLost <= 0 && armorLost > 0)) return 'medium';
  return 'heavy';
}

const positive = (value: number): number => Number.isFinite(value) && value > 0 ? value : 0;

const feedbackDuration = (value: number): number =>
  Number.isFinite(value) ? Math.max(60, Math.min(600, value)) : 220;

/** One time master; safety limits must grow with the pulse instead of clipping it. */
export function resolveHitFeedbackTiming(durationMs = HIT_FEEDBACK_VFX.durationMs as number) {
  const duration = feedbackDuration(durationMs);
  return {
    refractoryMs: duration * 0.35,
    maxRearmLifetimeMs: duration * 1.6,
    darkMs: duration * 0.25,
    fadeMs: duration * 0.3,
  };
}

// Computed once, not allocated per hit or per frame.
export const HIT_FEEDBACK_TIMING = resolveHitFeedbackTiming();

/** Optional output lets the renderer reuse one scratch profile for every hit. */
export function resolveHitFlashProfile(
  hit: Pick<SyncedHitEffect, 'totalDamage' | 'hpLost' | 'armorLost' | 'isKill' | 'isCritical'>,
  tuning: HitFeedbackTuning = HIT_FEEDBACK_VFX,
  out: HitFlashProfile = {} as HitFlashProfile,
): HitFlashProfile {
  const damage = positive(hit.totalDamage);
  const strength = positive(tuning.strength);
  const intensity = -Math.expm1(-strength * (damage / 100) ** 0.6 * (hit.isCritical ? 1.08 : 1));
  const flash = positive(tuning.flashStrength);
  const jolt = positive(tuning.joltStrength);
  const f = Math.min(1, intensity * flash);
  out.band = resolveHitBand(damage, hit.hpLost, hit.armorLost, hit.isKill);
  out.intensity = intensity;
  out.alpha = intensity > 0 && flash > 0 ? Math.min(0.95, (0.45 + intensity * 0.5) * flash) : 0;
  const duration = feedbackDuration(tuning.durationMs);
  out.durationMs = duration * (0.85 + 0.35 * intensity);
  out.scaleBoost = 1 + 0.06 * f;
  out.whiteMix = 0.9 + 0.1 * f;
  out.joltPx = intensity > 0 ? Math.min(HIT_FEEDBACK_VFX.maxJoltPx, (1 + 10 * intensity) * jolt) : 0;
  out.joltMs = duration * (0.55 + 0.2 * intensity);
  // Existing camera/kill choreography stays separate from the body response.
  out.cameraKickPx = intensity <= 0 ? 0 : out.band === 'lethal' ? 7 : out.band === 'heavy' ? 4 : 0;
  return out;
}

export function mixFlashColor(materialColor: number, whiteMix: number): number {
  const t = Math.max(0, Math.min(1, whiteMix));
  const r = (materialColor >> 16) & 0xff;
  const g = (materialColor >> 8) & 0xff;
  const b = materialColor & 0xff;
  return (Math.round(r + (255 - r) * t) << 16)
    | (Math.round(g + (255 - g) * t) << 8) | Math.round(b + (255 - b) * t);
}

/** A readable plateau followed by a smooth fade, rather than losing most energy immediately. */
export function flashEnvelope(t: number): number {
  if (t <= 0.35) return 1;
  if (t >= 1) return 0;
  const u = (t - 0.35) / 0.65;
  return 1 - u * u * (3 - 2 * u);
}

/** Lifetime and darkness take precedence even over arbitrarily strong incoming hits. */
export function resolveFlashAction(existing: ActiveFlashState | null, incoming: number): FlashAction {
  if (!existing) return 'spawn';
  if (existing.darkRemainingMs > 0 || existing.totalLifeMs >= HIT_FEEDBACK_TIMING.maxRearmLifetimeMs) return 'skip';
  if (incoming > existing.intensity || existing.ageMs >= HIT_FEEDBACK_TIMING.refractoryMs) return 'rearm';
  return 'skip';
}
