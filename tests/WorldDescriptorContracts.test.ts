import { describe, expect, it } from 'vitest';
import { getWorldDefinition } from '../src/config/authoring/authoredScenarios';
import {
  getCoopMissionDefinitionId,
  getWorldDefinitionId,
} from '../src/config/authoring/coopDefenseAuthoringAdapter';
import type { ArenaDescriptor, GameMode } from '../src/types';
import {
  isActivityOfWorld,
  parseActivityDescriptor,
  type ActivityDescriptor,
} from '../src/world/ActivityDescriptor';
import {
  toActivityDescriptor,
  toActivityKind,
  toArenaDescriptor,
  toArenaLoadReadyState,
  toGameMode,
  toMapId,
  toWorldAndActivityDescriptors,
  toWorldDefinitionId,
  toWorldDescriptor,
  toWorldLoadReadyState,
  toWorldParameters,
} from '../src/world/arenaDescriptorAdapter';
import {
  PROCEDURAL_ARENA_WORLD_DEFINITION_ID,
  isSameWorldInstance,
  parseWorldDescriptor,
  type WorldDescriptor,
} from '../src/world/WorldDescriptor';
import { parseWorldLoadReadyState } from '../src/world/WorldLoadReady';
import { acceptWorldScoped, isCurrentWorldRevision, nextMonotonicRevision, worldScoped } from '../src/world/WorldRevision';

/**
 * Kanonische World- und Activity-Identitaet.
 *
 * Der replizierte Vertrag ist heute noch `ArenaDescriptor`; diese Tests halten fest, dass die
 * kanonische Aufteilung existiert, verlustfrei ist, World- und Activity-Identitaet trennt und
 * eine zentrale Verwerfungsregel fuer fremde World-Instanzen besitzt.
 */

const GAME_MODES: readonly GameMode[] = ['coop_defense', 'deathmatch', 'team_deathmatch', 'capture_the_beer'];

function arenaDescriptor(overrides: Partial<ArenaDescriptor> = {}): ArenaDescriptor {
  return {
    roundRevision: 1_700_000_000_000,
    gameMode: 'coop_defense',
    mapId: '7',
    seed: 4242,
    arenaGeneratorVersion: 3,
    layoutFingerprint: 'deadbeef',
    ...overrides,
  };
}

describe('WorldDescriptor – kanonische World-Identitaet', () => {
  it('traegt ausschliesslich World-Identitaet und World-Konfiguration', () => {
    const world = toWorldDescriptor(arenaDescriptor(), { persistentBaseRadiusCells: 6 });
    expect(Object.keys(world).sort()).toEqual([
      'definitionId', 'generatorVersion', 'layoutFingerprint', 'parameters', 'seed', 'worldRevision',
    ]);
    // Kein Objective, keine Rolle, keine Siegbedingung, kein Respawn-Budget – und kein GameMode
    // als Ersatz fuer die Activity.
    const serialized = JSON.stringify(world);
    for (const forbidden of ['objective', 'gameMode', 'roundRevision', 'respawn', 'victory', 'defeat', 'mapId']) {
      expect(serialized.includes(forbidden), `WorldDescriptor leaks ${forbidden}`).toBe(false);
    }
  });

  it('verweist auf genau die WorldDefinition aus dem Authoring', () => {
    for (const mapId of ['0', '7', '18', 'weapon-balance-lab']) {
      const world = toWorldDescriptor(arenaDescriptor({ mapId }));
      expect(world.definitionId).toBe(getWorldDefinitionId(mapId));
      // Eine kanonische Identitaet: dieselbe ID loest im Authoring-Registry auf.
      expect(getWorldDefinition(world.definitionId)?.sourceMapId).toBe(mapId);
      expect(toMapId(world.definitionId)).toBe(mapId);
    }
  });

  it('beschreibt eine Runde ohne authored Map als prozedurale Arena-World', () => {
    const world = toWorldDescriptor(arenaDescriptor({ gameMode: 'deathmatch', mapId: null }));
    expect(world.definitionId).toBe(PROCEDURAL_ARENA_WORLD_DEFINITION_ID);
    expect(toMapId(world.definitionId)).toBeNull();
    expect(toWorldDefinitionId(null)).toBe(PROCEDURAL_ARENA_WORLD_DEFINITION_ID);
  });

  it('erkennt dieselbe World-Instanz nur bei gleicher Identitaet und gleichem Layout', () => {
    const world = toWorldDescriptor(arenaDescriptor());
    expect(isSameWorldInstance(world, { ...world })).toBe(true);
    expect(isSameWorldInstance(world, { ...world, worldRevision: world.worldRevision + 1 })).toBe(false);
    expect(isSameWorldInstance(world, { ...world, layoutFingerprint: 'other' })).toBe(false);
    expect(isSameWorldInstance(world, { ...world, seed: world.seed + 1 })).toBe(false);
  });

  it('verwirft unvollstaendige World-Nutzlast an der Netzwerkgrenze', () => {
    const world = toWorldDescriptor(arenaDescriptor(), { persistentBaseRadiusCells: 6 });
    expect(parseWorldDescriptor(JSON.parse(JSON.stringify(world)))).toEqual(world);
    expect(parseWorldDescriptor(null)).toBeNull();
    expect(parseWorldDescriptor({ ...world, worldRevision: 0 })).toBeNull();
    expect(parseWorldDescriptor({ ...world, worldRevision: 1.5 })).toBeNull();
    expect(parseWorldDescriptor({ ...world, definitionId: '' })).toBeNull();
    expect(parseWorldDescriptor({ ...world, layoutFingerprint: '' })).toBeNull();
    expect(parseWorldDescriptor({ ...world, seed: Number.NaN })).toBeNull();
    // Unbrauchbare Parameter loeschen nicht die World, sie entfallen.
    expect(parseWorldDescriptor({ ...world, parameters: { persistentBaseRadiusCells: -1 } }))
      .toEqual({ ...world, parameters: undefined });
  });
});

