import {
  COOP_DEFENSE_MAP_CONFIGS,
  WEAPON_BALANCE_LAB_MAP_ID,
  getCoopDefenseMapConfig,
} from '../coopDefenseMaps';
import type { ActivityDefinition } from './ActivityDefinition';
import type { AuthoredScenario } from './AuthoredScenario';
import { getCoopMissionDefinitionId, getWorldDefinitionId, toAuthoredScenario } from './coopDefenseAuthoringAdapter';
import type { WorldDefinition } from './WorldDefinition';

/**
 * Lookup ueber das getrennte Authoring des vorhandenen Contents.
 *
 * Die Registry wird beim ersten Zugriff gebaut, nicht beim Import: Sie ist eine reine
 * Umgruppierung der bereits geladenen und validierten Map-Registry und soll den Modulgraphen
 * nicht zusaetzlich beim Boot belasten.
 */

let cachedScenarios: readonly AuthoredScenario[] | null = null;
let cachedWorldsById: ReadonlyMap<string, WorldDefinition> | null = null;
let cachedActivitiesById: ReadonlyMap<string, ActivityDefinition> | null = null;

function buildScenarios(): readonly AuthoredScenario[] {
  const mapConfigs = [
    ...COOP_DEFENSE_MAP_CONFIGS,
    // Die interne Diagnose-Map ist bewusst nicht Teil der Kampagnenregistry, besitzt aber
    // dieselbe getrennte Authoring-Sicht.
    getCoopDefenseMapConfig(WEAPON_BALANCE_LAB_MAP_ID),
  ];
  return mapConfigs.map(toAuthoredScenario);
}

export function getAuthoredScenarios(): readonly AuthoredScenario[] {
  cachedScenarios ??= buildScenarios();
  return cachedScenarios;
}

export function getAuthoredWorldDefinitions(): readonly WorldDefinition[] {
  return getAuthoredScenarios().map((scenario) => scenario.world);
}

export function getAuthoredActivityDefinitions(): readonly ActivityDefinition[] {
  return getAuthoredScenarios()
    .map((scenario) => scenario.activity)
    .filter((activity): activity is ActivityDefinition => activity !== null);
}

export function getWorldDefinition(worldDefinitionId: string): WorldDefinition | null {
  cachedWorldsById ??= new Map(getAuthoredWorldDefinitions().map((world) => [world.id, world]));
  return cachedWorldsById.get(worldDefinitionId) ?? null;
}

export function getActivityDefinition(activityDefinitionId: string): ActivityDefinition | null {
  cachedActivitiesById ??= new Map(getAuthoredActivityDefinitions().map((activity) => [activity.id, activity]));
  return cachedActivitiesById.get(activityDefinitionId) ?? null;
}

/** Getrennte Authoring-Sicht auf eine Coop-Defense-Map. */
export function getAuthoredScenarioForMap(mapId: string): AuthoredScenario {
  return toAuthoredScenario(getCoopDefenseMapConfig(mapId));
}

export function getWorldDefinitionForMap(mapId: string): WorldDefinition | null {
  return getWorldDefinition(getWorldDefinitionId(mapId));
}

export function getActivityDefinitionForMap(mapId: string): ActivityDefinition | null {
  return getActivityDefinition(getCoopMissionDefinitionId(mapId));
}
