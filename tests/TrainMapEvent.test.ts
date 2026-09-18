import { describe, expect, it, vi } from 'vitest';
import {
  COOP_DEFENSE_MAP_CONFIGS,
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
  it('schedules authored trains from their configured trigger and warning delay', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS) {
      for (const event of map.mapEvents ?? []) {
        if (event.type !== 'train') continue;
        expect(map.trackMode, map.mapId + '/' + event.id).toBe('rails');
        const handler = fakeTrainHandler();
        let triggerSatisfied = false;
        const director = new CoopDefenseMapEventDirector([event], [handler], {
          isTriggerSatisfied: (start) => start === event.start && triggerSatisfied,
        });
        const triggerAtMs = event.start.type === 'time' ? event.start.atMs : 1;
        const delayMs = event.delayMs ?? 0;

        if (triggerAtMs > 0) {
          director.hostUpdate(triggerAtMs - 1, false);
          expect(handler.schedule).not.toHaveBeenCalled();
          expect(director.getPresentationState()?.[0].state).toBe('dormant');
        }
        triggerSatisfied = true;
        director.hostUpdate(triggerAtMs > 0 ? 1 : 0, false);
        expect(handler.schedule).toHaveBeenCalledExactlyOnceWith(
          event, 1, triggerAtMs + delayMs, triggerAtMs,
        );
        if (delayMs > 0) {
          expect(director.getPresentationState()?.[0]).toMatchObject({
            state: 'scheduled',
            nextActionAtMs: triggerAtMs + delayMs,
          });
        }
        director.hostUpdate(delayMs, false);
        expect(director.getPresentationState()?.[0]).toMatchObject({
          eventId: event.id,
          state: 'active',
          occurrence: 1,
        });
        director.reset();
      }
    }
  });

  it('allows rails without a train', () => {
    // trackMode bleibt `rails`, die Map konfiguriert aber kein Zug-Event.
    const map = buildMap({ trackMode: 'rails' });

    expect(map.trackMode).toBe('rails');
    expect(map.mapEvents).toEqual([]);
  });

  it('keeps void-fire corridors free of trains', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS.filter((map) => map.trackMode === 'void-fire')) {
      expect(map.mapEvents?.some((event) => event.type === 'train'), map.mapId).toBe(false);
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
