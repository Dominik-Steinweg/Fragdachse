import { describe, expect, it } from 'vitest';
import { HealthBarFeedbackModel, type HealthBarFeedbackTuning } from '../src/effects/health/HealthBarFeedbackModel';

// Test parameters describe timing relationships, not production tuning.
export const feedbackTuning: HealthBarFeedbackTuning = {
  damageHoldMs: 40, damageHalfLifeMs: 80, newEpisodeQuietMs: 120,
  visibleAfterDamageMs: 600, settleDistancePx: 0.1, healEmphasisMs: 100, healEmphasisStrength: 0.2,
};
function model(visibility: 'after-damage' | 'alive' | 'damaged' = 'after-damage') {
  const result = new HealthBarFeedbackModel(visibility, feedbackTuning);
  result.baseline(100, 100, 0);
  return result;
}

describe('HP feedback state and timing', () => {
  it('baselines injured entities without inventing damage, respecting each visibility profile', () => {
    for (const policy of ['after-damage', 'alive', 'damaged'] as const) {
      const m = model(policy);
      m.baseline(35, 100, 1);
      expect(m.trailHp).toBe(35);
      expect(m.healEmphasis(1)).toBe(0);
      expect(m.isVisible(1)).toBe(policy !== 'after-damage');
    }
  });

  it('identical refreshes do not extend the window; new damage does', () => {
    const m = model();
    m.observe(80, 100, 10, 100);
    const deadline = m.visibleUntil;
    for (let t = 20; t <= deadline + 100; t += 10) m.observe(80, 100, t, 100);
    expect(m.visibleUntil).toBe(deadline);
    expect(m.isVisible(deadline + 100)).toBe(false);
    m.observe(79, 100, deadline + 101, 100);
    expect(m.isVisible(deadline + 101)).toBe(true);
    expect(m.visibleUntil).toBeGreaterThan(deadline);
  });

  it('shortens HP immediately and integrates only the part of a frame after the hold', () => {
    const m = model();
    m.observe(60, 100, 10, 100);
    expect(m.hp).toBe(60);
    expect(m.trailHp).toBe(100);
    m.advance(10 + feedbackTuning.damageHoldMs, 100);
    expect(m.trailHp).toBe(100);
    m.advance(10 + feedbackTuning.damageHoldMs + feedbackTuning.damageHalfLifeMs, 100);
    expect(m.trailHp).toBeCloseTo(80);
  });

  it('retargets the old trajectory at the event time, independent of render frequency', () => {
    const coarse = model();
    const fine = model();
    for (const m of [coarse, fine]) m.observe(80, 100, 5, 100);
    for (let t = 10; t <= 190; t += 10) fine.advance(t, 100);
    coarse.advance(195, 100);
    const previousEnd = coarse.trailHp;
    for (const m of [coarse, fine]) m.observe(50, 100, 195, 100);
    expect(coarse.trailHp).toBe(previousEnd);
    expect(fine.trailHp).toBeCloseTo(previousEnd);
    for (let t = 200; t <= 290; t += 10) fine.advance(t, 100);
    coarse.advance(290, 100);
    expect(coarse.trailHp).toBeCloseTo(fine.trailHp);
    fine.advance(290, 100);
    expect(coarse.trailHp).toBeCloseTo(fine.trailHp);
  });

  it.each([0.02, 1])('handles continuous damage of %s HP without holds, overshoot or restarts', damage => {
    const m = model();
    let end = m.trailHp;
    for (let i = 1; i <= 40; i++) {
      const t = i * 15;
      m.observe(100 - damage * i, 100, t, 100);
      expect(m.trailHp).toBeLessThanOrEqual(end);
      expect(m.trailHp).toBeGreaterThanOrEqual(m.hp);
      end = m.trailHp;
    }
    expect(m.trailHp).toBeLessThan(100 - damage * 30);
    m.advance(20_000, 100);
    expect(m.trailHp).toBe(m.hp);
  });

  it('allows a new hold only after settling AND a quiet damage gap', () => {
    const m = model();
    m.observe(99.99, 100, 10, 100);
    m.advance(11, 100); // Subpixel damage settles even inside the first hold.
    m.observe(70, 100, 80, 100); // Not enough quiet time for another hold.
    m.advance(81, 100);
    expect(m.trailHp).toBeLessThan(99.99);
    m.advance(4000, 100);
    m.observe(50, 100, 4001, 100);
    m.advance(4002, 100);
    expect(m.trailHp).toBe(70);
  });

  it('heals immediately, cancels damage trail and uses a bounded refreshed emphasis', () => {
    const m = model();
    m.observe(50, 100, 10, 100);
    const deadline = m.visibleUntil;
    for (let t = 20; t < 60; t++) {
      m.observe(50 + (t - 19) / 2, 100, t, 100);
      expect(m.trailHp).toBe(m.hp);
      expect(m.healEmphasis(t)).toBeLessThanOrEqual(feedbackTuning.healEmphasisStrength);
      expect(m.visibleUntil).toBe(deadline);
    }
    expect(m.healEmphasis(200)).toBe(0);
    m.observe(100, 100, 201, 100);
    expect(m.isVisible(201)).toBe(false);
  });

  it('healing a hidden normal enemy never opens a damage window', () => {
    const m = model();
    m.baseline(50, 100, 0);
    m.observe(70, 100, 1, 100);
    expect(m.isVisible(1)).toBe(false);
    expect(m.healEmphasis(1)).toBe(0);
  });

  it('silently rebases max-HP, clamps and ambiguous simultaneous changes', () => {
    const m = model();
    m.observe(70, 100, 1, 100);
    const deadline = m.visibleUntil;
    for (const [hp, max] of [[70, 140], [70, 40], [20, 80]]) {
      m.observe(hp, max, 10, 100);
      expect(m.trailHp).toBe(Math.min(hp, max));
      expect(m.healEmphasis(10)).toBe(0);
      expect(m.visibleUntil).toBe(deadline);
    }
    m.baseline(10, 80, 20);
    expect(m.isVisible(20)).toBe(false);
  });

  it('suppression discards history and concealed changes, including recovery', () => {
    const m = model();
    m.observe(70, 100, 1, 100);
    m.setSuppressed(true, 2);
    m.observe(30, 100, 3, 100);
    m.setSuppressed(false, 4);
    expect(m.isVisible(4)).toBe(false);
    expect(m.trailHp).toBe(30);
    m.observe(29, 100, 5, 100);
    expect(m.isVisible(5)).toBe(true);
  });

  it('does not mistake a max-HP rebase during continuous damage for a quiet gap', () => {
    const m = model();
    m.observe(80, 100, 10, 100);
    m.observe(80, 120, 11, 100);
    m.observe(60, 120, 12, 100);
    m.advance(13, 100);
    expect(m.trailHp).toBeLessThan(80);
  });

  it('zero HP hides without preventing a lethal-guard rescue', () => {
    const m = model('alive');
    m.observe(0, 100, 1, 100);
    expect(m.isVisible(1)).toBe(false);
    m.observe(50, 100, 2, 100);
    expect(m.isVisible(2)).toBe(true);
    expect(m.hp).toBe(50);
    expect(m.trailHp).toBe(50);
  });

  it('uses the actual visible pixel width for settling', () => {
    const small = model(), zoomed = model();
    for (const m of [small, zoomed]) m.observe(99, 100, 1, 100);
    small.advance(2, 5);
    zoomed.advance(2, 100);
    expect(small.trailHp).toBe(99);
    expect(zoomed.trailHp).toBe(100);
  });
});
