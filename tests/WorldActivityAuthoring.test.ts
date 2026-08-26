import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_MAP_CONFIGS,
  WEAPON_BALANCE_LAB_MAP_ID,
  getCoopDefenseMapConfig,
} from '../src/config/coopDefenseMaps';
import type { AuthoredScenario } from '../src/config/authoring/AuthoredScenario';
import { hasAuthoredActivity } from '../src/config/authoring/AuthoredScenario';
import {
  COOP_MISSION_SOURCE_FIELDS,
  SHARED_SOURCE_FIELDS,
  WORLD_SOURCE_FIELDS,
  getCoopMissionDefinitionId,
  getWorldDefinitionId,
  toAuthoredScenario,
  toCoopDefenseMapConfig,
  toCoopMissionDefinition,
  toWorldDefinition,
} from '../src/config/authoring/coopDefenseAuthoringAdapter';
import {
  getActivityDefinition,
  getAuthoredScenarios,
  getWorldDefinition,
  getWorldDefinitionForMap,
} from '../src/config/authoring/authoredScenarios';
import { resolveWorldPersistentBaseAnchorBase } from '../src/config/authoring/WorldDefinition';

/**
 * Authoring-Vertraege aus dem Runtime-Refactoring: WorldDefinition und ActivityDefinition sind
 * getrennt, der bestehende Content wird per Compatibility-Adapter darauf abgebildet, und eine
 * World kann ohne Activity bestehen.
 *
 * Die Runtime liest weiterhin `CoopDefenseMapConfig`. Deshalb ist die Rueckrichtung des Adapters
 * hier der wichtigste Test: solange sie exakt trifft, kann die Laufzeit spaeter Schritt fuer
 * Schritt migriert werden, ohne dass Authoring und Verhalten auseinanderlaufen.
 */

/** Alle authored Maps inklusive der internen Diagnose-Map. */
const ALL_MAP_CONFIGS = [
  ...COOP_DEFENSE_MAP_CONFIGS,
  getCoopDefenseMapConfig(WEAPON_BALANCE_LAB_MAP_ID),
];

/** Feldnamen aus dem `CoopDefenseMapConfig`-Interface – die Quelle, die aufgeteilt wird. */
function collectMapConfigFields(): string[] {
  const source = readFileSync(resolve(process.cwd(), 'src/config/coopDefenseMaps.ts'), 'utf8');
  const start = source.indexOf('export interface CoopDefenseMapConfig {');
  expect(start, 'CoopDefenseMapConfig interface must exist').toBeGreaterThan(0);
  const end = source.indexOf('\n}', start);
  const body = source.slice(start, end);
  return [...new Set([...body.matchAll(/^ {2}readonly ([a-zA-Z][a-zA-Z0-9]*)\??:/gm)].map((match) => match[1]))];
}

describe('World-/Activity-Authoring – Partition', () => {
  it('ordnet jedes Map-Feld genau einer Seite zu', () => {
    const declared = collectMapConfigFields();
    expect(declared.length).toBeGreaterThan(20);

    const world = new Set<string>(WORLD_SOURCE_FIELDS);
    const activity = new Set<string>(COOP_MISSION_SOURCE_FIELDS);
    const shared = new Set<string>(SHARED_SOURCE_FIELDS);

    // Disjunkt: kein Feld darf doppelt beansprucht werden.
    expect([...world].filter((field) => activity.has(field) || shared.has(field))).toEqual([]);
    expect([...activity].filter((field) => shared.has(field))).toEqual([]);

    // Vollstaendig: ein neues Map-Feld erzwingt eine Entscheidung, statt still zu verschwinden.
    const claimed = new Set([...world, ...activity, ...shared]);
    expect(declared.filter((field) => !claimed.has(field)), 'unassigned CoopDefenseMapConfig fields').toEqual([]);
    expect([...claimed].filter((field) => !declared.includes(field)), 'stale field assignments').toEqual([]);
  });

  it('haelt Sieg-, Niederlage- und Missionsbegriffe aus jeder WorldDefinition heraus', () => {
    for (const mapConfig of ALL_MAP_CONFIGS) {
      const world = toWorldDefinition(mapConfig);
      const serialized = JSON.stringify(world);
      for (const missionField of COOP_MISSION_SOURCE_FIELDS) {
        expect(serialized.includes(`"${missionField}"`), `${world.id} leaks ${missionField}`).toBe(false);
      }
      expect(Object.keys(world).sort()).toEqual([
        'bases', 'id', 'initialTimeOfDay', 'metrics', 'persistentBaseSite', 'sourceMapId', 'terrain', 'tracks',
      ]);
    }
  });

  it('bindet jede Activity an genau eine existierende World', () => {
    for (const mapConfig of ALL_MAP_CONFIGS) {
      const activity = toCoopMissionDefinition(mapConfig);
      expect(activity.kind).toBe('coop-mission');
      expect(activity.id).toBe(getCoopMissionDefinitionId(mapConfig.mapId));
      expect(activity.worldDefinitionId).toBe(getWorldDefinitionId(mapConfig.mapId));
      expect(getWorldDefinition(activity.worldDefinitionId)?.id).toBe(activity.worldDefinitionId);
      expect(getActivityDefinition(activity.id)?.id).toBe(activity.id);
    }
  });
});

