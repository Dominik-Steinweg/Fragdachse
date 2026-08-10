import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_MAP_CONFIGS,
  getCoopDefenseMapConfig,
  normalizeCoopDefenseMapConfig,
  type CoopDefenseMapConfig,
} from '../src/config/coopDefenseMaps';
import {
  formatTrainArrivalLabel,
  getNextTrainArrivalAt,
  getTrainArrivalCountdownSecs,
  resolveTrainEventPlan,
} from '../src/train/TrainEvent';
import { TRAIN } from '../src/train/TrainConfig';

function buildMap(overrides: Partial<CoopDefenseMapConfig>): CoopDefenseMapConfig {
  return normalizeCoopDefenseMapConfig({
    mapId: 'train-test',
    displayName: 'Train test',
    roundDurationSec: 60,
    bases: [],
    powerUps: [],
    ...overrides,
  } as CoopDefenseMapConfig);
}

describe('Train as a standalone map event', () => {
  it('keeps the legacy rhythm on every rails map of the campaign', () => {
    const railsMaps = COOP_DEFENSE_MAP_CONFIGS.filter((map) => map.trackMode === 'rails');
    expect(railsMaps.length).toBeGreaterThan(0);

    for (const map of railsMaps) {
      const plan = resolveTrainEventPlan(map);
      expect(plan, `map ${map.mapId} lost its train`).not.toBeNull();
      expect(plan!.firstArrivalDelayMs, map.mapId).toBe(10_000);
      expect(plan!.repeatAfterExitMs, map.mapId).toBe(10_000);
    }
  });

  it('allows rails without a train', () => {
    // trackMode bleibt `rails`, die Map konfiguriert aber kein Zug-Event.
    const map = buildMap({ trackMode: 'rails' });

    expect(map.trackMode).toBe('rails');
    expect(map.train).toBeUndefined();
    expect(resolveTrainEventPlan(map)).toBeNull();
  });

  it('keeps void-fire corridors free of trains', () => {
    for (const mapId of ['15', '16']) {
      const map = getCoopDefenseMapConfig(mapId);
      expect(map.trackMode, mapId).toBe('void-fire');
      expect(resolveTrainEventPlan(map), mapId).toBeNull();
    }

    expect(() => buildMap({
      trackMode: 'void-fire',
      train: { firstArrival: { type: 'time', atMs: 10_000 } },
    })).toThrow(/no rails/);
  });

  it('keeps the classic rhythm for modes without a map configuration', () => {
    const plan = resolveTrainEventPlan(null);

    expect(plan).toEqual({
      firstArrivalDelayMs: TRAIN.DEFAULT_FIRST_ARRIVAL_MS,
      repeatAfterExitMs: TRAIN.DEFAULT_REPEAT_AFTER_EXIT_MS,
    });
  });

  it('schedules repeated arrivals relative to leaving the arena', () => {
    const map = buildMap({
      train: { firstArrival: { type: 'time', atMs: 4_000 }, repeatAfterExitMs: 7_000 },
    });
    const plan = resolveTrainEventPlan(map)!;

    expect(plan.firstArrivalDelayMs).toBe(4_000);
    // Die Wiedereinfahrt hängt am Zeitpunkt des Verlassens, nicht am Rundenstart.
    expect(getNextTrainArrivalAt(1_000_000, plan)).toBe(1_007_000);
  });

  it('lets a train run exactly once when no repeat is configured', () => {
    const map = buildMap({ train: { firstArrival: { type: 'time', atMs: 4_000 } } });
    const plan = resolveTrainEventPlan(map)!;

    expect(plan.repeatAfterExitMs).toBeNull();
    expect(getNextTrainArrivalAt(1_000_000, plan)).toBeNull();
  });

  it('announces the real remaining time until the next arrival', () => {
    const now = 1_000_000;

    // Ausschliesslich aus spawnAt - synchronizedNow; der Rundentimer geht nicht ein.
    expect(getTrainArrivalCountdownSecs(now + 10_000, now)).toBe(10);
    expect(getTrainArrivalCountdownSecs(now + 9_400, now)).toBe(10);
    expect(getTrainArrivalCountdownSecs(now, now)).toBeNull();
    expect(getTrainArrivalCountdownSecs(now - 5_000, now)).toBeNull();
  });

  it('formats the arrival announcement in German seconds', () => {
    expect(formatTrainArrivalLabel(10)).toBe('RB 54 · ANKUNFT in 10s');
    expect(formatTrainArrivalLabel(59)).toBe('RB 54 · ANKUNFT in 59s');
    expect(formatTrainArrivalLabel(65)).toBe('RB 54 · ANKUNFT in 1:05');
  });
});
