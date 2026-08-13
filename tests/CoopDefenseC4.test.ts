import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({}));
const testNetwork = vi.hoisted(() => ({ mapId: '0' }));
vi.mock('../src/network/bridge', () => ({
  bridge: { getCoopDefenseMapId: () => testNetwork.mapId },
}));

import {
  COOP_DEFENSE_MAP_CONFIGS,
  type CoopDefenseMapTrainEventConfig,
  type ResolvedCoopDefenseMapEventConfig,
} from '../src/config/coopDefenseMaps';
import { ArenaGenerator } from '../src/arena/ArenaGenerator';
import { applyArenaMetricsForMode } from '../src/config';
import { COOP_DEFENSE_MODE } from '../src/gameModes';
import { FULL_GAME_STATE_SLICE_KEYS } from '../src/network/FullGameStateBootstrap';
import { CoopDefenseMapEventAnnouncementPresenter } from '../src/ui/CoopDefenseMapEventAnnouncementPresenter';
import type { CoopDefenseAnnouncementMessage } from '../src/ui/CoopDefenseObjectiveAnnouncement';
import type { CoopDefenseMapEventPresentationState } from '../src/types';
import { CoopDefenseMapEventDirector } from '../src/systems/CoopDefenseMapEventDirector';

function makeTrainEvent(overrides: Partial<CoopDefenseMapTrainEventConfig> = {}): CoopDefenseMapTrainEventConfig {
  return {
    id: 'train',
    type: 'train',
    start: { type: 'time', atMs: 0 },
    ...overrides,
  };
}

function state(
  eventId: string,
  eventType: CoopDefenseMapEventPresentationState[number]['eventType'],
  lifecycle: CoopDefenseMapEventPresentationState[number]['state'],
  occurrence = 1,
): CoopDefenseMapEventPresentationState {
  return [{
    eventId,
    eventType,
    state: lifecycle,
    occurrence: lifecycle === 'dormant' ? 0 : occurrence,
    stateChangedAtMs: 1000,
    ...(lifecycle === 'scheduled' || lifecycle === 'waiting-repeat'
      ? { nextActionAtMs: 2000 }
      : {}),
  }];
}

function createAnnouncementHarness() {
  const messages: CoopDefenseAnnouncementMessage[] = [];
  const clearedTopics: string[] = [];
  const presenter = new CoopDefenseMapEventAnnouncementPresenter({
    enqueue: (message) => messages.push(message),
    clearTopic: (topic) => clearedTopics.push(topic),
  });
  return { presenter, messages, clearedTopics };
}

describe('Coop Defense C4 map-event presentation', () => {
  it('hydrates the first snapshot without historical announcements and deduplicates transitions', () => {
    const event = makeTrainEvent();
    const harness = createAnnouncementHarness();
    harness.presenter.setMapEvents([event]);

    harness.presenter.sync(state('train', 'train', 'active'));
    expect(harness.messages).toHaveLength(0);

    harness.presenter.sync(state('train', 'train', 'active'));
    expect(harness.messages).toHaveLength(0);

    harness.presenter.sync(state('train', 'train', 'completed'));
    expect(harness.messages).toHaveLength(0);

    harness.presenter.sync(state('train', 'train', 'completed'));
    expect(harness.messages).toHaveLength(0);

    harness.presenter.resetForHydration();
    harness.presenter.sync(state('train', 'train', 'completed'));
    expect(harness.messages).toHaveLength(0);
    expect(harness.clearedTopics).toContain('map-event:train');
  });

  it('announces each event family through separate queue topics and keeps stale messages irrelevant', () => {
    const events: ResolvedCoopDefenseMapEventConfig[] = [
      makeTrainEvent({ id: 'train-event' }),
      {
        id: 'airstrike-event',
        type: 'airstrike',
        start: { type: 'time', atMs: 0 },
        pattern: 'zone-barrage',
        strikeCount: 2,
        area: { gridX: 2, gridY: 2, widthCells: 4, heightCells: 4 },
      },
      {
        id: 'hazard-event',
        type: 'ground-hazard',
        start: { type: 'time', atMs: 0 },
        area: { type: 'cells', cells: [{ gridX: 4, gridY: 4 }] },
        effect: {
          visualStyle: 'void',
          burnDurationMs: 1000,
          burnDamagePerTick: 1,
          weaponName: 'C4-Testbrand',
        },
      },
    ];
    const harness = createAnnouncementHarness();
    harness.presenter.setMapEvents(events);
    harness.presenter.sync([
      ...state('train-event', 'train', 'dormant'),
      ...state('airstrike-event', 'airstrike', 'dormant'),
      ...state('hazard-event', 'ground-hazard', 'dormant'),
    ]);
    harness.presenter.sync([
      ...state('train-event', 'train', 'scheduled'),
      ...state('airstrike-event', 'airstrike', 'active'),
      ...state('hazard-event', 'ground-hazard', 'active'),
    ]);

    expect(harness.messages).toHaveLength(2);
    expect(new Set(harness.messages.map((message) => message.topic))).toEqual(new Set([
      'map-event:airstrike-event',
      'map-event:hazard-event',
    ]));
    expect(harness.messages.every((message) => message.id.includes(':1:'))).toBe(true);
    harness.presenter.sync([
      ...state('train-event', 'train', 'active'),
      ...state('airstrike-event', 'airstrike', 'active'),
      ...state('hazard-event', 'ground-hazard', 'active'),
    ]);
    expect(harness.messages.every((message) => message.isRelevant?.() === true)).toBe(true);
  });

  it('treats waiting-repeat as a new occurrence and resets cleanly for the next round', () => {
    const event = makeTrainEvent({ id: 'repeat-train', repeatAfterExitMs: 1000 });
    const harness = createAnnouncementHarness();
    harness.presenter.setMapEvents([event]);
    harness.presenter.sync(state('repeat-train', 'train', 'dormant'));
    harness.presenter.sync(state('repeat-train', 'train', 'waiting-repeat', 2));
    expect(harness.messages).toHaveLength(0);

    harness.presenter.sync(null);
    harness.presenter.sync(state('repeat-train', 'train', 'dormant'));
    harness.presenter.sync(state('repeat-train', 'train', 'scheduled', 1));
    expect(harness.messages).toHaveLength(0);
  });
});

