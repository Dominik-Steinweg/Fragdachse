import type { ActivityDefinition } from '../../config/authoring/ActivityDefinition';
import { toAuthoredScenario } from '../../config/authoring/coopDefenseAuthoringAdapter';
import type { WorldDefinition } from '../../config/authoring/WorldDefinition';
import {
  normalizeCoopDefenseMapConfig,
  type CoopDefenseMapAuthoringConfig,
  type CoopDefenseMapConfig,
  type CoopDefenseMapEncounterConfig,
} from '../../config/coopDefenseMapAuthoring';
import {
  assertDawnContentHash,
  getDawnArenaTemplate,
  getDawnSchedule,
  getDawnWaveBlock,
  type DawnArenaTemplate,
} from '../../config/dawn/dawnContent';
import { toDawnActivityDefinitionId, toDawnMapId, toDawnWorldDefinitionId } from '../contracts/DawnIds';
import type { DawnActivityPlan, DawnWorldPlan } from '../contracts/DawnPlans';

/**
 * Der eine reine Resolver vom replizierten Dawn-Plan zur normalen Coop-Config.
 *
 * Host, Client und Late Join rufen ihn mit denselben Plaenen auf und erhalten dieselbe Config:
 * Plan → `CoopDefenseMapAuthoringConfig` → genau einmal `normalizeCoopDefenseMapConfig` →
 * `toAuthoredScenario` mit den Dawn-Definitions-IDs. Nichts davon landet in der Kampagnenregistry.
 */
export interface ResolvedDawnScenario {
  readonly mapConfig: CoopDefenseMapConfig;
  readonly world: WorldDefinition;
  readonly activity: ActivityDefinition;
}

export function resolveDawnScenario(worldPlan: DawnWorldPlan, activityPlan: DawnActivityPlan): ResolvedDawnScenario {
  assertDawnContentHash(worldPlan.contentHash, `Dawn world plan for ${worldPlan.templateId}`);
  assertDawnContentHash(activityPlan.contentHash, `Dawn activity plan for ${worldPlan.templateId}`);
  const template = getDawnArenaTemplate(worldPlan.templateId);
  const mapConfig = normalizeCoopDefenseMapConfig(composeAuthoringConfig(template, activityPlan));
  const scenario = toAuthoredScenario(mapConfig, {
    worldDefinitionId: toDawnWorldDefinitionId(template.id),
    activityDefinitionId: toDawnActivityDefinitionId(template.id),
  });
  if (!scenario.activity) throw new Error(`[DawnScenarioResolution] ${template.id} resolved without an activity`);
  return { mapConfig, world: scenario.world, activity: scenario.activity };
}

function composeAuthoringConfig(
  template: DawnArenaTemplate,
  activityPlan: DawnActivityPlan,
): CoopDefenseMapAuthoringConfig {
  const schedule = getDawnSchedule(activityPlan.scheduleId);
  return {
    ...template.world,
    mapId: toDawnMapId(template.id),
    // M0: Eine Welle als endlicher Assault. `defend-until-dawn` loest das in M1 ab.
    objective: 'repel-assault',
    balanceReferenceDurationSec: schedule.durationMs / 1000,
    bases: [],
    powerUps: [],
    encounters: activityPlan.waves.map((wave): CoopDefenseMapEncounterConfig => {
      if (!template.fronts.includes(wave.front)) {
        throw new Error(`[DawnScenarioResolution] Wave ${wave.id} uses front ${wave.front}, not offered by ${template.id}`);
      }
      return {
        id: wave.id,
        start: { type: 'time', atMs: wave.atMs },
        groups: getDawnWaveBlock(wave.blockId).groups.map((group) => ({ ...group, front: wave.front })),
      };
    }),
  };
}
