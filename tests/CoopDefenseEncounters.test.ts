import { describe, expect, it } from 'vitest';
import {
  getCoopDefenseMapConfig,
  normalizeCoopDefenseMapConfig,
  resolveCoopDefenseMapEncounterConfigs,
  DEFAULT_COOP_DEFENSE_ENCOUNTER_SPAWN_STAGGER_MS,
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
          spawnStaggerMs: DEFAULT_COOP_DEFENSE_ENCOUNTER_SPAWN_STAGGER_MS,
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
          spawnStaggerMs: DEFAULT_COOP_DEFENSE_ENCOUNTER_SPAWN_STAGGER_MS,
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
    })).toThrow('respawnsPerPlayer');
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
        id: 'needs-event',
        start: { type: 'after-event', eventId: 'missing-event' },
        groups: [{ enemyKind: 'zombie-badger', count: 1 }],
      },
    ]))).toThrow('unknown map event');

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

  /**
   * Die Verzahnung von Encounter-Kette, Nebenzielen und strukturgebundenem Hintergrunddruck.
   *
   * Bewusst authored statt aus einer Karte gelesen: Der frueher hier benutzte Sandkasten war die
   * Testarena, und die traegt seit Block A nur noch Stressgeometrie. Alle geprueften Regeln
   * gehoeren ohnehin zur Normalisierung, nicht zu einer bestimmten Karte.
   */
  it('wires side missions, persistent pressure and the encounter chain together', () => {
    const map = normalizeCoopDefenseMapConfig(makeMap(
      [
        {
          id: 'opening',
          start: { type: 'time', atMs: 1_500 },
          restAfterMs: 12_000,
          groups: [{ enemyKind: 'zombie-badger', count: 4 }],
        },
        {
          id: 'follow-up',
          start: { type: 'after-previous' },
          restAfterMs: 10_000,
          groups: [{ enemyKind: 'zombie-badger', count: 5 }],
        },
        {
          id: 'hold-attack',
          start: { type: 'after-previous' },
          restAfterMs: 8_000,
          groups: [{ enemyKind: 'demon-badger', count: 2 }],
        },
        // Der Hold darf nicht am letzten Encounter haengen – sonst faellt sein Fenster mit dem
        // Rundenende zusammen und der Spieler koennte es nie abschliessen sehen.
        {
          id: 'closing',
          start: { type: 'after-previous' },
          groups: [{ enemyKind: 'zombie-badger', count: 3 }],
        },
      ],
      'repel-assault',
      [
        {
          id: 'north-pressure',
          enemyKind: 'zombie-badger',
          intervalMs: 5_000,
          countPerTick: 1,
          startAtMs: 0,
          source: { type: 'base', baseId: 'brood-north' },
        },
        {
          id: 'south-pressure',
          enemyKind: 'zombie-badger',
          intervalMs: 5_000,
          countPerTick: 1,
          startAtMs: 0,
          source: { type: 'base', baseId: 'brood-south' },
        },
      ],
      {
        bases: [
          {
            id: 'friendly-main',
            hpMax: 100,
            anchor: { kind: 'right-center', edgeInsetCells: 0 },
            shape: { kind: 'rectangle', widthCells: 1, heightCells: 1 },
          },
          {
            id: 'brood-north',
            hpMax: 100,
            faction: 'hostile',
            role: 'spawn-point',
            dormant: true,
            anchor: { kind: 'grid', gridX: 12, gridY: 3 },
            shape: { kind: 'rectangle', widthCells: 2, heightCells: 2 },
            spawnCenter: { gridX: 0, gridY: 0 },
          },
          {
            id: 'brood-south',
            hpMax: 100,
            faction: 'hostile',
            role: 'spawn-point',
            dormant: true,
            anchor: { kind: 'grid', gridX: 12, gridY: 20 },
            shape: { kind: 'rectangle', widthCells: 2, heightCells: 2 },
            spawnCenter: { gridX: 0, gridY: 0 },
          },
          {
            id: 'forward-outpost',
            hpMax: 1_200,
            startHpFactor: 0.25,
            role: 'outpost',
            dormant: true,
            anchor: { kind: 'grid', gridX: 30, gridY: 12 },
            shape: { kind: 'rectangle', widthCells: 2, heightCells: 2 },
            turrets: [
              { id: 'rocket-north', cellOffset: { gridX: 0, gridY: 0 }, mountSide: 'front', weaponId: 'TURRET_ROCKET_BURST' },
              { id: 'rocket-south', cellOffset: { gridX: 0, gridY: 1 }, mountSide: 'front', weaponId: 'TURRET_ROCKET_BURST' },
            ],
          },
        ],
        secondaryObjectives: [
          {
            id: 'destroy-brood',
            type: 'destroy',
            start: { type: 'after-encounter', encounterId: 'opening' },
            focusUntil: { type: 'after-encounter', encounterId: 'follow-up' },
            targets: ['brood-north', 'brood-south'],
            rewards: { xpPerTarget: 25 },
          },
          {
            id: 'hold-forward-outpost',
            type: 'hold',
            start: { type: 'after-encounter', encounterId: 'follow-up' },
            holdUntil: { type: 'after-encounter', encounterId: 'hold-attack' },
            targets: ['forward-outpost'],
          },
        ],
      },
    ));

    const destroyObjective = map.secondaryObjectives?.find((objective) => objective.id === 'destroy-brood');
    const holdObjective = map.secondaryObjectives?.find((objective) => objective.id === 'hold-forward-outpost');

    // Der Hintergrunddruck haengt an genau den Strukturen, die der Destroy-Auftrag abraeumt.
    expect(map.persistentSpawns).toHaveLength(2);
    expect(map.persistentSpawns?.every((spawn) => spawn.source.type === 'base')).toBe(true);
    expect(new Set(map.persistentSpawns?.map((spawn) => (
      spawn.source.type === 'base' ? spawn.source.baseId : 'map-source'
    )))).toEqual(new Set(destroyObjective?.targets));

    const encounter = resolveCoopDefenseMapEncounterConfigs(map, 1)[0];
    expect(encounter?.id).toBe('opening');
    expect(encounter?.start).toMatchObject({ type: 'time', atMs: expect.any(Number) });
    expect(encounter?.restAfterMs).toBeGreaterThan(0);
    expect(encounter?.groups.every((group) => group.front === 'west')).toBe(true);
    expect(encounter?.groups.every((group) => group.count > 0 && group.delayMs >= 0)).toBe(true);
    expect(map.encounters?.[1]?.start).toEqual({ type: 'after-previous' });
    // Der Hold braucht ein lesbares Fenster zwischen Reveal und Angriff.
    expect(map.encounters?.[1]?.restAfterMs).toBeGreaterThan(0);

    expect(destroyObjective).toEqual(expect.objectContaining({
      type: 'destroy',
      start: { type: 'after-encounter', encounterId: 'opening' },
      focusUntil: { type: 'after-encounter', encounterId: 'follow-up' },
      targets: expect.arrayContaining(['brood-north', 'brood-south']),
      rewards: { xpPerTarget: expect.any(Number) },
    }));

    // Die Fokusfenster stossen aneinander an, statt sich zu ueberschneiden: Der Destroy-Auftrag
    // gibt den Slot mit dem Clear von `follow-up` genau dann frei, wenn der Hold ihn uebernimmt.
    expect(holdObjective).toEqual(expect.objectContaining({
      type: 'hold',
      start: { type: 'after-encounter', encounterId: 'follow-up' },
      holdUntil: { type: 'after-encounter', encounterId: 'hold-attack' },
      targets: ['forward-outpost'],
      targetGoal: 1,
      rewards: { repairTargetOnComplete: true },
    }));
    expect(holdObjective).not.toHaveProperty('focusUntil');

    const outpost = map.bases.find((base) => base.id === 'forward-outpost');
    expect(outpost).toMatchObject({
      role: 'outpost',
      faction: 'friendly',
      dormant: true,
      startHpFactor: expect.any(Number),
    });
    expect(outpost?.startHpFactor).toBeGreaterThan(0);
    expect(outpost?.startHpFactor).toBeLessThanOrEqual(1);
    expect(outpost?.turrets?.map((turret) => turret.weaponId)).toEqual(['TURRET_ROCKET_BURST', 'TURRET_ROCKET_BURST']);
  });
});
