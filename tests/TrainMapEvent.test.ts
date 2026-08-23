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
import type { CoopDefenseMapEventCycleFinished } from '../src/systems/CoopDefenseMapEventDirector';
import { TRAIN } from '../src/train/TrainConfig';

function buildMap(overrides: Partial<CoopDefenseMapConfig>): CoopDefenseMapConfig {
  return normalizeCoopDefenseMapConfig({
    mapId: 'train-test',
    displayName: 'Train test',
    balanceReferenceDurationSec: 60,
    objective: 'survive',
    surviveDurationSec: 60,
    respawnsPerPlayer: 0,
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
  let onFinished: ((completion: CoopDefenseMapEventCycleFinished) => void) | null = null;
  return {
    type: 'train' as const,
    schedule: vi.fn(),
    hostUpdate: vi.fn(),
    reset: vi.fn(),
    setCycleFinishedCallback: vi.fn((callback: typeof onFinished) => { onFinished = callback; }),
    finish(eventId: string, occurrence: number, completedAtMs: number, nextActionAtMs?: number): void {
      onFinished?.({
        eventId,
        occurrence,
        completedAtMs,
        ...(nextActionAtMs === undefined ? {} : { nextActionAtMs }),
      });
    },
  };
}

/**
 * Ein einmaliger, encounter-getriggerter Zugeinsatz mit Vorwarnzeit – der C1-Vertrag.
 *
 * Er stand frueher in der Testarena; die traegt seit Block A nur noch Stressgeometrie. Der
 * Vertrag ist eine Regel des Event-Directors und wird deshalb hier authored statt aus einer
 * loeschbaren Map gelesen.
 */
const ENCOUNTER_TRIGGERED_TRAIN = {
  id: 'c1-opening-train',
  type: 'train',
  start: { type: 'after-encounter', encounterId: 'a2-opening-encounter' },
  delayMs: 5_000,
} as const;

describe('Train as a standalone map event', () => {
  it('migrates the train rhythm on every rails map of the campaign', () => {
    const railsMaps = COOP_DEFENSE_MAP_CONFIGS.filter((map) => (
      // Map 1 fuehrt als gefuehrte Tutorial-Route bewusst keinen Zug.
      map.trackMode === 'rails' && !['0', '1', '2', '11'].includes(map.mapId)
    ));
    expect(railsMaps.length).toBeGreaterThan(0);

    for (const map of railsMaps) {
      const trainEvent = map.mapEvents?.find((event) => event.type === 'train');
      expect(trainEvent, map.mapId).toMatchObject({
        id: 'train-rhythm',
        type: 'train',
        start: { type: 'time', atMs: expect.any(Number) },
        repeatAfterExitMs: expect.any(Number),
      });
      expect(trainEvent?.start.type === 'time' ? trainEvent.start.atMs : -1).toBeGreaterThanOrEqual(0);
      expect(trainEvent?.repeatAfterExitMs).toBeGreaterThan(0);
    }
  });

  it('keeps Map 2 train traffic between the first and second encounters', () => {
    const map = getCoopDefenseMapConfig('2');
    const trainEvent = map.mapEvents?.find((event) => event.type === 'train');

    expect(trainEvent).toMatchObject({
      id: 'train-rhythm',
      type: 'train',
      start: { type: 'after-encounter', encounterId: 'west-introduction' },
    });
    expect(trainEvent?.repeatAfterExitMs).toBeUndefined();
  });

  it('announces Map 3 train traffic on a repeating rhythm', () => {
    const map = getCoopDefenseMapConfig('3');
    const trainEvent = map.mapEvents?.find((event) => event.type === 'train');

    expect(trainEvent).toMatchObject({
      id: 'train-rhythm',
      type: 'train',
      start: { type: 'time', atMs: 10_000 },
    });
    expect(trainEvent?.repeatAfterExitMs).toBeGreaterThan(0);
  });

  it('keeps the guided Map 1 tutorial route free of unexplained train traffic', () => {
    const map = getCoopDefenseMapConfig('1');

    expect(map.trackMode).toBe('rails');
    expect(map.mapEvents?.some((event) => event.type === 'train')).toBe(false);
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
      expect(map.mapEvents?.some((event) => event.type === 'train'), mapId).toBe(false);
      expect(map.mapEvents?.some((event) => event.type === 'ground-hazard'), mapId).toBe(true);
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
    const unsupported = { ...event, start: { type: 'time', atMs: 0 }, type: 'unsupported' } as unknown as CoopDefenseMapConfig['mapEvents'][number];
    expect(() => buildMap({ mapEvents: [unsupported] })).toThrow(/unsupported map event type/);
  });

  it('allows sequential train events around another finite event', () => {
    const map = buildMap({
      mapEvents: [
        { id: 'train-a', type: 'train', start: { type: 'time', atMs: 0 } },
        {
          id: 'barrage',
          type: 'airstrike',
          start: { type: 'after-event', eventId: 'train-a' },
          pattern: 'zone-barrage',
          strikeCount: 1,
          area: { gridX: 4, gridY: 4, widthCells: 2, heightCells: 2 },
        },
        {
          id: 'train-b',
          type: 'train',
          start: { type: 'after-event', eventId: 'barrage' },
        },
      ],
    });

    expect(map.mapEvents?.map((event) => event.id)).toEqual(['train-a', 'barrage', 'train-b']);
    expect(map.mapEvents?.[1]?.start).toEqual({ type: 'after-event', eventId: 'train-a' });
  });

  it('keeps an encounter-triggered slice one-shot with an authored warning', () => {
    // Bewusst authored statt aus einer Map gelesen: Die frueher hier benutzte Testarena ist seit
    // Block A eine loeschbare Stressarena ohne Events, und der Vertrag gehoert ohnehin zum
    // Event-Director, nicht zu einer bestimmten Karte.
    const event = ENCOUNTER_TRIGGERED_TRAIN;
    expect(event).toMatchObject({
      id: 'c1-opening-train',
      type: 'train',
      start: { type: 'after-encounter', encounterId: 'a2-opening-encounter' },
    });
    expect(event?.delayMs ?? 0).toBeGreaterThanOrEqual(0);
    expect(event?.repeatAfterExitMs).toBeUndefined();
  });

  it('runs an encounter-triggered event through scheduled, active and completed', () => {
    const event = ENCOUNTER_TRIGGERED_TRAIN;
    const delayMs = event.delayMs ?? 0;
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
      state: delayMs > 0 ? 'scheduled' : 'active',
      occurrence: 1,
      ...(delayMs > 0 ? { nextActionAtMs: 10_000 + delayMs } : {}),
    });
    director.hostUpdate(delayMs, false);
    expect(director.getPresentationState()?.[0].state).toBe('active');
    handler.finish(event.id, 1, 10_000 + delayMs);
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
    handler.finish('repeat-train', 1, 1_000, 8_000);
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
