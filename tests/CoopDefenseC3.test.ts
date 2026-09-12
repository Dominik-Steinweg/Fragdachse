import { generateArenaWithActiveMetrics } from './ArenaGeneratorTestHelper';
import authoredMap16 from '../src/config/coopDefenseMaps/16-zeitzuender.json';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Angle: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1),
    },
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
  },
}));
vi.mock('../src/network/bridge', () => ({
  bridge: { getCoopDefenseMapId: () => '16' },
}));

import {
  getCoopDefenseMapConfig,
  normalizeCoopDefenseMapConfig,
  type CoopDefenseMapConfig,
  type CoopDefenseMapGroundHazardEventConfig,
} from '../src/config/coopDefenseMaps';
import { RockGridIndex } from '../src/arena/RockGridIndex';
import { resolveCoopDefenseBases } from '../src/arena/BaseRegistry';
import { resolvePersistentBaseBuildAreaForStage } from '../src/persistentBase/PersistentBaseCore';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE, applyArenaMetricsForMode } from '../src/config';
import { COOP_DEFENSE_CONSTRUCTIONS } from '../src/config/coopDefenseConstructions';
import type { PlayerManager } from '../src/entities/PlayerManager';
import { resolveActiveArenaWorldMetrics } from '../src/world/WorldMetrics';
import { PlacementSystem } from '../src/systems/PlacementSystem';
import type { ArenaLayout } from '../src/types';
import { COOP_DEFENSE_MODE } from '../src/gameModes';
import { CoopDefenseGroundHazardEventHandler } from '../src/systems/CoopDefenseGroundHazardEventHandler';
import {
  CoopDefenseMapEventDirector,
  type CoopDefenseMapEventCycleFinished,
} from '../src/systems/CoopDefenseMapEventDirector';

