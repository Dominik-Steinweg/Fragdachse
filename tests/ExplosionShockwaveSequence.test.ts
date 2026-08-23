import { describe, expect, it } from 'vitest';
import {
  EXPLOSION_SHOCKWAVE_DURATION_MS,
  EXPLOSION_SHOCKWAVE_MIN_RADIUS_PX,
  createExplosionShockwaveSequence,
  resolveExplosionShockwaveFrame,
  shouldStartExplosionShockwave,
} from '../src/effects/distortion/ExplosionShockwaveSequence';
import { DISTORTION_PRIORITY } from '../src/effects/distortion/distortionFramePlanner';

describe('explosion shockwave sequence', () => {
  it('starts only at the physical 128 px threshold', () => {
    expect(shouldStartExplosionShockwave('default', EXPLOSION_SHOCKWAVE_MIN_RADIUS_PX - 1)).toBe(false);
    expect(shouldStartExplosionShockwave('default', EXPLOSION_SHOCKWAVE_MIN_RADIUS_PX)).toBe(true);
    expect(shouldStartExplosionShockwave('train', 180)).toBe(true);
    expect(shouldStartExplosionShockwave('energy', 180)).toBe(false);
    expect(shouldStartExplosionShockwave('nuke', 750)).toBe(false);
  });

  it('expands from 0.35x to 1.25x with a centered strength peak', () => {
    const sequence = createExplosionShockwaveSequence(3, 10, 20, 200, 'default');
    expect(resolveExplosionShockwaveFrame(sequence)?.radiusPx).toBeCloseTo(70);
    expect(resolveExplosionShockwaveFrame(sequence)?.strength).toBeCloseTo(0);

    sequence.elapsedMs = EXPLOSION_SHOCKWAVE_DURATION_MS / 2;
    const peak = resolveExplosionShockwaveFrame(sequence)!;
    expect(peak.radiusPx).toBeCloseTo(160);
    expect(peak.strength).toBeCloseTo(0.22);
    expect(peak.priority).toBe(DISTORTION_PRIORITY.shockwave);
    expect(peak.profile).toBe('ring');

    sequence.elapsedMs = EXPLOSION_SHOCKWAVE_DURATION_MS;
    expect(resolveExplosionShockwaveFrame(sequence)).toBeNull();
  });

  it('uses the stronger train peak without changing duration or priority', () => {
    const sequence = createExplosionShockwaveSequence(4, 0, 0, 160, 'train');
    sequence.elapsedMs = EXPLOSION_SHOCKWAVE_DURATION_MS / 2;
    const peak = resolveExplosionShockwaveFrame(sequence)!;
    expect(peak.strength).toBeCloseTo(0.3);
    expect(peak.priority).toBe(DISTORTION_PRIORITY.shockwave);
  });
});