describe('ActivityDescriptor – getrennte Activity-Identitaet', () => {
  it('bindet jede Activity an eine World, ohne deren Identitaet zu duplizieren', () => {
    const descriptor = arenaDescriptor();
    const { world, activity } = toWorldAndActivityDescriptors(descriptor);
    expect(Object.keys(activity).sort()).toEqual(['activityRevision', 'definitionId', 'kind', 'worldRevision']);
    expect(activity.kind).toBe('coop-mission');
    expect(activity.definitionId).toBe(getCoopMissionDefinitionId('7'));
    expect(isActivityOfWorld(activity, world)).toBe(true);
    // Seed, Generator und Fingerprint stehen ausschliesslich in der World.
    const serialized = JSON.stringify(activity);
    for (const forbidden of ['seed', 'layoutFingerprint', 'generatorVersion']) {
      expect(serialized.includes(forbidden), `ActivityDescriptor duplicates ${forbidden}`).toBe(false);
    }
  });

  it('bildet jeden GameMode umkehrbar auf eine Activity-Art ab', () => {
    for (const mode of GAME_MODES) {
      expect(toGameMode(toActivityKind(mode))).toBe(mode);
    }
    expect(new Set(GAME_MODES.map(toActivityKind)).size).toBe(GAME_MODES.length);
  });

  it('verwirft unvollstaendige Activity-Nutzlast an der Netzwerkgrenze', () => {
    const activity = toActivityDescriptor(arenaDescriptor());
    expect(parseActivityDescriptor(JSON.parse(JSON.stringify(activity)))).toEqual(activity);
    expect(parseActivityDescriptor({ ...activity, kind: 'editor' })).toBeNull();
    expect(parseActivityDescriptor({ ...activity, worldRevision: 0 })).toBeNull();
    expect(parseActivityDescriptor({ ...activity, activityRevision: -1 })).toBeNull();
    expect(parseActivityDescriptor({ ...activity, definitionId: '' })).toBeNull();
  });

  it('haelt World- und Activity-Revision als verschiedene Identitaeten auseinander', () => {
    const world: WorldDescriptor = { ...toWorldDescriptor(arenaDescriptor()), worldRevision: 12 };
    const activity: ActivityDescriptor = {
      ...toActivityDescriptor(arenaDescriptor()),
      worldRevision: 12,
      activityRevision: 31,
    };
    expect(isActivityOfWorld(activity, world)).toBe(true);
    // Die Runde behaelt ihre eigene Identitaet, die World bleibt Revision 12.
    expect(toArenaDescriptor(world, activity).roundRevision).toBe(31);

    const foreign: ActivityDescriptor = { ...activity, worldRevision: 13 };
    expect(isActivityOfWorld(foreign, world)).toBe(false);
    expect(() => toArenaDescriptor(world, foreign)).toThrow(/world revision/);
  });
});