function makeMap(overrides: Partial<CoopDefenseMapConfig>): CoopDefenseMapConfig {
  return {
    mapId: 'c3-test',
    displayName: 'C3 test',
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

function makeEvent(
  overrides: Partial<CoopDefenseMapGroundHazardEventConfig> = {},
): CoopDefenseMapGroundHazardEventConfig {
  return {
    id: 'hazard',
    type: 'ground-hazard',
    start: { type: 'time', atMs: 0 },
    delayMs: 1_000,
    durationMs: 18_000,
    area: { type: 'rectangle', gridX: 4, gridY: 4, widthCells: 2, heightCells: 2 },
    effect: {
      visualStyle: 'void',
      burnDurationMs: 2_000,
      burnDamagePerTick: 0.5,
      sourceId: 'test.c3-fire',
    },
    ...overrides,
  };
}

function makeZone(eventId: string) {
  return [{ eventId, id: `${eventId}:zone`, cells: [{ gridX: 4, gridY: 4 }] }];
}

describe('Coop Defense C3 configuration', () => {
  it('lets void touch the actual base footprint while preserving explicitly positive clearance', () => {
    const map = getCoopDefenseMapConfig('16');
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', map.arenaWidthCells, map.arenaHeightCells);
    const cell = resolveCoopDefenseBases(map).find(base => base.id === map.persistentBase?.baseId)!.cells[0];
    const events = [
      makeEvent({ id: 'touch', area: { type: 'cells', cells: [cell], baseClearanceCells: 0 } }),
      makeEvent({ id: 'protected', area: { type: 'cells', cells: [cell], baseClearanceCells: 1 } }),
    ];
    const config = normalizeCoopDefenseMapConfig({ ...authoredMap16 as unknown as CoopDefenseMapConfig, mapEvents: events });
    const zones = generateArenaWithActiveMetrics(902, config).groundHazardZones ?? [];
    expect(zones.find(zone => zone.eventId === 'touch')?.cells).toContainEqual(cell);
    expect(zones.some(zone => zone.eventId === 'protected')).toBe(false);
  });

  it('keeps the entire expanded final base area outside Map 14 maximum fire extent', () => {
    const map = getCoopDefenseMapConfig('14');
    const fire = map.mapEvents!.find(event => event.type === 'ground-hazard' && event.spread)!;
    expect(fire.type).toBe('ground-hazard');
    if (fire.type !== 'ground-hazard' || fire.area.type !== 'rectangle') throw new Error('Missing front');
    const expanded = resolvePersistentBaseBuildAreaForStage(2);
    if (expanded.kind !== 'radius') throw new Error('Expected expanded radius');
    expect(map.persistentBase!.anchor.gridX - expanded.radiusCells).toBeGreaterThanOrEqual(fire.area.gridX + fire.area.widthCells);
  });
  it('normalizes rectangle, cells and random-patches areas with finite and persistent lifecycles', () => {
    const normalized = normalizeCoopDefenseMapConfig(makeMap({
      mapEvents: [
        makeEvent({
          id: 'rectangle',
          area: { type: 'rectangle', gridX: 2, gridY: 2, widthCells: 4, heightCells: 3 },
        }),
        makeEvent({
          id: 'cells',
          durationMs: undefined,
          area: { type: 'cells', cells: [{ gridX: 10, gridY: 10 }, { gridX: 11, gridY: 10 }] },
        }),
        makeEvent({
          id: 'patches',
          area: {
            type: 'random-patches',
            randomPatchCount: 2,
            minPatchRadiusCells: 1,
            maxPatchRadiusCells: 2,
            baseClearanceCells: 2,
          },
        }),
      ],
    }));

    expect(normalized.mapEvents).toMatchObject([
      { id: 'rectangle', type: 'ground-hazard', durationMs: 18_000 },
      { id: 'cells', type: 'ground-hazard' },
      { id: 'patches', type: 'ground-hazard', area: { type: 'random-patches', randomPatchCount: 2 } },
    ]);
    expect(normalized.mapEvents?.[1]).not.toHaveProperty('durationMs');
  });

  it('accepts finite hazards as after-event sources but rejects persistent hazards', () => {
    const finite = makeEvent({ id: 'finite' });
    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      mapEvents: [finite],
      encounters: [{
        id: 'after-hazard',
        start: { type: 'after-event', eventId: 'finite' },
        groups: [{ enemyKind: 'zombie-badger', count: 1 }],
      }],
    }))).not.toThrow();

    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      mapEvents: [makeEvent({ id: 'persistent', durationMs: undefined })],
      encounters: [{
        id: 'after-hazard',
        start: { type: 'after-event', eventId: 'persistent' },
        groups: [{ enemyKind: 'zombie-badger', count: 1 }],
      }],
    }))).toThrow(/repeatable or persistent/);
  });

  it('rejects invalid hazard geometry and non-positive active durations', () => {
    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      mapEvents: [makeEvent({ durationMs: 0 })],
    }))).toThrow(/durationMs/);
    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      mapEvents: [makeEvent({
        area: { type: 'rectangle', gridX: 59, gridY: 4, widthCells: 2, heightCells: 2 },
      })],
    }))).toThrow(/outside the arena/);
    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      mapEvents: [makeEvent({
        area: { type: 'cells', cells: [{ gridX: 4, gridY: 4 }, { gridX: 4, gridY: 4 }] },
      })],
    }))).toThrow(/duplicate cells/);
  });

  it('validates boss-phase and base-destroyed references at map load', () => {
    const bossMap = getCoopDefenseMapConfig('15');
    expect(() => normalizeCoopDefenseMapConfig({
      ...bossMap,
      bases: bossMap.bases.filter((base) => base.id !== bossMap.persistentBase?.baseId),
      mapEvents: [makeEvent({ start: { type: 'boss-phase', phase: 2 } })],
    })).not.toThrow();

    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      mapEvents: [makeEvent({ start: { type: 'boss-phase', phase: 2 } })],
    }))).toThrow(/Void Hunter boss/);
    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      mapEvents: [makeEvent({ start: { type: 'base-destroyed', baseId: 'missing' } })],
    }))).toThrow(/unknown base/);
  });

  it('drops an unresolvable authored footprint instead of failing the arena build', () => {
    // Kampagnen-Map 16 statt Map 0: Die Testarena ist seit Block A eine loeschbare Stressarena
    // ohne authored Events und darf keine Regression mehr tragen.
    const map = getCoopDefenseMapConfig('16');
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', map.arenaWidthCells, map.arenaHeightCells);
    // Eine Zellenliste komplett auf reservierten Basiszellen ist konfigvalide, aber nicht
    // aufloesbar. Der Generator liefert dafuer keine Zone -- der Handler laesst das Event dann
    // dormant. Ein Layout-Retry bis zum Abbruch waere fuer einen Authoring-Fehler unverhaeltnismaessig.
    const withUnreachableHazard = normalizeCoopDefenseMapConfig({
      ...authoredMap16 as unknown as CoopDefenseMapConfig,
      mapEvents: [
        ...(map.mapEvents ?? []),
        makeEvent({
          id: 'unreachable',
          area: { type: 'cells', cells: [{ gridX: 0, gridY: 0 }], baseClearanceCells: 999 },
        }),
      ],
    });

    const layout = generateArenaWithActiveMetrics(73_000, withUnreachableHazard);
    expect(layout.groundHazardZones?.some((zone) => zone.eventId === 'unreachable')).toBe(false);
    expect(layout.groundHazardZones?.length).toBeGreaterThan(0);
  });

  it('prebuilds every authored hazard event from the selected arena seed', () => {
    const map = getCoopDefenseMapConfig('16');
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', map.arenaWidthCells, map.arenaHeightCells);
    const layout = generateArenaWithActiveMetrics(73_000, map);
    const eventIds = new Set(map.mapEvents?.map((event) => event.id));
    expect(layout.groundHazardZones?.length).toBeGreaterThan(0);
    expect(layout.groundHazardZones?.every((zone) => eventIds.has(zone.eventId))).toBe(true);
    expect(generateArenaWithActiveMetrics(73_000, map).groundHazardZones).toEqual(layout.groundHazardZones);
  });
});

