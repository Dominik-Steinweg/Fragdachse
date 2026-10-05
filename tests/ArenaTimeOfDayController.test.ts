import { describe, expect, it } from 'vitest';
import { normalizeCoopDefenseMapConfig, type CoopDefenseDynamicTimeOfDayConfig } from '../src/config/coopDefenseMaps';
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
  function authoredController(dynamicTimeOfDay: CoopDefenseDynamicTimeOfDayConfig) {
    const map = normalizeCoopDefenseMapConfig({
      mapId: 'time-transition-contract', objective: 'defeat-boss', balanceReferenceDurationSec: 60,
      bases: [{ id: 'main', hpMax: 100, anchor: { kind: 'grid', gridX: 10, gridY: 10 },
        shape: { kind: 'rectangle', widthCells: 1, heightCells: 1 } }],
      powerUps: [], boss: { enemyKind: 'inferno-colossus', spawnAtMs: 2_500 }, dynamicTimeOfDay,
    });
    return controller(map.dynamicTimeOfDay);
  }

  it('reports serialized overlapping transitions only at their effective completion', () => {
    const clock = authoredController({ transitions: [
      { start: { type: 'time', atMs: 0 }, targetTimeOfDay: '18:00', durationMs: 1_000 },
      { start: { type: 'time', atMs: 500 }, targetTimeOfDay: '20:00', durationMs: 1_000 },
    ] });
    expect(clock.sample(ROUND_START + 1_000)).toMatchObject({ minutes: 18 * 60, transitionCompleted: true });
    expect(clock.sample(ROUND_START + 1_500)).toMatchObject({ minutes: 19 * 60, transitionCompleted: false });
    expect(clock.sample(ROUND_START + 2_000)).toMatchObject({ minutes: 20 * 60, transitionCompleted: true });
    expect(clock.sample(ROUND_START + 2_001).transitionCompleted).toBe(false);
  });

  it('orders a delayed boss transition after earlier resolved timed transitions', () => {
    const dynamic = { transitions: [
      { start: { type: 'boss-spawn' as const }, targetTimeOfDay: '21:00', durationMs: 1_000 },
      { start: { type: 'time' as const, atMs: 3_000 }, targetTimeOfDay: '18:00', durationMs: 0 },
    ] };
    const clock = authoredController(dynamic);
    expect(clock.sample(ROUND_START + 4_000).minutes).toBe(18 * 60);
    const signals = { bossSpawnedAtMs: ROUND_START + 5_000 };
    expect(clock.sample(ROUND_START + 5_000, signals).minutes).toBe(18 * 60);
    expect(clock.sample(ROUND_START + 5_500, signals).minutes).toBe(19.5 * 60);
    expect(clock.sample(ROUND_START + 6_000, signals).minutes).toBe(21 * 60);
    expect(authoredController(dynamic).sample(ROUND_START + 6_000, signals).minutes).toBe(21 * 60);
  });

  it('reanchors completion bookkeeping while retaining a local debug override', () => {
    const clock = authoredController({ transitions: [
      { start: { type: 'time', atMs: 0 }, targetTimeOfDay: '18:00', durationMs: 1_000 },
      { start: { type: 'time', atMs: 500 }, targetTimeOfDay: '20:00', durationMs: 1_000 },
    ] });
    expect(clock.sample(ROUND_START + 2_000).transitionCompleted).toBe(true);
    clock.setDebugOverride(60);
    const newStart = ROUND_START + 10_000;
    clock.setRoundStartTime(newStart);
    expect(clock.sample(newStart)).toMatchObject({ minutes: 60, automaticMinutes: 720, transitionCompleted: false });
    expect(clock.sample(newStart + 1_000).transitionCompleted).toBe(true);
    expect(clock.sample(newStart + 1_500)).toMatchObject({ minutes: 60, automaticMinutes: 19 * 60, transitionCompleted: false });
    expect(clock.sample(newStart + 2_000).transitionCompleted).toBe(true);
    clock.clearDebugOverride();
    expect(clock.getCurrentMinutes()).toBe(20 * 60);
    expect(clock.sample(newStart + 2_001).transitionCompleted).toBe(false);
  });

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
