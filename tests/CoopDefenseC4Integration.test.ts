import { afterEach, describe, expect, it, vi } from 'vitest';

const trainNetwork = vi.hoisted(() => ({
  current: null as unknown,
  publishCount: 0,
}));

vi.mock('../src/network/bridge', () => ({
  bridge: {
    publishTrainEvent: (event: unknown) => {
      trainNetwork.current = event;
      trainNetwork.publishCount += 1;
    },
    clearTrainEvent: () => {
      trainNetwork.current = null;
    },
  },
}));

vi.mock('phaser', () => ({
  Geom: {
    Rectangle: class {
      readonly left: number;
      readonly right: number;
      readonly top: number;
      readonly bottom: number;
      readonly centerX: number;
      readonly centerY: number;

      constructor(x: number, y: number, width: number, height: number) {
        this.left = x;
        this.right = x + width;
        this.top = y;
        this.bottom = y + height;
        this.centerX = x + width * 0.5;
        this.centerY = y + height * 0.5;
      }
    },
  },
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
  },
}));

import {
  type CoopDefenseMapAirstrikeEventConfig,
  type CoopDefenseMapGroundHazardEventConfig,
  type ResolvedCoopDefenseMapEventConfig,
  type CoopDefenseMapTrainEventConfig,
} from '../src/config/coopDefenseMaps';
import { FireSystem } from '../src/effects/FireSystem';
import { AirstrikeSystem } from '../src/systems/AirstrikeSystem';
import { CoopDefenseAirstrikeEventHandler } from '../src/systems/CoopDefenseAirstrikeEventHandler';
import { CoopDefenseGroundHazardEventHandler } from '../src/systems/CoopDefenseGroundHazardEventHandler';
import { CoopDefenseMapEventDirector } from '../src/systems/CoopDefenseMapEventDirector';
import { CoopDefenseTrainEventHandler } from '../src/train/CoopDefenseTrainEventHandler';
import { CoopDefenseMapEventAnnouncementPresenter } from '../src/ui/CoopDefenseMapEventAnnouncementPresenter';
import type { CoopDefenseAnnouncementMessage } from '../src/ui/CoopDefenseObjectiveAnnouncement';

const TRAIN_EVENT: CoopDefenseMapTrainEventConfig = {
  id: 'train',
  type: 'train',
  start: { type: 'time', atMs: 0 },
};

const AIRSTRIKE_EVENT: CoopDefenseMapAirstrikeEventConfig = {
  id: 'barrage',
  type: 'airstrike',
  start: { type: 'time', atMs: 0 },
  pattern: 'zone-barrage',
  strikeCount: 2,
  area: { gridX: 4, gridY: 4, widthCells: 4, heightCells: 4 },
};

const HAZARD_EVENT: CoopDefenseMapGroundHazardEventConfig = {
  id: 'hazard',
  type: 'ground-hazard',
  start: { type: 'time', atMs: 0 },
  durationMs: 1_000,
  area: { type: 'cells', cells: [{ gridX: 4, gridY: 4 }] },
  effect: {
    visualStyle: 'void',
    burnDurationMs: 2_000,
    burnDamagePerTick: 0.5,
    weaponName: 'C4-Integrationsbrand',
  },
};

function createPresenter(event: ResolvedCoopDefenseMapEventConfig) {
  const messages: CoopDefenseAnnouncementMessage[] = [];
  const presenter = new CoopDefenseMapEventAnnouncementPresenter({
    enqueue: (message) => messages.push(message),
    clearTopic: () => undefined,
  });
  presenter.setMapEvents([event]);
  return { presenter, messages };
}

function verifyLatejoinAndReconnect(
  event: ResolvedCoopDefenseMapEventConfig,
  director: CoopDefenseMapEventDirector,
  complete: () => void,
): { presenter: CoopDefenseMapEventAnnouncementPresenter; messages: CoopDefenseAnnouncementMessage[] } {
  const { presenter, messages } = createPresenter(event);
  const active = director.getPresentationState();
  if (!active) throw new Error('active map-event snapshot missing');

  // First delivery is a latejoin/reconnect baseline, not a historical announcement.
  presenter.sync(active);
  presenter.resetForHydration();
  presenter.sync(active);
  presenter.sync(active);
  expect(messages).toHaveLength(0);

  complete();
  const completed = director.getPresentationState();
  if (!completed) throw new Error('completed map-event snapshot missing');
  presenter.sync(completed);
  presenter.sync(completed);
  expect(messages).toHaveLength(event.type === 'train' ? 0 : 1);

  // Applying the same completed snapshot after reconnect remains idempotent.
  presenter.resetForHydration();
  presenter.sync(completed);
  expect(messages).toHaveLength(event.type === 'train' ? 0 : 1);
  return { presenter, messages };
}

