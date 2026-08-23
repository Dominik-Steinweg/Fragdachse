import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCoopDefenseMapConfig,
  normalizeCoopDefenseMapConfig,
  type CoopDefenseMapConfig,
} from '../src/config/coopDefenseMaps';
import { ARENA_OFFSET_Y, CELL_SIZE } from '../src/config';
import { getCoopDefenseTutorialRockRegion } from '../src/config/coopDefenseTutorial';
import { AirstrikeSystem } from '../src/systems/AirstrikeSystem';
import {
  CoopDefenseAirstrikeEventHandler,
  planTutorialSweep,
} from '../src/systems/CoopDefenseAirstrikeEventHandler';
import { CoopDefenseMapEventDirector } from '../src/systems/CoopDefenseMapEventDirector';

function makeMap(overrides: Partial<CoopDefenseMapConfig>): CoopDefenseMapConfig {
  return {
    mapId: 'c2-test',
    displayName: 'C2 test',
    arenaWidthCells: 60,
    arenaHeightCells: 34,
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
  };
}

const finiteZoneEvent = {
  id: 'barrage',
  type: 'airstrike' as const,
  start: { type: 'time' as const, atMs: 0 },
  pattern: 'zone-barrage' as const,
  strikeCount: 3,
  area: { gridX: 4, gridY: 4, widthCells: 8, heightCells: 5 },
};

