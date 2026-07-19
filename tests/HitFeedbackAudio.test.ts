import { describe, expect, it } from 'vitest';
import { getHitFeedbackVolumeScale } from '../src/audio/HitFeedbackAudio';

describe('hit feedback audio', () => {
  it('scales damage feedback around 20 damage and caps large bursts', () => {
    const quietHit = getHitFeedbackVolumeScale(1);
    const normalHit = getHitFeedbackVolumeScale(20);
    const heavyHit = getHitFeedbackVolumeScale(100);

    expect(quietHit).toBeLessThan(0.5);
    expect(normalHit).toBe(1);
    expect(heavyHit).toBeGreaterThan(normalHit);
    expect(heavyHit).toBeLessThan(1.5);
  });

  it('makes twenty one-damage hits equivalent to one twenty-damage hit', () => {
    expect(getHitFeedbackVolumeScale(20 * 1)).toBe(getHitFeedbackVolumeScale(20));
  });
});