describe('World-/Activity-Authoring – Compatibility-Adapter', () => {
  it('bildet jede authored Map verlustfrei hin und zurueck ab', () => {
    for (const mapConfig of ALL_MAP_CONFIGS) {
      const restored = toCoopDefenseMapConfig(toAuthoredScenario(mapConfig));
      expect(restored, `round trip for map ${mapConfig.mapId}`).toEqual(mapConfig);
      // Auch die Schluesselmenge muss stimmen: ein stillschweigend fehlendes Feld waere sonst
      // von `undefined` nicht zu unterscheiden.
      expect(Object.keys(restored).sort(), `round trip keys for map ${mapConfig.mapId}`)
        .toEqual(Object.keys(mapConfig).sort());
    }
  });

  it('verlangt eine normalisierte Map, statt eigene Defaults zu erfinden', () => {
    const raw = { ...getCoopDefenseMapConfig('1'), timeOfDay: undefined };
    expect(() => toWorldDefinition(raw)).toThrow(/normalizeCoopDefenseMapConfig/);
  });

  it('haelt Registry und Adapter deckungsgleich', () => {
    const scenarios = getAuthoredScenarios();
    expect(scenarios).toHaveLength(ALL_MAP_CONFIGS.length);
    expect(scenarios.every(hasAuthoredActivity)).toBe(true);
    expect(new Set(scenarios.map((scenario) => scenario.world.id)).size).toBe(scenarios.length);
  });
});

describe('World-/Activity-Authoring – World ohne Activity', () => {
  it('beschreibt eine persistente Basis vollstaendig ohne Missionsfelder', () => {
    // Map 18 ist heute eine Welt mit einer nur formal vorhandenen 30-Sekunden-Mission. Genau
    // dieser Anteil laesst sich jetzt abtrennen: die World allein bleibt vollstaendig.
    const world = getWorldDefinitionForMap('18');
    expect(world).not.toBeNull();
    const scenario: AuthoredScenario = { world: world!, activity: null };

    const mapConfig = getCoopDefenseMapConfig('18');
    expect(hasAuthoredActivity(scenario)).toBe(false);
    expect(scenario.world.metrics).toEqual({
      widthCells: mapConfig.arenaWidthCells,
      heightCells: mapConfig.arenaHeightCells,
    });
    expect(scenario.world.persistentBaseSite).toEqual({ baseId: 'foundation-main' });
    expect(scenario.world.initialTimeOfDay).toBe(mapConfig.timeOfDay);
    expect(scenario.world.bases).toEqual(mapConfig.bases);

    // Der Anker loest innerhalb derselben World auf – ohne Umweg ueber Mission oder Lobby.
    const anchorBase = resolveWorldPersistentBaseAnchorBase(scenario.world);
    expect(anchorBase?.id).toBe('foundation-main');
    expect(anchorBase?.faction).toBe('friendly');
    expect(anchorBase?.role).toBe('main');
  });

  it('zeigt an den Persistent-Base-Maps, welche Missionsfelder rein formal sind', () => {
    // Maps 18 und 19 sind heute Welten mit einer Alibi-Mission. Nach der Trennung steht genau
    // das in der Activity und nirgends sonst – die World bleibt davon unberuehrt.
    for (const mapId of ['18', '19']) {
      const activity = toCoopMissionDefinition(getCoopDefenseMapConfig(mapId));
      expect(activity.objective, mapId).toBe('survive');
      expect(activity.surviveDurationSec, mapId).toBeGreaterThan(0);
      expect(activity.respawnsPerPlayer, mapId).toBeGreaterThan(0);
      // Kein echter Missionsinhalt: das ist der Anteil, den eine World ohne Activity ersatzlos
      // verliert, statt ihn wie heute leer authoren zu muessen.
      expect(activity.encounters, mapId).toEqual([]);
      expect(activity.persistentSpawns, mapId).toEqual([]);
      expect(activity.mapEvents, mapId).toEqual([]);
      expect(activity.secondaryObjectives, mapId).toEqual([]);
      expect(activity.boss, mapId).toBeUndefined();
      expect(activity.missionProgress, mapId).toBeUndefined();
      expect(activity.itemDrop, mapId).toBeUndefined();
    }
  });

  it('kennt fuer eine World ohne Coop-Mission keinen CoopDefenseMapConfig', () => {
    const world = getWorldDefinitionForMap('18')!;
    expect(() => toCoopDefenseMapConfig({ world, activity: null })).toThrow(/no coop mission activity/);
  });

  it('loest den Persistent-Base-Anker jeder authored World innerhalb ihrer eigenen Basen auf', () => {
    const worldsWithSite = getAuthoredScenarios()
      .map((scenario) => scenario.world)
      .filter((world) => world.persistentBaseSite !== undefined);
    expect(worldsWithSite.length).toBeGreaterThan(0);
    for (const world of worldsWithSite) {
      const anchorBase = resolveWorldPersistentBaseAnchorBase(world);
      expect(anchorBase, world.id).not.toBeNull();
      expect(anchorBase!.faction, world.id).toBe('friendly');
      expect(anchorBase!.role, world.id).toBe('main');
    }
  });
});
