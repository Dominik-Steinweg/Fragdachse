import type { CoopDefenseMapConfig } from '../config/coopDefenseMaps';
import { getActivityDefinition } from '../config/authoring/authoredScenarios';
import { toCoopDefenseMapConfig } from '../config/authoring/coopDefenseAuthoringAdapter';
import type { WorldDefinition } from '../config/authoring/WorldDefinition';
import type { ActivityDescriptor } from '../world/ActivityDescriptor';

/**
 * Die eine, validierte Activity-Sicht, die Coop-Compositions aus dem Authoring erhalten.
 * `mapConfig` ist nur der bestehende Kompatibilitaetsadapter; Quelle bleibt die Definition.
 */
export interface CoopMissionActivityConfiguration {
  readonly definitionId: string;
  readonly mapConfig: CoopDefenseMapConfig;
}

/**
 * Loest die laufende Coop-Activity gegen die aktuelle WorldDefinition auf.
 *
 * Ein World-`sourceMapId` ist hier absichtlich keine Fallback-Quelle: Zwei Activities koennen
 * dieselbe World teilen, aber unterschiedliche Activity-Inhalte besitzen. Der Adapter baut aus
 * genau dieser Definition die temporaere Map-Kompatibilitaetsform fuer die vorhandenen Systeme.
 */
export function resolveCoopMissionActivityConfiguration(
  activity: ActivityDescriptor,
  worldDefinition: WorldDefinition | null,
): CoopMissionActivityConfiguration {
  if (activity.kind !== 'coop-mission') {
    throw new Error(
      `[CoopMissionActivityConfig] Activity ${activity.definitionId} is ${activity.kind}, not coop-mission`,
    );
  }
  const definition = getActivityDefinition(activity.definitionId);
  if (!definition) {
    throw new Error(
      `[CoopMissionActivityConfig] Unknown ActivityDefinition ${activity.definitionId}`,
    );
  }
  if (definition.kind !== 'coop-mission') {
    throw new Error(
      `[CoopMissionActivityConfig] ActivityDefinition ${definition.id} is ${definition.kind}, not coop-mission`,
    );
  }
  if (!worldDefinition) {
    throw new Error(
      `[CoopMissionActivityConfig] Coop activity ${activity.definitionId} has no current WorldDefinition`,
    );
  }
  if (definition.worldDefinitionId !== worldDefinition.id) {
    throw new Error(
      `[CoopMissionActivityConfig] Activity ${definition.id} belongs to world ${definition.worldDefinitionId}, not ${worldDefinition.id}`,
    );
  }

  return {
    definitionId: definition.id,
    mapConfig: toCoopDefenseMapConfig({ world: worldDefinition, activity: definition }),
  };
}
