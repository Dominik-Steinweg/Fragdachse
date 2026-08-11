import { describe, expect, it, vi } from 'vitest';
import {
  COOP_DEFENSE_MAP_CONFIGS,
  getCoopDefenseMapConfig,
  normalizeCoopDefenseMapConfig,
  type CoopDefenseMapConfig,
} from '../src/config/coopDefenseMaps';
import {
  formatTrainArrivalLabel,
  getClassicTrainEventPlan,
  getNextClassicTrainArrivalAt,
  getTrainArrivalCountdownSecs,
} from '../src/train/TrainEvent';
import { CoopDefenseMapEventDirector } from '../src/systems/CoopDefenseMapEventDirector';
import { TRAIN } from '../src/train/TrainConfig';

function buildMap(overrides: Partial<CoopDefenseMapConfig>): CoopDefenseMapConfig {
  return normalizeCoopDefenseMapConfig({
    mapId: 'train-test',
    displayName: 'Train test',
    balanceReferenceDurationSec: 60,
    objective: 'survive',
    surviveDurationSec: 60,
    surviveRespawnsPerPlayer: 0,
    bases: [{
      id: 'friendly-main',
      hpMax: 100,
      anchor: { kind: 'right-center', edgeInsetCells: 0 },
      shape: { kind: 'rectangle', widthCells: 1, heightCells: 1 },
    }],
    powerUps: [],
    ...overrides,
  } as CoopDefenseMapConfig);
}

function fakeTrainHandler() {
  let onFinished: ((eventId: string, occurrence: number, exitedAtMs: number) => void) | null = null;
  return {
    type: 'train' as const,
    schedule: vi.fn(),
    hostUpdate: vi.fn(),
    reset: vi.fn(),
    setCycleFinishedCallback: vi.fn((callback: typeof onFinished) => { onFinished = callback; }),
    finish(eventId: string, occurrence: number, exitedAtMs: number): void {
      onFinished?.(eventId, occurrence, exitedAtMs);
    },
  };
}

