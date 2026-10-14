import { describe, expect, it } from 'vitest';
import { getActivityDefinition, getWorldDefinition } from '../src/config/authoring/authoredScenarios';
import { resolveCoopMissionActivityConfiguration } from '../src/activity/CoopMissionActivityConfig';
import type { ActivityDescriptor } from '../src/world/ActivityDescriptor';
import type { WorldDefinition } from '../src/config/authoring/WorldDefinition';
import { composeDawnRoundPlans } from '../src/dawn/composition/DawnRoundComposition';
import { toDawnActivityDefinitionId, toDawnWorldDefinitionId } from '../src/dawn/contracts/DawnIds';
import { resolveWorldDefinition } from '../src/world/WorldDefinitionResolution';

function authoredWorld(definition: WorldDefinition | null) {
  return { descriptor: { definitionId: definition?.id ?? 'world:missing' }, definition };
}

function activity(definitionId: string): ActivityDescriptor {
  return {
    activityRevision: 1,
    worldRevision: 1,
    kind: 'coop-mission',
    definitionId,
  };
}

describe('CoopMissionActivityConfig', () => {
  it('resolves the canonical ActivityDefinition through the current WorldDefinition', () => {
    const definition = getActivityDefinition('activity:coop-mission:6');
    const world = getWorldDefinition('world:coop-defense:6');
    expect(definition).not.toBeNull();
    expect(world).not.toBeNull();

    const resolved = resolveCoopMissionActivityConfiguration(activity(definition!.id), authoredWorld(world));

    expect(resolved.definitionId).toBe(definition!.id);
    expect(resolved.mapConfig.objective).toBe(definition!.objective);
    expect(resolved.mapConfig.mapId).toBe(world!.sourceMapId);
  });

  it('rejects an unknown ActivityDefinition and an Activity from another World', () => {
    const world = getWorldDefinition('world:coop-defense:6');
    expect(() => resolveCoopMissionActivityConfiguration(activity('activity:coop-mission:missing'), authoredWorld(world)))
      .toThrow('Unknown ActivityDefinition');

    const otherWorld = getWorldDefinition('world:coop-defense:7');
    expect(() => resolveCoopMissionActivityConfiguration(activity('activity:coop-mission:6'), authoredWorld(otherWorld)))
      .toThrow('belongs to world');
  });

  it('resolves a Dawn activity from its replicated plans without a registry entry', () => {
    const plans = composeDawnRoundPlans({ seed: 7, threat: 1, dayNumber: 1 });
    const descriptor = {
      definitionId: toDawnWorldDefinitionId(plans.world.templateId),
      parameters: { dawn: plans.world },
    };
    const dawnActivity: ActivityDescriptor = {
      ...activity(toDawnActivityDefinitionId(plans.world.templateId)),
      parameters: { dawn: plans.activity },
    };

    const resolved = resolveCoopMissionActivityConfiguration(dawnActivity, {
      descriptor,
      definition: resolveWorldDefinition(descriptor, dawnActivity),
    });

    expect(getActivityDefinition(dawnActivity.definitionId)).toBeNull();
    expect(resolved.definitionId).toBe(dawnActivity.definitionId);
    expect(resolved.mapConfig.encounters?.map(({ id }) => id)).toEqual(plans.activity.waves.map(({ id }) => id));
  });
});
