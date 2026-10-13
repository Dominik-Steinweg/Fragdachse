import type { ActivityDefinition } from '../config/authoring/ActivityDefinition';
import { getActivityDefinition, getWorldDefinition } from '../config/authoring/authoredScenarios';
import type { WorldDefinition } from '../config/authoring/WorldDefinition';
import { getCoopDefenseMapConfig, type CoopDefenseMapConfig } from '../config/coopDefenseMaps';
import { toCanonicalJson } from '../dawn/contracts/dawnCanonicalJson';
import type { DawnActivityPlan, DawnWorldPlan } from '../dawn/contracts/DawnPlans';
import {
  isDawnActivityDefinitionId,
  isDawnWorldDefinitionId,
  toDawnActivityDefinitionId,
  toDawnWorldDefinitionId,
} from '../dawn/contracts/DawnIds';
import { resolveDawnScenario, type ResolvedDawnScenario } from '../dawn/resolution/DawnScenarioResolution';
import type { ActivityDescriptor } from './ActivityDescriptor';
import { toMapId } from './arenaDescriptorAdapter';
import type { WorldDescriptor } from './WorldDescriptor';

/**
 * Owner der Frage: Welche Definitionen realisieren eine replizierte World- bzw. Activity-Instanz?
 *
 * Authored IDs loesen ueber die Registry auf. Dawn-IDs besitzen keinen Registry-Eintrag; sie
 * loesen ausschliesslich ueber die replizierten Plaene aus World- und Activity-Descriptor auf.
 * Consumer fragen hier statt `getWorldDefinition(definitionId)` oder `toMapId → getCoopDefenseMapConfig`,
 * damit kein Pfad still auf eine Kampagnenkarte zurueckfaellt.
 */

type WorldIdentity = Pick<WorldDescriptor, 'definitionId' | 'parameters'>;

export function resolveWorldDefinition(
  world: WorldIdentity,
  activity: ActivityDescriptor | null,
): WorldDefinition | null {
  if (!isDawnWorldDefinitionId(world.definitionId)) return getWorldDefinition(world.definitionId);
  return resolveDawnWorldScenario(world, activity).world;
}

export function resolveActivityDefinition(
  activity: ActivityDescriptor,
  world: WorldIdentity,
): ActivityDefinition | null {
  if (!isDawnActivityDefinitionId(activity.definitionId)) return getActivityDefinition(activity.definitionId);
  return resolveDawnWorldScenario(world, activity).activity;
}

/**
 * Die aktive Coop-Config einer World. Kampagnenwelten lesen ihre Registry-Karte, Dawn-Welten die
 * aus ihren Plaenen aufgeloeste Config. `null` fuer jede World ohne Coop-Karte (Lobby, Prozedural).
 */
export function resolveCoopDefenseMapConfig(
  world: WorldIdentity,
  activity: ActivityDescriptor | null,
): CoopDefenseMapConfig | null {
  if (isDawnWorldDefinitionId(world.definitionId)) return resolveDawnWorldScenario(world, activity).mapConfig;
  const mapId = toMapId(world.definitionId);
  return mapId === null ? null : getCoopDefenseMapConfig(mapId);
}

export function isDawnWorld(world: Pick<WorldDescriptor, 'definitionId'>): boolean {
  return isDawnWorldDefinitionId(world.definitionId);
}

/** Wenige Eintraege genuegen: Pro Peer existiert hoechstens eine Dawn-World gleichzeitig. */
const DAWN_CACHE_LIMIT = 4;
const dawnScenarioCache = new Map<string, ResolvedDawnScenario>();
/** Schneller Pfad fuer Runtime-Owner, die ihre Descriptoren stabil halten (pro Zelle/Frame). */
const dawnScenarioByPlanIdentity = new WeakMap<DawnWorldPlan, {
  readonly activityPlan: DawnActivityPlan;
  readonly resolved: ResolvedDawnScenario;
}>();

function resolveDawnWorldScenario(world: WorldIdentity, activity: ActivityDescriptor | null): ResolvedDawnScenario {
  const worldPlan = world.parameters?.dawn;
  const activityPlan = activity?.parameters?.dawn;
  if (!worldPlan || !activityPlan) {
    throw new Error(`[WorldDefinitionResolution] Dawn world ${world.definitionId} needs its World and Activity plan`);
  }
  if (world.definitionId !== toDawnWorldDefinitionId(worldPlan.templateId)
    || activity.definitionId !== toDawnActivityDefinitionId(worldPlan.templateId)) {
    throw new Error(
      `[WorldDefinitionResolution] Dawn identities ${world.definitionId}/${activity.definitionId} `
      + `do not match template ${worldPlan.templateId}`,
    );
  }
  const byIdentity = dawnScenarioByPlanIdentity.get(worldPlan);
  if (byIdentity?.activityPlan === activityPlan) return byIdentity.resolved;
  const key = toCanonicalJson([worldPlan, activityPlan]);
  let resolved = dawnScenarioCache.get(key);
  if (!resolved) {
    resolved = resolveDawnScenario(worldPlan, activityPlan);
    if (dawnScenarioCache.size >= DAWN_CACHE_LIMIT) {
      dawnScenarioCache.delete(dawnScenarioCache.keys().next().value!);
    }
    dawnScenarioCache.set(key, resolved);
  }
  dawnScenarioByPlanIdentity.set(worldPlan, { activityPlan, resolved });
  return resolved;
}