describe('Coop Defense C2 configuration', () => {
  it('normalizes all three fixed airstrike patterns', () => {
    const normalized = normalizeCoopDefenseMapConfig(makeMap({
      mapEvents: [
        {
          id: 'tutorial',
          type: 'airstrike',
          start: { type: 'time', atMs: 0 },
          pattern: 'tutorial-sweep',
          strikeCount: 8,
        },
        {
          id: 'hunt',
          type: 'airstrike',
          start: { type: 'time', atMs: 1_000 },
          pattern: 'player-hunt',
          intervalMs: 10_000,
        },
        finiteZoneEvent,
      ],
    }));

    expect(normalized.mapEvents).toMatchObject([
      { id: 'tutorial', type: 'airstrike', pattern: 'tutorial-sweep', strikeCount: 8 },
      { id: 'hunt', type: 'airstrike', pattern: 'player-hunt', intervalMs: 10_000 },
      {
        id: 'barrage',
        type: 'airstrike',
        pattern: 'zone-barrage',
        strikeCount: 3,
        area: { gridX: 4, gridY: 4, widthCells: 8, heightCells: 5 },
        orderedSweep: false,
      },
    ]);
  });

  it('rejects missing or pattern-incompatible airstrike parameters', () => {
    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      mapEvents: [{
        id: 'hunt',
        type: 'airstrike',
        start: { type: 'time', atMs: 0 },
        pattern: 'player-hunt',
      }],
    }))).toThrow(/intervalMs/);

    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      mapEvents: [{
        id: 'barrage',
        type: 'airstrike',
        start: { type: 'time', atMs: 0 },
        pattern: 'zone-barrage',
        strikeCount: 0,
      }],
    }))).toThrow(/area/);

    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      mapEvents: [{
        id: 'barrage',
        type: 'airstrike',
        start: { type: 'time', atMs: 0 },
        pattern: 'zone-barrage',
        strikeCount: 2,
        area: { gridX: 58, gridY: 4, widthCells: 4, heightCells: 2 },
      }],
    }))).toThrow(/outside the arena/);

    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      mapEvents: [{
        id: 'tutorial',
        type: 'airstrike',
        start: { type: 'time', atMs: 0 },
        pattern: 'tutorial-sweep',
        intervalMs: 1_000,
      }],
    }))).toThrow(/invalid for tutorial-sweep/);
  });

  it('validates unknown references, persistent sources and direct or indirect cycles', () => {
    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      encounters: [{
        id: 'after-missing',
        start: { type: 'after-event', eventId: 'missing' },
        groups: [{ enemyKind: 'zombie-badger', count: 1 }],
      }],
    }))).toThrow(/unknown map event/);

    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      encounters: [{
        id: 'after-hunt',
        start: { type: 'after-event', eventId: 'hunt' },
        groups: [{ enemyKind: 'zombie-badger', count: 1 }],
      }],
      mapEvents: [{
        id: 'hunt',
        type: 'airstrike',
        start: { type: 'time', atMs: 0 },
        pattern: 'player-hunt',
        intervalMs: 1_000,
      }],
    }))).toThrow(/repeatable or persistent/);

    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      encounters: [{
        id: 'after-train',
        start: { type: 'after-event', eventId: 'repeat-train' },
        groups: [{ enemyKind: 'zombie-badger', count: 1 }],
      }],
      mapEvents: [{
        id: 'repeat-train',
        type: 'train',
        start: { type: 'time', atMs: 0 },
        repeatAfterExitMs: 1_000,
      }],
    }))).toThrow(/repeatable or persistent/);

    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      encounters: [{
        id: 'encounter-a',
        start: { type: 'after-event', eventId: 'event-a' },
        groups: [{ enemyKind: 'zombie-badger', count: 1 }],
      }],
      mapEvents: [{
        ...finiteZoneEvent,
        id: 'event-a',
        start: { type: 'after-encounter', encounterId: 'encounter-a' },
      }],
    }))).toThrow(/cyclic/);

    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      encounters: [
        {
          id: 'encounter-a',
          start: { type: 'after-event', eventId: 'event-b' },
          groups: [{ enemyKind: 'zombie-badger', count: 1 }],
        },
        {
          id: 'encounter-b',
          start: { type: 'after-previous' },
          groups: [{ enemyKind: 'zombie-badger', count: 1 }],
        },
        {
          id: 'encounter-c',
          start: { type: 'after-event', eventId: 'event-a' },
          groups: [{ enemyKind: 'zombie-badger', count: 1 }],
        },
      ],
      mapEvents: [
        {
          ...finiteZoneEvent,
          id: 'event-a',
          start: { type: 'after-encounter', encounterId: 'encounter-b' },
        },
        {
          ...finiteZoneEvent,
          id: 'event-b',
          start: { type: 'after-encounter', encounterId: 'encounter-c' },
        },
      ],
    }))).toThrow(/cyclic/);

    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      mapEvents: [{
        ...finiteZoneEvent,
        id: 'after-missing',
        start: { type: 'after-event', eventId: 'missing' },
      }],
    }))).toThrow(/unknown map event/);

    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      mapEvents: [
        {
          ...finiteZoneEvent,
          id: 'hunt',
          start: { type: 'time', atMs: 0 },
          pattern: 'player-hunt',
          intervalMs: 1_000,
          strikeCount: undefined,
          area: undefined,
        },
        {
          ...finiteZoneEvent,
          id: 'after-hunt',
          start: { type: 'after-event', eventId: 'hunt' },
        },
      ],
    }))).toThrow(/repeatable or persistent/);

    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      mapEvents: [
        { ...finiteZoneEvent, id: 'event-a', start: { type: 'after-event', eventId: 'event-b' } },
        { ...finiteZoneEvent, id: 'event-b', start: { type: 'after-event', eventId: 'event-a' } },
      ],
    }))).toThrow(/cyclic/);

    const chained = normalizeCoopDefenseMapConfig(makeMap({
      encounters: [{
        id: 'after-first',
        start: { type: 'after-event', eventId: 'event-a' },
        groups: [{ enemyKind: 'zombie-badger', count: 1 }],
      }],
      mapEvents: [
        { ...finiteZoneEvent, id: 'event-a', start: { type: 'time', atMs: 0 } },
        {
          ...finiteZoneEvent,
          id: 'event-b',
          start: { type: 'after-event', eventId: 'event-a' },
        },
        {
          ...finiteZoneEvent,
          id: 'event-c',
          start: { type: 'after-encounter', encounterId: 'after-first' },
        },
      ],
    }));
    expect(chained.mapEvents?.map((event) => event.start)).toEqual([
      { type: 'time', atMs: 0 },
      { type: 'after-event', eventId: 'event-a' },
      { type: 'after-encounter', encounterId: 'after-first' },
    ]);
  });

  it('migrates the authored Map 11 chain and keeps Map 11/12 hunts repeatable', () => {
    const map11 = getCoopDefenseMapConfig('11');
    const map12 = getCoopDefenseMapConfig('12');
    const opening = map11.mapEvents?.find((event) => event.id === 'opening-barrage');
    const postBarrage = map11.encounters?.find((encounter) => encounter.id === 'post-barrage-assault');

    expect('enemyAirstrikes' in map11).toBe(false);
    expect(opening).toMatchObject({ pattern: 'tutorial-sweep' });
    expect(opening?.delayMs).toBeGreaterThanOrEqual(0);
    expect(postBarrage?.start).toEqual({ type: 'after-event', eventId: 'opening-barrage' });
    const map11Hunt = map11.mapEvents?.find((event) => event.id === 'player-hunt');
    expect(map11Hunt).toMatchObject({ pattern: 'player-hunt' });
    expect(map11Hunt?.intervalMs).toBeGreaterThan(0);
    expect('enemyAirstrikes' in map12).toBe(false);
    const map12Hunt = map12.mapEvents?.find((event) => event.id === 'player-hunt');
    expect(map12Hunt).toMatchObject({ pattern: 'player-hunt' });
    expect(map12Hunt?.intervalMs).toBeGreaterThan(0);
  });
});

