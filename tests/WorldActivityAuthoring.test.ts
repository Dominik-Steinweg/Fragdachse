import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_MAP_CONFIGS,
  WEAPON_BALANCE_LAB_MAP_ID,
  getCoopDefenseMapConfig,
} from '../src/config/coopDefenseMaps';
import type { AuthoredScenario } from '../src/config/authoring/AuthoredScenario';
import {
  createAuthoredScenario,
  hasAuthoredActivity,
  isActivityOfWorldDefinition,
} from '../src/config/authoring/AuthoredScenario';
import {
  COOP_MISSION_BASE_FIELDS,
  COOP_MISSION_SOURCE_FIELDS,
  SHARED_BASE_FIELDS,
  SHARED_SOURCE_FIELDS,
  SPLIT_SOURCE_FIELDS,
  WORLD_BASE_FIELDS,
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

/** Feldnamen eines authored Interfaces – die Quelle, die aufgeteilt wird. */
function collectInterfaceFields(interfaceName: string): string[] {
  const source = readFileSync(resolve(process.cwd(), 'src/config/coopDefenseMaps.ts'), 'utf8');
  const start = source.indexOf(`export interface ${interfaceName} {`);
  expect(start, `${interfaceName} interface must exist`).toBeGreaterThan(0);
  const end = source.indexOf('\n}', start);
  const body = source.slice(start, end);
  return [...new Set([...body.matchAll(/^ {2}readonly ([a-zA-Z][a-zA-Z0-9]*)\??:/gm)].map((match) => match[1]))];
}

function collectMapConfigFields(): string[] {
  return collectInterfaceFields('CoopDefenseMapConfig');
}

/** Prueft, dass die Listen sich nicht ueberschneiden und die deklarierten Felder genau abdecken. */
function expectExactPartition(
  declared: readonly string[],
  groups: Readonly<Record<string, readonly string[]>>,
  label: string,
): void {
  const entries = Object.entries(groups);
  const seen = new Map<string, string>();
  for (const [groupName, fields] of entries) {
    for (const field of fields) {
      const owner = seen.get(field);
      expect(owner, `${label}: ${field} is claimed by both ${owner} and ${groupName}`).toBeUndefined();
      seen.set(field, groupName);
    }
  }
  // Vollstaendig: ein neues Feld erzwingt eine Entscheidung, statt still zu verschwinden.
  expect(declared.filter((field) => !seen.has(field)), `${label}: unassigned fields`).toEqual([]);
  expect([...seen.keys()].filter((field) => !declared.includes(field)), `${label}: stale assignments`).toEqual([]);
}

describe('World-/Activity-Authoring – Partition', () => {
  it('ordnet jedes Map-Feld genau einer Seite zu', () => {
    const declared = collectMapConfigFields();
    expect(declared.length).toBeGreaterThan(20);
    expectExactPartition(declared, {
      world: WORLD_SOURCE_FIELDS,
      activity: COOP_MISSION_SOURCE_FIELDS,
      shared: SHARED_SOURCE_FIELDS,
      // `bases` mischt beide Ebenen selbst und wird deshalb feldweise aufgeteilt.
      split: SPLIT_SOURCE_FIELDS,
    }, 'CoopDefenseMapConfig');
  });

  it('ordnet auch jedes Feld einer Basis genau einer Seite zu', () => {
    // Ohne diese zweite Ebene wuerde `bases` als World gelten und dabei `dormant`,
    // `playerScaling`, `startHpFactor` und die Podest-Respawnregeln mit hineintragen.
    const declared = collectInterfaceFields('CoopBaseConfig');
    expect(declared.length).toBeGreaterThan(8);
    expectExactPartition(declared, {
      world: WORLD_BASE_FIELDS,
      activity: COOP_MISSION_BASE_FIELDS,
      shared: SHARED_BASE_FIELDS,
    }, 'CoopBaseConfig');
  });

  it('haelt Sieg-, Niederlage- und Missionsbegriffe aus jeder WorldDefinition heraus', () => {
    const forbidden = [
      ...COOP_MISSION_SOURCE_FIELDS,
      ...COOP_MISSION_BASE_FIELDS,
      // Spawn-Regeln der Power-up-Podeste, die frueher ueber `bases` in die World gerieten.
      'respawnMs',
      'spawnOnArenaStart',
      'defId',
    ];
    for (const mapConfig of ALL_MAP_CONFIGS) {
      const world = toWorldDefinition(mapConfig);
      const serialized = JSON.stringify(world);
      for (const missionField of forbidden) {
        expect(serialized.includes(`"${missionField}"`), `${world.id} leaks ${missionField}`).toBe(false);
      }
      expect(Object.keys(world).sort()).toEqual([
        'actionPolicy', 'bases', 'id', 'initialTimeOfDay', 'metrics', 'persistentBaseSite', 'sourceMapId', 'terrain', 'tracks',
      ]);
      for (const base of world.bases) {
        expect(Object.keys(base).sort(), `${world.id}/${base.id}`).toEqual([
          'anchor', 'faction', 'hpMax', 'id', 'role', 'shape', 'spawnCenter', 'turrets',
        ]);
      }
    }
  });

  it('adressiert jeden Missionsanteil einer Basis ueber eine Basis derselben World', () => {
    for (const mapConfig of ALL_MAP_CONFIGS) {
      const { world, activity } = toAuthoredScenario(mapConfig);
      const baseIds = new Set(world.bases.map((base) => base.id));
      const overlays = activity?.kind === 'coop-mission' ? activity.baseOverlays ?? [] : [];
      for (const overlay of overlays) {
        expect(baseIds.has(overlay.baseId), `${world.id} overlay for unknown base ${overlay.baseId}`).toBe(true);
      }
      expect(new Set(overlays.map((overlay) => overlay.baseId)).size).toBe(overlays.length);
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
      // Basen werden aus zwei Haelften wieder zusammengesetzt; auch dort darf kein Feld
      // stillschweigend entstehen oder verschwinden.
      restored.bases.forEach((base, index) => {
        expect(Object.keys(base).sort(), `round trip base keys for ${mapConfig.mapId}/${base.id}`)
          .toEqual(Object.keys(mapConfig.bases[index]!).sort());
      });
    }
  });

  it('verlangt eine normalisierte Map, statt eigene Defaults zu erfinden', () => {
    const raw = { ...getCoopDefenseMapConfig('1'), timeOfDay: undefined };
    expect(() => toWorldDefinition(raw)).toThrow(/normalizeCoopDefenseMapConfig/);
  });

  it('laesst World und Activity zweier verschiedener Worlds nicht kombinieren', () => {
    const first = toAuthoredScenario(getCoopDefenseMapConfig('16'));
    const second = toAuthoredScenario(getCoopDefenseMapConfig('17'));
    expect(isActivityOfWorldDefinition(first.activity!, first.world)).toBe(true);
    expect(isActivityOfWorldDefinition(second.activity!, first.world)).toBe(false);

    // Die Paarung wird zentral gebildet, damit ein falsches Paar nicht erst weit spaeter
    // als Mischkonfiguration auffaellt.
    expect(() => createAuthoredScenario(first.world, second.activity)).toThrow(/belongs to world/);
    expect(() => toCoopDefenseMapConfig({ world: first.world, activity: second.activity }))
      .toThrow(/belongs to world/);
    // Eine World ohne Activity bleibt gueltig.
    expect(createAuthoredScenario(first.world, null).activity).toBeNull();
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
    // Eine produktive Persistent-Base-Map bleibt auch ohne laufende Activity eine vollstaendige
    // World; die Missionsfelder verbleiben ausschliesslich in der Activity.
    const world = getWorldDefinitionForMap('17');
    expect(world).not.toBeNull();
    const scenario: AuthoredScenario = { world: world!, activity: null };

    const mapConfig = getCoopDefenseMapConfig('17');
    expect(hasAuthoredActivity(scenario)).toBe(false);
    expect(scenario.world.metrics).toEqual({
      widthCells: mapConfig.arenaWidthCells,
      heightCells: mapConfig.arenaHeightCells,
    });
    // Die World traegt die Stelle, nicht die Geometrie: Lage, Ausrichtung und
    // Grunddauerhaftigkeit, aber keine einzige Zelle.
    expect(scenario.world.persistentBaseSite).toEqual(mapConfig.persistentBase);
    expect(scenario.world.persistentBaseSite?.baseId).toBe(mapConfig.persistentBase?.baseId);
    expect(scenario.world.initialTimeOfDay).toBe(mapConfig.timeOfDay);
    // Das Bauwerk bleibt vollstaendig, sein Missionsanteil faellt mit der Activity weg.
    expect(scenario.world.bases.map((base) => base.id)).toEqual(mapConfig.bases.map((base) => base.id));
    expect(scenario.world.bases[0]).toMatchObject({
      hpMax: mapConfig.bases[0]!.hpMax,
      anchor: mapConfig.bases[0]!.anchor,
      shape: mapConfig.bases[0]!.shape,
    });
    for (const missionField of COOP_MISSION_BASE_FIELDS) {
      expect(missionField in scenario.world.bases[0]!, `world base still carries ${missionField}`).toBe(false);
    }

    // Der Anker loest innerhalb derselben World auf – ohne Umweg ueber Mission oder Lobby.
    const anchorBase = resolveWorldPersistentBaseAnchorBase(scenario.world);
    expect(anchorBase?.id).toBe(mapConfig.persistentBase?.baseId);
    expect(anchorBase?.faction).toBe('friendly');
    expect(anchorBase?.role).toBe('main');
  });

  it('kennt fuer eine World ohne Coop-Mission keinen CoopDefenseMapConfig', () => {
    const world = getWorldDefinitionForMap('17')!;
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
