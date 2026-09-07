import { describe, expect, it } from 'vitest';
import { BLOOD_HIT_VFX, HIT_FEEDBACK_VFX } from '../src/config';
import { HIT_FEEDBACK_TIMING, resolveHitFeedbackTiming, flashEnvelope, mixFlashColor, resolveFlashAction, resolveHitBand, resolveHitFlashProfile } from '../src/effects/hitFeedbackModel';

const hit = (damage: number, isCritical = false, isKill = false) => ({
  totalDamage: damage, hpLost: damage, armorLost: 0, isCritical, isKill,
});
const profile = (damage: number, crit = false) => resolveHitFlashProfile(hit(damage, crit));

describe('continuous hit intensity', () => {
  it('orders actual damage and crit accents without promoting bands', () => {
    const sequence = [profile(8), profile(10), profile(12, true), profile(40), profile(100), profile(150, true)];
    for (let i = 1; i < sequence.length; i++) {
      for (const field of ['intensity', 'alpha', 'joltPx'] as const) {
        expect(sequence[i][field]).toBeGreaterThan(sequence[i - 1][field]);
      }
    }
    expect(profile(12, true).intensity).toBeLessThan(profile(100).intensity * 0.6);
    for (const damage of [1, 8, 12, 40, 100]) {
      expect(profile(damage, true).band).toBe(profile(damage).band);
      expect(profile(damage, true).intensity).toBeGreaterThan(profile(damage).intensity);
      expect(profile(damage, true).band).not.toBe('lethal');
    }
  });
  it('has no visible steps at damage band boundaries', () => {
    for (const damage of [BLOOD_HIT_VFX.bands.light.maxDamage, BLOOD_HIT_VFX.bands.medium.maxDamage]) {
      for (const field of ['alpha', 'joltPx', 'durationMs', 'scaleBoost'] as const) {
        expect(Math.abs(profile(damage + 0.00001)[field] - profile(damage)[field])).toBeLessThan(0.0001);
      }
    }
  });
  it('keeps kill and armor semantics separate from body strength', () => {
    expect(resolveHitBand(1, 1, 0, true)).toBe('lethal');
    expect(resolveHitBand(100, 0, 100, false)).toBe('medium');
    expect(resolveHitFlashProfile(hit(8, false, true)).intensity).toBe(profile(8).intensity);
    expect(resolveHitFlashProfile(hit(8, false, true)).cameraKickPx).toBeGreaterThan(0);
  });
  it('rejects invalid damage and caps extreme inputs', () => {
    for (const damage of [0, -1, NaN, Infinity]) {
      const result = profile(damage);
      expect(result.alpha).toBe(0);
      expect(result.joltPx).toBe(0);
      expect(result.cameraKickPx).toBe(0);
    }
    const extreme = profile(Number.MAX_VALUE, true);
    expect(extreme.intensity).toBeLessThanOrEqual(1);
    expect(extreme.alpha).toBeLessThanOrEqual(1);
    expect(extreme.joltPx).toBeLessThanOrEqual(HIT_FEEDBACK_VFX.maxJoltPx);
    for (const value of Object.values(extreme)) if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
  });
  it('supports independent master controls and reusable output', () => {
    const base = profile(20);
    const globalOff = resolveHitFlashProfile(hit(20), { ...HIT_FEEDBACK_VFX, strength: 0 });
    expect(globalOff.alpha + globalOff.joltPx + globalOff.cameraKickPx).toBe(0);
    const flashOff = resolveHitFlashProfile(hit(20), { ...HIT_FEEDBACK_VFX, flashStrength: 0 });
    expect(flashOff.alpha).toBe(0);
    expect(flashOff.scaleBoost).toBe(1);
    expect(flashOff.joltPx).toBe(base.joltPx);
    const joltOff = resolveHitFlashProfile(hit(20), { ...HIT_FEEDBACK_VFX, joltStrength: 0 });
    expect(joltOff.joltPx).toBe(0);
    expect(joltOff.alpha).toBe(base.alpha);
    expect(resolveHitFlashProfile(hit(30), HIT_FEEDBACK_VFX, base)).toBe(base);
    expect(resolveHitFlashProfile(hit(20), { ...HIT_FEEDBACK_VFX, strength: 2 }).intensity).toBeGreaterThan(profile(20).intensity);
  });

  it('scales time independently of brightness and keeps safety limits outside the full pulse', () => {
    const base = profile(100);
    const longer = resolveHitFlashProfile(hit(100), { ...HIT_FEEDBACK_VFX, durationMs: HIT_FEEDBACK_VFX.durationMs * 2 });
    expect(longer.durationMs).toBeCloseTo(base.durationMs * 2);
    expect(longer.joltMs).toBeCloseTo(base.joltMs * 2);
    expect(longer.alpha).toBe(base.alpha);
    expect(longer.joltPx).toBe(base.joltPx);
    expect(longer.intensity).toBe(base.intensity);
    for (const durationMs of [60, 220, 440, 600, NaN, Infinity, -1]) {
      const timing = resolveHitFeedbackTiming(durationMs);
      const result = resolveHitFlashProfile(hit(Number.MAX_VALUE), { ...HIT_FEEDBACK_VFX, durationMs });
      expect(result.durationMs).toBeLessThan(timing.maxRearmLifetimeMs - timing.fadeMs);
      expect(timing.darkMs).toBeGreaterThan(0);
      expect(Number.isFinite(result.durationMs)).toBe(true);
    }
  });
});

describe('flash pulse policy', () => {
  const state = { intensity: 0.3, ageMs: 1, totalLifeMs: 1, darkRemainingMs: 0 };
  it('accepts upgrades but never bypasses lifetime or darkness', () => {
    expect(resolveFlashAction(null, 0.3)).toBe('spawn');
    expect(resolveFlashAction(state, 0.3)).toBe('skip');
    expect(resolveFlashAction(state, 0.4)).toBe('rearm');
    expect(resolveFlashAction({ ...state, ageMs: HIT_FEEDBACK_TIMING.refractoryMs }, 0.3)).toBe('rearm');
    expect(resolveFlashAction({ ...state, totalLifeMs: HIT_FEEDBACK_TIMING.maxRearmLifetimeMs }, 1)).toBe('skip');
    expect(resolveFlashAction({ ...state, darkRemainingMs: 1 }, 1)).toBe('skip');
  });
  it('starts at full brightness and fades monotonically to zero', () => {
    expect(flashEnvelope(0)).toBe(1);
    let previous = 1;
    for (let t = 0; t <= 1; t += 0.01) {
      expect(flashEnvelope(t)).toBeLessThanOrEqual(previous);
      previous = flashEnvelope(t);
    }
    expect(flashEnvelope(1)).toBe(0);
  });
  it('mixes material color toward white', () => {
    expect(mixFlashColor(0x3366cc, 0)).toBe(0x3366cc);
    expect(mixFlashColor(0x3366cc, 1)).toBe(0xffffff);
    expect(mixFlashColor(0x3366cc, -1)).toBe(0x3366cc);
    expect(mixFlashColor(0x3366cc, 5)).toBe(0xffffff);
  });
});
