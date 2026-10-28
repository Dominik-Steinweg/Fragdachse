import { describe, expect, it } from 'vitest';
import { EnemySpitPlayback, heatBurstClipFrame } from '../src/animations/EnemyHeatBurstAnimation';
import type { EnemyHeatBurstState } from '../src/systems/EnemyHeatBurstState';

const burst = { frames: [40, 41, 42, 43, 44, 45, 46, 47], markers: { blast: 2 }, frameRate: 24 };
const spit = { frames: [60, 61, 62, 63, 64, 65, 66, 67, 68, 69], markers: { release: 3 }, frameRate: 24 };
const FRAME_MS = 1000 / 24;
const clips = (name: string) => name === 'burst' ? burst : undefined;

describe('heat burst clips', () => {
  it('lands the burst marker on the replicated burst moment and keeps the tail after the next cycle arrives', () => {
    const booked: EnemyHeatBurstState = { revision: 4, ventFromAt: 0, chargeStartAt: 0, fullAt: 5000, telegraphAt: 5100, burstAt: 6000 };
    expect(heatBurstClipFrame(booked, 5000, clips)).toBeNull();
    expect(heatBurstClipFrame(booked, 6000 - 2 * FRAME_MS, clips)).toBe(40);
    expect(heatBurstClipFrame(booked, 6000, clips)).toBe(42);
    const next: EnemyHeatBurstState = { revision: 5, ventFromAt: 6000, chargeStartAt: 6400, fullAt: 11400, telegraphAt: 0, burstAt: 0 };
    expect(heatBurstClipFrame(next, 6000 + 3 * FRAME_MS + 1, clips)).toBe(45);
    expect(heatBurstClipFrame(next, 6000 + 7 * FRAME_MS, clips)).toBeNull();
    // Sheets without the clip show no recoil.
    expect(heatBurstClipFrame(booked, 6000, () => undefined)).toBeNull();
  });

  it('plays one spit gesture per burst, its release meeting the first flame', () => {
    const playback = new EnemySpitPlayback();
    expect(playback.frame(spit, 0)).toBeNull();
    playback.flame(1000);
    expect(playback.frame(spit, 1000)).toBe(63);
    playback.flame(1050);
    expect(playback.frame(spit, 1000 + 2 * FRAME_MS + 1)).toBe(65);
    expect(playback.frame(spit, 1000 + 7 * FRAME_MS + 1)).toBeNull();
    playback.flame(3000);
    expect(playback.frame(spit, 3000)).toBe(63);
  });
});
