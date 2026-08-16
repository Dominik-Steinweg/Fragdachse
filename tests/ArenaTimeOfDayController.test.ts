import { describe, expect, it } from 'vitest';
import type { CoopDefenseDynamicTimeOfDayConfig } from '../src/config/coopDefenseMaps';
import { ArenaTimeOfDayController } from '../src/systems/ArenaTimeOfDayController';

const ROUND_START = 10_000;

function controller(dynamic?: CoopDefenseDynamicTimeOfDayConfig, startMinutes = 12 * 60) {
  return new ArenaTimeOfDayController({
    startMinutes,
    roundStartTime: ROUND_START,
    dynamic,
    bossSpawnAtMs: 2_500,
  });
}

describe('ArenaTimeOfDayController', () => {
  it('keeps maps without dynamic config exactly static', () => {
    const clock = controller();
    expect(clock.sample(ROUND_START - 5_000).minutes).toBe(720);
    expect(clock.sample(ROUND_START + 999_999).minutes).toBe(720);
    expect(clock.isDynamic()).toBe(false);
  });

  it('derives the map-0 endless cycle directly from synchronized time', () => {
    const clock = controller({ minutesPerSecond: 6 });
    expect(clock.sample(ROUND_START).minutes).toBe(720);
    expect(clock.sample(ROUND_START + 120_000).minutes).toBe(0);
    expect(clock.sample(ROUND_START + 240_000).minutes).toBe(720);
    expect(clock.sample(ROUND_START + 360_000).minutes).toBe(0);
  });

  it('preserves fractional runtime minutes', () => {
    expect(controller({ minutesPerSecond: 6 }).sample(ROUND_START + 250).minutes).toBe(721.5);
  });

  it('starts the smooth forward boss-spawn transition only after the boss is observed', () => {
    const clock = controller({
      transitions: [{
        start: { type: 'boss-spawn' },
        targetTimeOfDay: '21:30',
        durationMs: 2_800,
      }],
    }, 19 * 60);

    expect(clock.sample(ROUND_START + 3_900).minutes).toBe(19 * 60);
    const signals = { bossSpawnedAtMs: ROUND_START + 2_500 };
    expect(clock.sample(ROUND_START + 3_900, signals).minutes).toBe(20 * 60 + 15);
    expect(clock.sample(ROUND_START + 5_300, signals).minutes).toBe(21 * 60 + 30);
    expect(clock.sample(ROUND_START + 80_000, signals).minutes).toBe(21 * 60 + 30);
  });

  it('interpolates target times forward across midnight', () => {
    const clock = controller({
      transitions: [{
        start: { type: 'time', atMs: 0 },
        targetTimeOfDay: '01:00',
        durationMs: 2_000,
      }],
    }, 23 * 60);
    expect(clock.sample(ROUND_START + 1_000).minutes).toBe(0);
  });

  it('applies replicated boss phases as immediate late-join-safe states', () => {
    const dynamic: CoopDefenseDynamicTimeOfDayConfig = {
      transitions: [{
        start: { type: 'boss-phase', phase: 2 },
        targetTimeOfDay: '23:30',
        durationMs: 0,
      }],
    };
    const clock = controller(dynamic, 21 * 60 + 30);
    expect(clock.sample(ROUND_START + 30_000, { bossPhase: 1 }).minutes).toBe(21 * 60 + 30);
    const phaseTwo = clock.sample(ROUND_START + 30_001, { bossPhase: 2 });
    expect(phaseTwo.minutes).toBe(23 * 60 + 30);
    expect(phaseTwo.transitionCompleted).toBe(true);
    expect(clock.sample(ROUND_START + 30_002, { bossPhase: 2 }).transitionCompleted).toBe(false);
  });

  it('keeps a local override while automatic time advances and resumes current auto on clear', () => {
    const clock = controller({ minutesPerSecond: 6 });
    clock.sample(ROUND_START + 10_000);
    clock.setDebugOverride(5 * 60);
    expect(clock.sample(ROUND_START + 20_000).minutes).toBe(5 * 60);
    expect(clock.getAutomaticMinutes()).toBe(14 * 60);
    clock.clearDebugOverride();
    expect(clock.getCurrentMinutes()).toBe(14 * 60);
  });
});
