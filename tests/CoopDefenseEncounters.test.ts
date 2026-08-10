import { describe, expect, it } from 'vitest';
import {
  getCoopDefenseMapConfig,
  normalizeCoopDefenseMapConfig,
  resolveCoopDefenseMapEncounterConfigs,
  type CoopDefenseMapConfig,
} from '../src/config/coopDefenseMaps';

function makeMap(
  encounters: CoopDefenseMapConfig['encounters'],
  objective?: CoopDefenseMapConfig['objective'],
  persistentSpawns: CoopDefenseMapConfig['persistentSpawns'] = [],
  extras: Partial<CoopDefenseMapConfig> = {},
): CoopDefenseMapConfig {
  return {
    mapId: 'encounter-test',
    displayName: 'Encounter test',
    roundDurationSec: 60,
    bases: [],
    powerUps: [],
    persistentSpawns,
    encounters,
    objective,
    ...extras,
  };
}

describe('Coop defense encounters', () => {
  it('normalizes ids and non-negative times while resolving scaled group counts', () => {
    const normalized = normalizeCoopDefenseMapConfig(makeMap([
      {
        id: '  opening  ',
        start: { type: 'time', atMs: -25 },
        restAfterMs: -100,
        groups: [{ enemyKind: 'zombie-badger', count: 3.9, delayMs: -100 }],
      },
    ]));

    expect(normalized.encounters).toEqual([
      {
        id: 'opening',
        start: { type: 'time', atMs: 0 },
        restAfterMs: 0,
        groups: [{ enemyKind: 'zombie-badger', count: 3, delayMs: 0, front: 'west' }],
      },
    ]);
    expect(resolveCoopDefenseMapEncounterConfigs(normalized, 4)).toEqual([
      {
        id: 'opening',
        start: { type: 'time', atMs: 0 },
        restAfterMs: 0,
        groups: [{ enemyKind: 'zombie-badger', count: 3, delayMs: 0, front: 'west' }],
      },
    ]);
  });

  it('rejects duplicate ids, unknown enemy kinds and invalid counts', () => {
    expect(() => normalizeCoopDefenseMapConfig(makeMap([
      { id: 'opening', start: { type: 'time', atMs: 0 }, groups: [{ enemyKind: 'zombie-badger', count: 1 }] },
      { id: ' opening ', start: { type: 'time', atMs: 0 }, groups: [{ enemyKind: 'demon-badger', count: 1 }] },
    ]))).toThrow('Duplicate encounter id');

    expect(() => normalizeCoopDefenseMapConfig(makeMap([
      { id: 'unknown-enemy', start: { type: 'time', atMs: 0 }, groups: [{ enemyKind: 'not-an-enemy', count: 1 }] },
    ]))).toThrow('unknown enemy kind');

    expect(() => normalizeCoopDefenseMapConfig(makeMap([
      { id: 'empty-group', start: { type: 'time', atMs: 0 }, groups: [{ enemyKind: 'zombie-badger', count: 0 }] },
    ]))).toThrow('positive finite group counts');

    expect(() => normalizeCoopDefenseMapConfig(makeMap([
      { id: 'boss-group', start: { type: 'time', atMs: 0 }, groups: [{ enemyKind: 'void-hunter', count: 1 }] },
    ]))).toThrow('unique boss slot');
  });

  it('requires encounters for repel-assault maps while allowing parallel persistent pressure', () => {
    expect(() => normalizeCoopDefenseMapConfig(makeMap(undefined, 'repel-assault')))
      .toThrow('needs at least one encounter');
    expect(() => normalizeCoopDefenseMapConfig(makeMap([], 'repel-assault')))
      .toThrow('needs at least one encounter');
    const normalized = normalizeCoopDefenseMapConfig(makeMap(
      [{ id: 'opening', start: { type: 'time', atMs: 0 }, groups: [{ enemyKind: 'zombie-badger', count: 1 }] }],
      'repel-assault',
      [{
        id: 'background-pressure',
        enemyKind: 'zombie-badger',
        intervalMs: 1_000,
        countPerTick: 1,
        source: { type: 'map' },
      }],
    ));
    expect(normalized.persistentSpawns).toHaveLength(1);
    expect(normalized.encounters).toHaveLength(1);
  });

  it('validates the typed trigger references while normalizing them', () => {
    expect(() => normalizeCoopDefenseMapConfig(makeMap([
      {
        id: 'invalid-trigger',
        start: { type: 'not-a-trigger' } as never,
        groups: [{ enemyKind: 'zombie-badger', count: 1 }],
      },
    ]))).toThrow('unknown start trigger');

    expect(() => normalizeCoopDefenseMapConfig(makeMap([
      {
        id: 'first-after-previous',
        start: { type: 'after-previous' },
        groups: [{ enemyKind: 'zombie-badger', count: 1 }],
      },
    ]))).toThrow('no previous encounter');

    expect(() => normalizeCoopDefenseMapConfig(makeMap([
      {
        id: 'needs-airstrike',
        start: { type: 'opening-airstrike-complete' },
        groups: [{ enemyKind: 'zombie-badger', count: 1 }],
      },
    ]))).toThrow('opening airstrike barrage');

    expect(() => normalizeCoopDefenseMapConfig(makeMap([
      {
        id: 'needs-boss',
        start: { type: 'boss-phase', phase: 2 },
        groups: [{ enemyKind: 'zombie-badger', count: 1 }],
      },
    ]))).toThrow('Void Hunter boss');

    expect(() => normalizeCoopDefenseMapConfig(makeMap([
      {
        id: 'needs-base',
        start: { type: 'base-destroyed', baseId: 'missing-base' },
        groups: [{ enemyKind: 'zombie-badger', count: 1 }],
      },
    ]))).toThrow('unknown base');

    const normalized = normalizeCoopDefenseMapConfig(makeMap([
      {
        id: 'base-counterattack',
        start: { type: 'base-destroyed', baseId: 'base-a' },
        groups: [{ enemyKind: 'zombie-badger', count: 1 }],
      },
    ], undefined, [], {
      bases: [{
        id: 'base-a',
        hpMax: 1,
        anchor: { kind: 'right-center', edgeInsetCells: 0 },
        shape: { kind: 'rectangle', widthCells: 1, heightCells: 1 },
      }],
    }));
    expect(normalized.encounters?.[0].start).toEqual({ type: 'base-destroyed', baseId: 'base-a' });
  });

  it('keeps the A2 test encounter isolated on Map 0', () => {
    const map = getCoopDefenseMapConfig('0');
    expect(map.persistentSpawns).toEqual([]);
    expect(map.encounters).toHaveLength(1);
    expect(resolveCoopDefenseMapEncounterConfigs(map, 1)).toEqual([
      {
        id: 'a2-opening-encounter',
        start: { type: 'time', atMs: 1_500 },
        restAfterMs: 0,
        groups: [
          { enemyKind: 'zombie-badger', count: 4, delayMs: 0, front: 'west' },
          { enemyKind: 'demon-badger', count: 2, delayMs: 1_500, front: 'west' },
        ],
      },
    ]);
  });
});