describe('Train as a standalone map event', () => {
  it('migrates the train rhythm on every rails map of the campaign', () => {
    const railsMaps = COOP_DEFENSE_MAP_CONFIGS.filter((map) => map.trackMode === 'rails' && map.mapId !== '0');
    expect(railsMaps.length).toBeGreaterThan(0);

    for (const map of railsMaps) {
      expect(map.mapEvents, map.mapId).toHaveLength(1);
      expect(map.mapEvents?.[0], map.mapId).toMatchObject({
        id: 'train-rhythm',
        type: 'train',
        start: { type: 'time', atMs: 10_000 },
        repeatAfterExitMs: 10_000,
      });
    }
  });

  it('allows rails without a train', () => {
    // trackMode bleibt `rails`, die Map konfiguriert aber kein Zug-Event.
    const map = buildMap({ trackMode: 'rails' });

    expect(map.trackMode).toBe('rails');
    expect(map.mapEvents).toEqual([]);
  });

  it('keeps void-fire corridors free of trains', () => {
    for (const mapId of ['15', '16']) {
      const map = getCoopDefenseMapConfig(mapId);
      expect(map.trackMode, mapId).toBe('void-fire');
      expect(map.mapEvents, mapId).toEqual([]);
    }

    expect(() => buildMap({
      trackMode: 'void-fire',
      mapEvents: [{ id: 'blocked-train', type: 'train', start: { type: 'time', atMs: 10_000 } }],
    })).toThrow(/no rails/);
  });

  it('keeps the classic rhythm for modes without a map configuration', () => {
    const plan = getClassicTrainEventPlan();

    expect(plan).toEqual({
      firstArrivalDelayMs: TRAIN.DEFAULT_FIRST_ARRIVAL_MS,
      repeatAfterExitMs: TRAIN.DEFAULT_REPEAT_AFTER_EXIT_MS,
    });
  });

  it('validates map event ids, references, timing and repeat values fail-closed', () => {
    const encounter = {
      id: 'opening',
      start: { type: 'time', atMs: 0 },
      groups: [{ enemyKind: 'zombie-badger' as const, count: 1 }],
    };
    const event = {
      id: 'train',
      type: 'train' as const,
      start: { type: 'after-encounter', encounterId: 'opening' },
    };
    expect(() => buildMap({ encounters: [encounter], mapEvents: [event, { ...event }] })).toThrow(/Duplicate map event id/);
    expect(() => buildMap({ mapEvents: [{ ...event, start: { type: 'after-encounter', encounterId: 'missing' } }] })).toThrow(/unknown encounter/);
    expect(() => buildMap({ mapEvents: [{ ...event, start: { type: 'time', atMs: 0 }, delayMs: -1 }] })).toThrow(/delayMs/);
    expect(() => buildMap({ mapEvents: [{ ...event, start: { type: 'time', atMs: 0 }, repeatAfterExitMs: 0 }] })).toThrow(/repeatAfterExitMs/);
    expect(() => buildMap({ mapEvents: [{ ...event, start: { type: 'time', atMs: 0 }, type: 'airstrike' }] })).toThrow(/unsupported map event type/);
  });

  it('keeps the 00-test C1 slice one-shot with encounter clear and five seconds warning', () => {
    const event = getCoopDefenseMapConfig('0').mapEvents?.[0];
    expect(event).toMatchObject({
      id: 'c1-opening-train',
      type: 'train',
      start: { type: 'after-encounter', encounterId: 'a2-opening-encounter' },
      delayMs: 5000,
    });
    expect(event?.repeatAfterExitMs).toBeUndefined();
  });

  it('runs the 00-test event through scheduled, active and completed', () => {
    const event = getCoopDefenseMapConfig('0').mapEvents?.[0];
    if (!event) throw new Error('00-test C1 event missing');
    let encounterCleared = false;
    const handler = fakeTrainHandler();
    const director = new CoopDefenseMapEventDirector([event], [handler], {
      isTriggerSatisfied: (start) => start.type === 'after-encounter' && encounterCleared,
    });

    director.hostUpdate(10_000, false);
    expect(director.getPresentationState()?.[0].state).toBe('dormant');
    encounterCleared = true;
    director.hostUpdate(0, false);
    expect(director.getPresentationState()?.[0]).toMatchObject({
      state: 'scheduled',
      occurrence: 1,
      nextActionAtMs: 15_000,
    });
    director.hostUpdate(5_000, false);
    expect(director.getPresentationState()?.[0].state).toBe('active');
    handler.finish(event.id, 1, 15_000);
    expect(director.getPresentationState()?.[0].state).toBe('completed');
  });

  it('schedules repeated arrivals relative to leaving the arena', () => {
    const handler = fakeTrainHandler();
    const director = new CoopDefenseMapEventDirector([{
      id: 'repeat-train',
      type: 'train',
      start: { type: 'time', atMs: 0 },
      repeatAfterExitMs: 7_000,
      delayMs: 0,
    }], [handler]);
    director.hostUpdate(0, false);
    handler.finish('repeat-train', 1, 1_000);
    // Die Wiedereinfahrt hängt am Zeitpunkt des Verlassens, nicht am Rundenstart.
    expect(director.getPresentationState()?.[0]).toMatchObject({
      state: 'waiting-repeat',
      occurrence: 2,
      nextActionAtMs: 8_000,
    });
  });

  it('lets a train run exactly once when no repeat is configured', () => {
    const handler = fakeTrainHandler();
    const director = new CoopDefenseMapEventDirector([{
      id: 'one-shot-train',
      type: 'train',
      start: { type: 'time', atMs: 4_000 },
      delayMs: 0,
    }], [handler]);
    director.hostUpdate(4_000, false);
    handler.finish('one-shot-train', 1, 4_000);
    expect(director.getPresentationState()?.[0].state).toBe('completed');
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