function verifyNewRoundStartsHydrated(
  director: CoopDefenseMapEventDirector,
  presenter: CoopDefenseMapEventAnnouncementPresenter,
  messages: CoopDefenseAnnouncementMessage[],
  expectedMessageCount: number,
): void {
  director.reset();
  const resetState = director.getPresentationState();
  expect(resetState?.[0]).toMatchObject({ state: 'dormant', occurrence: 0 });
  presenter.sync(null);
  presenter.sync(resetState);
  expect(messages).toHaveLength(expectedMessageCount);
}

describe('Coop Defense C4 active map-event integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    trainNetwork.current = null;
    trainNetwork.publishCount = 0;
  });

  it('hydrates an active Train occurrence, prevents overwrite, and resets cleanly', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    let onExited: (() => void) | null = null;
    const trainManager = {
      getTrackX: () => 640,
      setExitedCallback: (callback: () => void) => { onExited = callback; },
      prepareReentry: vi.fn(),
      spawn: vi.fn(),
      update: vi.fn(),
      getSegObjects: () => [],
    };
    const handler = new CoopDefenseTrainEventHandler(
      trainManager as never,
      { setTrainSegments: vi.fn() } as never,
      1,
    );
    const director = new CoopDefenseMapEventDirector([TRAIN_EVENT], [handler]);

    director.hostUpdate(0, false);
    expect(director.getPresentationState()?.[0].state).toBe('active');
    expect(trainNetwork.current).not.toBeNull();
    expect(trainNetwork.publishCount).toBe(1);

    expect(handler.schedule({ ...TRAIN_EVENT, id: 'second-train' }, 1, 0, 0)).toBe(false);
    expect(trainNetwork.publishCount).toBe(1);

    const integration = verifyLatejoinAndReconnect(TRAIN_EVENT, director, () => {
      director.hostUpdate(10, false);
      onExited?.();
    });
    expect(director.getPresentationState()?.[0].state).toBe('completed');
    expect(trainNetwork.current).toBeNull();

    verifyNewRoundStartsHydrated(director, integration.presenter, integration.messages, 0);
    director.hostUpdate(0, false);
    expect(director.getPresentationState()?.[0]).toMatchObject({ state: 'active', occurrence: 1 });
  });

  it('hydrates an active Airstrike occurrence through the real AirstrikeSystem', () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const system = new AirstrikeSystem();
    const handler = new CoopDefenseAirstrikeEventHandler({
      scheduleStrike: (x, y, config, metadata) => system.scheduleStrike(
        'coop-zombie-bomber',
        x,
        y,
        { ...config, delayMs: 1_000 },
        metadata,
      ),
      getAlivePlayerPositions: () => [{ x: 600, y: 500 }],
      isProtectedBasePoint: () => false,
      playStrikeAudio: () => undefined,
      arenaWidthCells: 60,
      arenaHeightCells: 34,
      random: () => 0.5,
    });
    system.setResolvedCallback((resolution) => handler.handleStrikeResolved(resolution));
    const director = new CoopDefenseMapEventDirector([AIRSTRIKE_EVENT], [handler]);

    director.hostUpdate(0, false);
    expect(director.getPresentationState()?.[0].state).toBe('active');
    expect(system.getSnapshot()).toHaveLength(2);

    const integration = verifyLatejoinAndReconnect(AIRSTRIKE_EVENT, director, () => {
      now = 1_000;
      director.hostUpdate(1_000, false);
      system.update(now);
    });
    expect(director.getPresentationState()?.[0].state).toBe('completed');
    expect(system.getSnapshot()).toEqual([]);

    verifyNewRoundStartsHydrated(director, integration.presenter, integration.messages, 1);
    expect(system.getSnapshot()).toEqual([]);
  });

  it('hydrates an active Ground Hazard occurrence and clears its real fire state on teardown', () => {
    let now = 0;
    const fireSystem = new FireSystem({} as never);
    const handler = new CoopDefenseGroundHazardEventHandler({
      fireSystem,
      prebuiltZones: [{
        eventId: HAZARD_EVENT.id,
        id: 'hazard:zone',
        cells: [{ gridX: 4, gridY: 4 }],
      }],
      getNowMs: () => now,
    });
    const director = new CoopDefenseMapEventDirector([HAZARD_EVENT], [handler]);

    director.hostUpdate(0, false);
    expect(director.getPresentationState()?.[0].state).toBe('active');
    expect(fireSystem.hostUpdate(now).ground.cells).toHaveLength(4);

    const integration = verifyLatejoinAndReconnect(HAZARD_EVENT, director, () => {
      now = 1_000;
      director.hostUpdate(1_000, false);
    });
    expect(director.getPresentationState()?.[0].state).toBe('completed');
    expect(fireSystem.hostUpdate(now).ground.cells).toEqual([]);

    verifyNewRoundStartsHydrated(director, integration.presenter, integration.messages, 1);
    expect(fireSystem.hostUpdate(now).ground.cells).toEqual([]);
  });
});