describe('Compatibility-Adapter zum bestehenden ArenaDescriptor', () => {
  it('bildet jede Kombination aus Modus und Map verlustfrei hin und zurueck ab', () => {
    for (const gameMode of GAME_MODES) {
      for (const mapId of [null, '0', '18', 'weapon-balance-lab']) {
        const descriptor = arenaDescriptor({ gameMode, mapId });
        const { world, activity } = toWorldAndActivityDescriptors(descriptor);
        expect(toArenaDescriptor(world, activity), `${gameMode}/${mapId}`).toEqual(descriptor);
      }
    }
  });

  it('liest den persistenten Basisradius aus dem heutigen RoundState in die World-Parameter', () => {
    expect(toWorldParameters({ persistentBaseRadiusCells: 6 })).toEqual({ persistentBaseRadiusCells: 6 });
    expect(toWorldParameters({})).toBeUndefined();
    expect(toWorldParameters(null)).toBeUndefined();

    const world = toWorldDescriptor(arenaDescriptor(), toWorldParameters({ persistentBaseRadiusCells: 6 }));
    expect(world.parameters).toEqual({ persistentBaseRadiusCells: 6 });
    // Der alte Vertrag hat dafuer keinen Platz; der Wert reist dort weiter im RoundState.
    expect(toArenaDescriptor(world, toActivityDescriptor(arenaDescriptor()))).toEqual(arenaDescriptor());
  });

  it('bildet die Ladebarriere world-scoped ab', () => {
    const arenaState = { roundRevision: 42, progress: 100, stage: 'ready' as const, ready: true };
    const worldState = toWorldLoadReadyState(arenaState);
    expect(worldState).toEqual({ worldRevision: 42, progress: 100, stage: 'ready', ready: true });
    expect(toArenaLoadReadyState(worldState)).toEqual(arenaState);

    expect(parseWorldLoadReadyState(worldState, 42)).toEqual(worldState);
    // Stand einer anderen World-Instanz wird verworfen, nicht umgerechnet.
    expect(parseWorldLoadReadyState(worldState, 43)).toBeNull();
    // `ready` gilt nur bei vollstaendigem Fortschritt in der Endstufe.
    expect(parseWorldLoadReadyState({ ...worldState, stage: 'building' }, 42)?.ready).toBe(false);
    expect(parseWorldLoadReadyState({ ...worldState, progress: 90 }, 42)?.ready).toBe(false);
    expect(parseWorldLoadReadyState({ ...worldState, stage: 'nonsense' }, 42)).toBeNull();
  });
});

describe('World-Revision – gemeinsame Quelle und zentrale Verwerfungsregel', () => {
  it('bleibt auch innerhalb derselben Millisekunde streng monoton', () => {
    const first = nextMonotonicRevision(0, 1_700_000_000_000);
    expect(first).toBe(1_700_000_000_000);
    const second = nextMonotonicRevision(first, 1_700_000_000_000);
    expect(second).toBe(first + 1);
    expect(nextMonotonicRevision(second, 1_699_999_999_000)).toBe(second + 1);
  });

  it('wendet eine Nachricht niemals auf eine andere World-Revision an', () => {
    const message = worldScoped(12, { gridX: 3, gridY: 4 });
    expect(acceptWorldScoped(12, message)).toEqual({ gridX: 3, gridY: 4 });
    expect(acceptWorldScoped(13, message)).toBeNull();
    expect(acceptWorldScoped(11, message)).toBeNull();
    expect(acceptWorldScoped(12, { payload: { gridX: 3 } })).toBeNull();
    expect(acceptWorldScoped(12, { worldRevision: 12 })).toBeNull();
    expect(acceptWorldScoped(12, null)).toBeNull();
    // Eine Nutzlast darf leer sein; nur die Zuordnung entscheidet.
    expect(acceptWorldScoped(12, worldScoped(12, null))).toBeNull();
    expect(acceptWorldScoped(12, worldScoped(12, 0))).toBe(0);

    expect(isCurrentWorldRevision(12, 12)).toBe(true);
    expect(isCurrentWorldRevision(12, 13)).toBe(false);
    expect(isCurrentWorldRevision(12, '12')).toBe(false);
    expect(isCurrentWorldRevision(12, undefined)).toBe(false);
  });
});