describe('Coop Defense C4 event integration guards', () => {
  it('keeps the presentation object stable until a lifecycle change', () => {
    const handler = {
      type: 'train' as const,
      schedule: vi.fn(() => true),
      hostUpdate: vi.fn(),
      reset: vi.fn(),
      setCycleFinishedCallback: vi.fn(),
    };
    const director = new CoopDefenseMapEventDirector([makeTrainEvent()], [handler]);

    const first = director.getPresentationState();
    expect(director.getPresentationState()).toBe(first);
    director.hostUpdate(0, false);
    const scheduled = director.getPresentationState();
    expect(scheduled).not.toBe(first);
    expect(director.getPresentationState()).toBe(scheduled);
  });

  it('ignores duplicate completion callbacks and starts the next round at occurrence one', () => {
    let finish: ((completion: { eventId: string; occurrence: number; completedAtMs: number }) => void) | null = null;
    const handler = {
      type: 'train' as const,
      schedule: vi.fn(() => true),
      hostUpdate: vi.fn(),
      reset: vi.fn(),
      setCycleFinishedCallback: vi.fn((callback) => { finish = callback; }),
    };
    const director = new CoopDefenseMapEventDirector([makeTrainEvent()], [handler]);
    director.hostUpdate(0, false);
    finish?.({ eventId: 'train', occurrence: 1, completedAtMs: 10 });
    finish?.({ eventId: 'train', occurrence: 1, completedAtMs: 11 });
    expect(director.getPresentationState()?.[0].state).toBe('completed');
    expect(handler.schedule).toHaveBeenCalledTimes(1);

    director.reset();
    director.hostUpdate(0, false);
    expect(director.getPresentationState()?.[0]).toMatchObject({ state: 'active', occurrence: 1 });
    expect(handler.schedule).toHaveBeenCalledTimes(2);
  });

  it('keeps authoritative family slices in the existing full bootstrap contract', () => {
    expect(FULL_GAME_STATE_SLICE_KEYS).toEqual(expect.arrayContaining(['t', 'ak', 'fg']));
  });
});

describe('Coop Defense C4 campaign validation', () => {
  it('prebuilds every shipped ground-hazard event for a real arena seed', () => {
    // Maps without ground hazards do not contribute anything to this invariant. Avoiding their
    // full arena generation keeps this authoring guard focused and prevents it from re-running
    // unrelated connectivity work for the entire campaign.
    const mapsWithGroundHazards = COOP_DEFENSE_MAP_CONFIGS.filter((map) => (
      map.mapEvents?.some((event) => event.type === 'ground-hazard') === true
    ));

    for (const map of mapsWithGroundHazards) {
      testNetwork.mapId = map.mapId;
      applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', map.arenaWidthCells);
      const seed = map.mapId === '14'
        ? 4_711
        : map.mapId === '15'
          ? 71_515
          : map.mapId === '16'
            ? 71_516
            : 73_000 + Number(map.mapId) * 101;
      const layout = ArenaGenerator.generate(seed, map);
      const mapEventIds = new Set(map.mapEvents?.map((event) => event.id));
      expect(mapEventIds.size, `duplicate event id on map ${map.mapId}`).toBe(map.mapEvents?.length ?? 0);
      for (const event of map.mapEvents ?? []) {
        if (event.type !== 'ground-hazard') continue;
        const zones = layout.groundHazardZones?.filter((zone) => zone.eventId === event.id) ?? [];
        expect(zones.length, `${map.mapId}:${event.id} has no prebuilt zone`).toBeGreaterThan(0);
        expect(zones.every((zone) => zone.cells.length > 0)).toBe(true);
      }
    }
  }, 30_000);
});
