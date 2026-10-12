import { describe, expect, it } from 'vitest';
import { EnemyCastPlayback } from '../src/animations/EnemyCastAnimation';

const clip = { frames: [25, 26, 27, 28, 29, 30, 31, 32, 33, 34], markers: { aim: 3, release: 4 } };
const sample = (playback: EnemyCastPlayback, action: string, progress: number, now: number, blocked = false) =>
  playback.frame(clip, action, progress, now, 500, 150, blocked);

describe('enemy cast presentation', () => {
  it('advances between snapshots and holds the aim marker throughout commit', () => {
    const p = new EnemyCastPlayback();
    expect(sample(p, 'fire-lance-charge', 0, 0)).toBe(25);
    expect(sample(p, 'fire-lance-charge', .2, 100)).toBe(25);
    expect(sample(p, 'fire-lance-charge', .2, 200)).toBe(26);
    expect(sample(p, 'fire-lance-charge', .7, 350)).toBe(28);
    expect(sample(p, 'fire-lance-charge', .7, 480)).toBe(28);
    expect(sample(p, 'fire-lance-charge', 1, 500)).toBe(28);
  });
  it('plays release through the last frame for 200 ms, then yields to locomotion', () => {
    const p = new EnemyCastPlayback();
    sample(p, 'fire-lance-charge', 1, 500);
    expect(sample(p, 'none', 0, 510)).toBe(29);
    expect(sample(p, 'none', 0, 610)).toBe(32);
    expect(sample(p, 'none', 0, 709)).toBe(34);
    expect(sample(p, 'none', 0, 710)).toBeNull();
    expect(sample(p, 'none', 0, 720)).toBeNull();
  });
  it('uses a shorter aim-to-end gesture for an orb and lets charge take priority', () => {
    const p = new EnemyCastPlayback();
    p.orb(100);
    expect(sample(p, 'none', 0, 100)).toBe(28);
    expect(sample(p, 'none', 0, 239)).toBe(34);
    expect(sample(p, 'none', 0, 240)).toBeNull();
    sample(p, 'fire-lance-charge', .7, 300);
    p.orb(310);
    expect(sample(p, 'fire-lance-charge', .7, 310)).toBe(28);
  });
  it('cancels on higher-priority claw/death/burrow and does not queue a stale release', () => {
    const p = new EnemyCastPlayback();
    sample(p, 'fire-lance-charge', .7, 300);
    expect(sample(p, 'fire-lance-charge', .7, 310, true)).toBeNull();
    expect(sample(p, 'none', 0, 500)).toBeNull();
    p.orb(600);
    expect(sample(p, 'other-action', 0, 610)).toBeNull();
    expect(sample(p, 'none', 0, 620)).toBeNull();
  });
  it('is safe for placeholder assets with missing clips or markers', () => {
    const p = new EnemyCastPlayback();
    p.orb(0);
    expect(p.frame(undefined, 'fire-lance-charge', .5, 0, 500, 150)).toBeNull();
    expect(p.frame({ frames: [0] }, 'none', 0, 0, 500, 150)).toBeNull();
    expect(sample(p, 'none', 0, 1)).toBeNull();
  });
});
