import { describe, expect, it } from 'vitest';
import {
  getCoopDefenseMapConfig,
  normalizeCoopDefenseMapConfig,
  resolveCoopDefenseMapEncounterConfigs,
  type CoopDefenseMapConfig,
} from '../src/config/coopDefenseMaps';

function makeMap(encounters: CoopDefenseMapConfig['encounters']): CoopDefenseMapConfig {
  return {
    mapId: 'encounter-test',
    displayName: 'Encounter test',
    roundDurationSec: 60,
    bases: [],
    powerUps: [],
    waves: [],
    encounters,
  };
}

describe('Coop defense encounters', () => {
  it('normalizes ids and non-negative times while resolving scaled group counts', () => {
    const normalized = normalizeCoopDefenseMapConfig(makeMap([
      {
        id: '  opening  ',
        startAtMs: -25,
        restAfterMs: -100,
        groups: [{ enemyKind: 'zombie-badger', count: 3.9, delayMs: -100 }],
      },
    ]));

    expect(normalized.encounters).toEqual([
      {
        id: 'opening',
        startAtMs: 0,
        restAfterMs: 0,
        groups: [{ enemyKind: 'zombie-badger', count: 3, delayMs: 0 }],
      },
    ]);
    expect(resolveCoopDefenseMapEncounterConfigs(normalized, 4)).toEqual([
      {
        id: 'opening',
        startAtMs: 0,
        restAfterMs: 0,
        groups: [{ enemyKind: 'zombie-badger', count: 3, delayMs: 0 }],
      },
    ]);
  });

  it('rejects duplicate ids, unknown enemy kinds and invalid counts', () => {
    expect(() => normalizeCoopDefenseMapConfig(makeMap([
      { id: 'opening', groups: [{ enemyKind: 'zombie-badger', count: 1 }] },
      { id: ' opening ', groups: [{ enemyKind: 'demon-badger', count: 1 }] },
    ]))).toThrow('Duplicate encounter id');

    expect(() => normalizeCoopDefenseMapConfig(makeMap([
      { id: 'unknown-enemy', groups: [{ enemyKind: 'not-an-enemy', count: 1 }] },
    ]))).toThrow('unknown enemy kind');

    expect(() => normalizeCoopDefenseMapConfig(makeMap([
      { id: 'empty-group', groups: [{ enemyKind: 'zombie-badger', count: 0 }] },
    ]))).toThrow('positive finite group counts');
  });

  it('keeps the A2 test encounter isolated on Map 0', () => {
    const map = getCoopDefenseMapConfig('0');
    expect(map.waves).toEqual([]);
    expect(map.encounters).toHaveLength(1);
    expect(resolveCoopDefenseMapEncounterConfigs(map, 1)).toEqual([
      {
        id: 'a2-opening-encounter',
        startAtMs: 1_500,
        restAfterMs: 0,
        groups: [
          { enemyKind: 'zombie-badger', count: 4, delayMs: 0 },
          { enemyKind: 'demon-badger', count: 2, delayMs: 1_500 },
        ],
      },
    ]);
  });
});