describe('Coop Defense C2 airstrike lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createHarness(
    eventOverrides: Partial<typeof finiteZoneEvent> = {},
    playerCount = 1,
    additionalEvents: readonly typeof finiteZoneEvent[] = [],
  ) {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const system = new AirstrikeSystem();
    const handler = new CoopDefenseAirstrikeEventHandler({
      scheduleStrike: (x, y, config, metadata) => system.scheduleStrike(
        'coop-zombie-bomber',
        x,
        y,
        { ...config, delayMs: 2_000 },
        metadata,
      ),
      getAlivePlayerPositions: () => Array.from({ length: playerCount }, (_, index) => ({
        x: 600 + index * 64,
        y: 500,
      })),
      isProtectedBasePoint: () => false,
      playStrikeAudio: () => undefined,
      arenaWidthCells: 60,
      arenaHeightCells: 34,
      random: () => 0.5,
    });
    system.setResolvedCallback((resolution) => handler.handleStrikeResolved(resolution));
    const event = {
      ...finiteZoneEvent,
      ...eventOverrides,
    } as typeof finiteZoneEvent;
    const director = new CoopDefenseMapEventDirector([event, ...additionalEvents], [handler]);
    return {
      system,
      handler,
      director,
      setNow(value: number): void { now = value; },
    };
  }

  it('starts the Map 11 tutorial sweep three cells above the rock region', () => {
    const region = getCoopDefenseTutorialRockRegion(false);
    const [point] = planTutorialSweep(60, 39, false, 1, () => 0);

    expect(point?.y).toBe(
      ARENA_OFFSET_Y + (region.minGridY - 3 + 0.2) * CELL_SIZE,
    );
  });

  it('completes a barrage only after the actual last impact', () => {
    const harness = createHarness();
    harness.director.hostUpdate(0, false);
    expect(harness.director.getPresentationState()?.[0].state).toBe('active');
    expect(harness.system.getSnapshot()).toHaveLength(3);

    harness.setNow(1_999);
    harness.system.update(1_999);
    expect(harness.director.getPresentationState()?.[0].state).toBe('active');

    harness.setNow(2_000);
    harness.system.update(2_000);
    expect(harness.system.getSnapshot()).toEqual([]);
    expect(harness.director.getPresentationState()?.[0].state).toBe('completed');
  });

  it('keeps simultaneous same-pattern events independent by event id and occurrence', () => {
    const first = { ...finiteZoneEvent, id: 'first' };
    const second = { ...finiteZoneEvent, id: 'second', strikeCount: 2 };
    const harness = createHarness(first, 1, [second]);
    harness.director.hostUpdate(0, false);
    expect(harness.system.getSnapshot()).toHaveLength(5);
    harness.setNow(2_000);
    harness.system.update(2_000);
    expect(harness.director.getPresentationState()?.map((entry) => entry.state)).toEqual(['completed', 'completed']);
  });

  it('keeps player-hunt in waiting-repeat and never marks it completed', () => {
    const harness = createHarness({
      id: 'hunt',
      pattern: 'player-hunt',
      intervalMs: 5_000,
      strikeCount: undefined,
      area: undefined,
    });
    harness.director.hostUpdate(0, false);
    harness.setNow(2_000);
    harness.director.hostUpdate(2_000, false);
    harness.system.update(2_000);
    // Abwurf zu Abwurf: 0 ms + 5 s. Vom Einschlag (2 s) aus gerechnet waeren es 7 s -- die
    // Vorwarnzeit des Airstrikes wuerde das authored Intervall sonst bei jedem Zyklus dehnen.
    expect(harness.director.getPresentationState()?.[0]).toMatchObject({
      state: 'waiting-repeat',
      occurrence: 2,
      nextActionAtMs: 5_000,
    });

    harness.setNow(5_000);
    harness.director.hostUpdate(3_000, false);
    expect(harness.director.getPresentationState()?.[0].state).toBe('active');
    expect(harness.system.getSnapshot()).toHaveLength(1);
  });

  it('never schedules a hunt cycle into the past when the barrage outlasts the interval', () => {
    const harness = createHarness({
      id: 'hunt',
      pattern: 'player-hunt',
      intervalMs: 500,
      strikeCount: undefined,
      area: undefined,
    });
    harness.director.hostUpdate(0, false);
    harness.setNow(2_000);
    harness.director.hostUpdate(2_000, false);
    harness.system.update(2_000);
    // 0 ms + 500 ms liegt vor dem Einschlag; der Director klemmt auf die aktuelle Rundenzeit hoch,
    // statt einen Zyklus mit `nextActionAtMs < stateChangedAtMs` zu veroeffentlichen.
    expect(harness.director.getPresentationState()?.[0]).toMatchObject({
      state: 'waiting-repeat',
      occurrence: 2,
      nextActionAtMs: 2_000,
    });
  });

  it('clears in-flight handler state on reset', () => {
    const harness = createHarness();
    harness.director.hostUpdate(0, false);
    expect(harness.system.getSnapshot()).toHaveLength(3);
    harness.handler.reset();
    harness.system.clear();
    harness.setNow(10_000);
    harness.handler.hostUpdate(10_000, false);
    expect(harness.system.getSnapshot()).toEqual([]);
  });
});

