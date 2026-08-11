import { describe, expect, it } from 'vitest';
import {
  getCoopDefenseMapConfig,
  normalizeCoopDefenseMapConfig,
  resolveCoopDefenseMapEncounterConfigs,
  type CoopDefenseMapObjective,
  type CoopDefenseMapConfig,
} from '../src/config/coopDefenseMaps';

function makeMap(
  encounters: CoopDefenseMapConfig['encounters'],
  objective: CoopDefenseMapObjective | undefined = 'repel-assault',
  persistentSpawns: CoopDefenseMapConfig['persistentSpawns'] = [],
  extras: Partial<CoopDefenseMapConfig> = {},
): CoopDefenseMapConfig {
  return {
    mapId: 'encounter-test',
    displayName: 'Encounter test',
    balanceReferenceDurationSec: 60,
    bases: [{
      id: 'friendly-main',
      hpMax: 100,
      anchor: { kind: 'right-center', edgeInsetCells: 0 },
      shape: { kind: 'rectangle', widthCells: 1, heightCells: 1 },
    }],
    powerUps: [],
    persistentSpawns,
    encounters,
    objective: objective === undefined ? 'repel-assault' : objective,
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
        groups: [{
          enemyKind: 'zombie-badger',
          count: 3,
          delayMs: 0,
          spawnStaggerMs: 1_500,
          front: 'west',
        }],
      },
    ]);
    expect(resolveCoopDefenseMapEncounterConfigs(normalized, 4)).toEqual([
      {
        id: 'opening',
        start: { type: 'time', atMs: 0 },
        restAfterMs: 0,
        groups: [{
          enemyKind: 'zombie-badger',
          count: 3,
          delayMs: 0,
          spawnStaggerMs: 1_500,
          front: 'west',
        }],
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

  it('allows a group to override or disable the default stagger window', () => {
    const normalized = normalizeCoopDefenseMapConfig(makeMap([{
      id: 'configured-wave',
      start: { type: 'time', atMs: 0 },
      groups: [
        { enemyKind: 'zombie-badger', count: 2, spawnStaggerMs: 275 },
        { enemyKind: 'demon-badger', count: 2, spawnStaggerMs: 0 },
      ],
    }]));

    expect(normalized.encounters?.[0]?.groups.map((group) => group.spawnStaggerMs)).toEqual([275, 0]);
    expect(resolveCoopDefenseMapEncounterConfigs(normalized, 1)[0]?.groups.map(
      (group) => group.spawnStaggerMs,
    )).toEqual([275, 0]);
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

  it('requires explicit objective, friendly main base and bounded survival metadata', () => {
    const valid = makeMap([
      { id: 'opening', start: { type: 'time', atMs: 0 }, groups: [{ enemyKind: 'zombie-badger', count: 1 }] },
    ]);
    expect(() => normalizeCoopDefenseMapConfig({ ...valid, objective: undefined as never }))
      .toThrow('valid explicit objective');
    expect(() => normalizeCoopDefenseMapConfig({ ...valid, bases: [] }))
      .toThrow('friendly main base');
    expect(() => normalizeCoopDefenseMapConfig({
      ...valid,
      objective: 'survive',
      surviveDurationSec: 60,
    })).toThrow('surviveRespawnsPerPlayer');
    expect(() => normalizeCoopDefenseMapConfig({
      ...valid,
      balanceReferenceDurationSec: 0,
    })).toThrow('balanceReferenceDurationSec');
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

  it('configures the Map 0 side missions alongside its encounters', () => {
    const map = getCoopDefenseMapConfig('0');
    expect(map.persistentSpawns).toHaveLength(3);
    expect(map.persistentSpawns?.every((spawn) => spawn.source.type === 'base')).toBe(true);
    expect(new Set(map.persistentSpawns?.map((spawn) => (
      spawn.source.type === 'base' ? spawn.source.baseId : 'map-source'
    )))).toEqual(new Set(map.secondaryObjectives?.[0]?.targets));
    expect(map.encounters).toHaveLength(3);
    const encounter = resolveCoopDefenseMapEncounterConfigs(map, 1)[0];
    expect(encounter?.id).toBe('a2-opening-encounter');
    expect(encounter?.start).toEqual({ type: 'time', atMs: 1_500 });
    expect(encounter?.restAfterMs).toBeGreaterThan(0);
    expect(encounter?.groups.every((group) => group.front === 'west')).toBe(true);
    expect(encounter?.groups.every((group) => group.count > 0 && group.delayMs >= 0)).toBe(true);
    expect(map.encounters?.[1]?.start).toEqual({ type: 'after-previous' });
    expect(map.encounters?.[2]?.id).toBe('a2-hold-encounter');
    // Der Hold braucht ein lesbares Fenster zwischen Reveal und Angriff.
    expect(map.encounters?.[1]?.restAfterMs).toBeGreaterThan(0);
    expect(map.secondaryObjectives).toEqual([
      expect.objectContaining({
        id: 'destroy-brood-front',
        start: { type: 'after-encounter', encounterId: 'a2-opening-encounter' },
        focusUntil: { type: 'after-encounter', encounterId: 'a2-follow-up-encounter' },
        targets: expect.arrayContaining([
          'destroy-brood-front-north',
          'destroy-brood-front-center',
          'destroy-brood-front-south',
        ]),
        rewards: { xpPerTarget: 25 },
      }),
      // Die Fokusfenster stossen aneinander an, statt sich zu ueberschneiden: Der Destroy-Auftrag
      // gibt den Slot mit dem Clear von a2-follow-up-encounter genau dann frei, wenn der Hold ihn
      // uebernimmt.
      expect.objectContaining({
        id: 'hold-forward-outpost',
        start: { type: 'after-encounter', encounterId: 'a2-follow-up-encounter' },
        holdUntil: { type: 'after-encounter', encounterId: 'a2-hold-encounter' },
        targets: ['forward-outpost'],
        targetGoal: 1,
        rewards: { repairTargetOnComplete: true },
      }),
    ]);
    expect(map.secondaryObjectives?.[1]).not.toHaveProperty('focusUntil');

    const outpost = map.bases.find((base) => base.id === 'forward-outpost');
    expect(outpost).toMatchObject({
      role: 'outpost',
      faction: 'friendly',
      dormant: true,
      startHpFactor: 0.25,
    });
    expect(outpost?.turrets?.map((turret) => turret.weaponId)).toEqual(['TURRET_ROCKET', 'TURRET_ROCKET']);
  });
});