describe('Coop Defense C3 ground hazard lifecycle', () => {
  afterEach(() => vi.restoreAllMocks());

  it('replicates only the local warning rim, catches up late starts and retries reached blocked cells', () => {
    let now = 0;
    let blocked = true;
    const lit = new Set<string>();
    let warnings: Array<{ gridX: number; gridY: number; activatesAt: number }> = [];
    const event = makeEvent({ durationMs: undefined, start: { type: 'time', atMs: 500 }, delayMs: 500,
      area: { type: 'rectangle', gridX: 4, gridY: 4, widthCells: 6, heightCells: 2 },
      spread: { direction: 'left-to-right', durationMs: 6000, roughnessCells: 1, warningLeadMs: 500 } });
    const cells = Array.from({ length: 12 }, (_, i) => ({ gridX: 4 + i % 6, gridY: 4 + Math.floor(i / 6) }));
    const handler = new CoopDefenseGroundHazardEventHandler({ worldSeed: 33, getNowMs: () => now,
      prebuiltZones: [{ eventId: event.id, id: 'zone', cells }],
      fireSystem: {
        hostRefreshGroundCell: (x, y, options) => {
          if (blocked) return false;
          expect(options.permanent).toBe(true); lit.add(`${x}:${y}`); return true;
        },
        hostSetGroundWarnings: (_key, next) => { warnings = next; },
        hostRemoveGroundSourcesBySourceKey: () => { lit.clear(); warnings = []; },
      },
    });
    const director = new CoopDefenseMapEventDirector([event], [handler]);
    now = 750; director.hostUpdate(now, false);
    expect(lit.size).toBe(0); expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.length).toBeLessThan(cells.length * 4);
    expect(warnings.every(cell => cell.activatesAt > now && cell.activatesAt <= now + 500)).toBe(true);
    now = 7000; director.hostUpdate(6250, false);
    expect(warnings).toEqual([]); expect(lit.size).toBe(0);
    blocked = false; now = 7500; director.hostUpdate(500, false);
    expect(lit.size).toBe(cells.length * 4);
    now = 100000; director.hostUpdate(92500, false);
    expect(lit.size).toBe(cells.length * 4);
    director.reset(); expect(lit.size).toBe(0); expect(warnings).toEqual([]);
  });

  function createHarness(events: readonly CoopDefenseMapGroundHazardEventConfig[]) {
    let now = 0;
    let blockedCells = 0;
    const refreshes: Array<{ sourceKey?: string; durationMs?: number; permanent?: boolean; static?: boolean }> = [];
    const removals: string[] = [];
    const handler = new CoopDefenseGroundHazardEventHandler({
      fireSystem: {
        hostRefreshGroundCell: (_x, _y, options) => {
          // Bauwerke belegen im FireSystem ganze Rasterzellen; der Handler sieht davon nur das
          // abgelehnte Ergebnis.
          if (blockedCells > 0) {
            blockedCells -= 1;
            return false;
          }
          refreshes.push(options);
          return true;
        },
        hostRemoveGroundSourcesBySourceKey: (sourceKey) => removals.push(sourceKey),
      },
      prebuiltZones: events.flatMap((event) => makeZone(event.id)),
      getNowMs: () => now,
    });
    const director = new CoopDefenseMapEventDirector(events, [handler]);
    return {
      director,
      refreshes,
      removals,
      setNow(value: number): void { now = value; },
      blockNextCells(count: number): void { blockedCells = count; },
    };
  }

  it('keeps prebuilt cells inert until the warning delay, then completes a finite hazard', () => {
    const harness = createHarness([makeEvent()]);
    harness.director.hostUpdate(0, false);
    expect(harness.refreshes).toEqual([]);
    expect(harness.director.getPresentationState()?.[0].state).toBe('scheduled');

    harness.setNow(1_000);
    harness.director.hostUpdate(1_000, false);
    expect(harness.refreshes).toHaveLength(4);
    expect(harness.refreshes.every((entry) => (
      entry.durationMs === 18_000 && entry.permanent === false && entry.static === false
    ))).toBe(true);
    expect(harness.director.getPresentationState()?.[0].state).toBe('active');

    harness.setNow(19_000);
    harness.director.hostUpdate(18_000, false);
    expect(harness.removals).toEqual(['map-event:hazard:1']);
    expect(harness.director.getPresentationState()?.[0].state).toBe('completed');
  });

  it('keeps a persistent hazard active and owns cleanup without touching other source keys', () => {
    const harness = createHarness([
      makeEvent({ id: 'persistent', delayMs: 0, durationMs: undefined }),
      makeEvent({ id: 'finite', delayMs: 0, durationMs: 100 }),
    ]);
    harness.director.hostUpdate(0, false);
    expect(harness.refreshes).toHaveLength(8);
    expect(harness.refreshes.filter((entry) => entry.permanent)).toHaveLength(4);
    expect(harness.refreshes.filter((entry) => entry.static)).toHaveLength(4);
    expect(harness.refreshes.filter((entry) => entry.static === false)).toHaveLength(4);

    harness.setNow(10_000);
    harness.director.hostUpdate(10_000, false);
    expect(harness.director.getPresentationState()?.map((entry) => entry.state)).toEqual(['active', 'completed']);
    expect(harness.removals).toEqual(['map-event:finite:1']);
  });

  it('drives trigger, activation and completion from the round clock alone', () => {
    // Die Wanduhr der Umgebung bleibt hier bewusst auf 0 stehen: Trigger, Aktivierung und
    // Completion haengen allein an den Frame-Deltas, die der Director summiert. Andernfalls
    // wuerde ein Tab-Wechsel oder Frame-Stall die Warnzeit verkuerzen und die Completion vor dem
    // Lifecycle des Directors ankommen lassen.
    const harness = createHarness([makeEvent()]);

    harness.director.hostUpdate(0, false);
    expect(harness.refreshes).toEqual([]);

    harness.director.hostUpdate(1_000, false);
    expect(harness.refreshes).toHaveLength(4);

    harness.director.hostUpdate(18_000, false);
    expect(harness.director.getPresentationState()?.[0].state).toBe('completed');
  });

  it('lights blocked cells as soon as the construction on them is gone', () => {
    const harness = createHarness([makeEvent({ delayMs: 0 })]);
    // Zwei der vier Rasterzellen sind beim Aktivieren von einem Bauwerk belegt.
    harness.blockNextCells(2);
    harness.setNow(0);
    harness.director.hostUpdate(0, false);
    expect(harness.refreshes).toHaveLength(2);

    // Vor dem naechsten Nachzuendeversuch passiert nichts.
    harness.setNow(200);
    harness.director.hostUpdate(200, false);
    expect(harness.refreshes).toHaveLength(2);

    harness.setNow(600);
    harness.director.hostUpdate(400, false);
    expect(harness.refreshes).toHaveLength(4);
    // Die nachgezuendete Zelle erbt nur die Restlaufzeit und ueberlebt das Event nicht.
    expect(harness.refreshes[3].durationMs).toBe((makeEvent().durationMs ?? 0) - 600);

    harness.setNow(18_000);
    harness.director.hostUpdate(17_400, false);
    expect(harness.director.getPresentationState()?.[0].state).toBe('completed');
  });

  it('opens dormant hazard ground for building and locks it from the announcement on', () => {
    const hazardLayout: ArenaLayout = {
      seed: 1,
      rocks: [],
      trees: [],
      tracks: [],
      dirt: [],
      powerUpPedestals: [],
      groundHazardZones: [{ eventId: 'hazard', id: 'hazard:zone', cells: [{ gridX: 4, gridY: 3 }] }],
    };
    const placeOnHazardCell = (armed: boolean | null, danger?: boolean) => {
      const placement = new PlacementSystem(
        hazardLayout,
        new RockGridIndex([]),
        { getAllPlayers: () => [] } as unknown as PlayerManager,
        resolveActiveArenaWorldMetrics(),
      );
      if (armed !== null) placement.setHazardEventArmedResolver(() => armed);
      if (danger !== undefined) placement.setGroundHazardCellDangerResolver(() => danger);
      return placement.tryPlaceConstruction(
        COOP_DEFENSE_CONSTRUCTIONS.medic_pedestal,
        1,
        'inspector',
        0x52d273,
        ARENA_OFFSET_X + CELL_SIZE * 3.5,
        ARENA_OFFSET_Y + CELL_SIZE * 3.5,
        ARENA_OFFSET_X + CELL_SIZE * 4.5,
        ARENA_OFFSET_Y + CELL_SIZE * 3.5,
      );
    };

    // Dormant: Ein Event, das vielleicht nie eintritt, darf keine Arena-Flaeche sterilisieren.
    expect(placeOnHazardCell(false)).toMatchObject({ gridX: 4, gridY: 3 });
    // Ab der Ankuendigung gesperrt -- und ohne Lifecycle-Wissen bleibt es konservativ gesperrt.
    expect(placeOnHazardCell(true)).toBeNull();
    expect(placeOnHazardCell(null)).toBeNull();
    expect(placeOnHazardCell(true, false)).toMatchObject({ gridX: 4, gridY: 3 });
    expect(placeOnHazardCell(true, true)).toBeNull();
  });

  it('accepts a completion that arrives before the announced cycle turned active', () => {
    // Kann bei einer Uhr nicht mehr passieren; die Toleranz verhindert, dass ein Event sonst
    // dauerhaft in `scheduled` haengt und jede `after-event`-Kette blockiert.
    const events = [makeEvent({ id: 'early', delayMs: 5_000, durationMs: 1_000 })];
    let onFinished: ((completion: CoopDefenseMapEventCycleFinished) => void) | null = null;
    const director = new CoopDefenseMapEventDirector(events, [{
      type: 'ground-hazard',
      schedule: () => true,
      hostUpdate: () => undefined,
      reset: () => undefined,
      setCycleFinishedCallback: (callback) => { onFinished = callback; },
    }]);

    director.hostUpdate(0, false);
    expect(director.getPresentationState()?.[0].state).toBe('scheduled');

    onFinished?.({ eventId: 'early', occurrence: 1, completedAtMs: 0 });
    expect(director.getPresentationState()?.[0].state).toBe('completed');
    expect(director.isEventCompleted('early')).toBe(true);
  });
});