describe('Coop Defense map-event trigger chains', () => {
  it('schedules a map event after a checkpoint through the generic director', () => {
    const handler = fakeHandler('train');
    let checkpointReached = false;
    let director!: CoopDefenseMapEventDirector;
    director = new CoopDefenseMapEventDirector([
      {
        id: 'burrow-train',
        type: 'train' as const,
        start: { type: 'after-checkpoint', checkpointId: 'cp3-burrow' },
        delayMs: 5_000,
      },
    ], [handler], {
      isTriggerSatisfied: (start) => start.type === 'after-checkpoint'
        && checkpointReached
        && start.checkpointId === 'cp3-burrow',
    });

    director.hostUpdate(0, false);
    expect(director.getPresentationState()?.[0].state).toBe('dormant');

    checkpointReached = true;
    director.hostUpdate(1_000, false);
    expect(director.getPresentationState()?.[0]).toMatchObject({
      state: 'scheduled',
      nextActionAtMs: 6_000,
    });

    director.hostUpdate(5_000, false);
    expect(director.getPresentationState()?.[0].state).toBe('active');
  });

  it('runs Event→Event→Event through the generic director lifecycle', () => {
    const handlers = {
      train: fakeHandler('train'),
      airstrike: fakeHandler('airstrike'),
      'ground-hazard': fakeHandler('ground-hazard'),
    };
    const events = [
      {
        id: 'event-a',
        type: 'train' as const,
        start: { type: 'time' as const, atMs: 0 },
      },
      {
        ...finiteZoneEvent,
        id: 'event-b',
        start: { type: 'after-event' as const, eventId: 'event-a' },
      },
      {
        id: 'event-c',
        type: 'ground-hazard' as const,
        start: { type: 'after-event' as const, eventId: 'event-b' },
        area: { type: 'cells' as const, cells: [{ gridX: 4, gridY: 4 }] },
        effect: {
          visualStyle: 'void' as const,
          burnDurationMs: 1_000,
          burnDamagePerTick: 1,
          sourceId: 'test.chain',
        },
      },
    ];
    let director: CoopDefenseMapEventDirector;
    director = new CoopDefenseMapEventDirector(events, Object.values(handlers), {
      isTriggerSatisfied: (start) => start.type === 'after-event' && director.isEventCompleted(start.eventId),
    });

    director.hostUpdate(0, false);
    expect(director.getPresentationState()?.map((entry) => entry.state)).toEqual(['active', 'dormant', 'dormant']);
    handlers.train.finish('event-a', 1, 0);
    director.hostUpdate(0, false);
    expect(director.getPresentationState()?.map((entry) => entry.state)).toEqual(['completed', 'active', 'dormant']);
    handlers.airstrike.finish('event-b', 1, 0);
    director.hostUpdate(0, false);
    expect(director.getPresentationState()?.map((entry) => entry.state)).toEqual(['completed', 'completed', 'active']);
  });
});

function fakeHandler(type: 'train' | 'airstrike' | 'ground-hazard') {
  let onFinished: ((completion: { eventId: string; occurrence: number; completedAtMs: number }) => void) | null = null;
  return {
    type,
    schedule: vi.fn(() => true),
    hostUpdate: vi.fn(),
    reset: vi.fn(),
    setCycleFinishedCallback: vi.fn((callback: typeof onFinished) => { onFinished = callback; }),
    finish(eventId: string, occurrence: number, completedAtMs: number): void {
      onFinished?.({ eventId, occurrence, completedAtMs });
    },
  };
}
