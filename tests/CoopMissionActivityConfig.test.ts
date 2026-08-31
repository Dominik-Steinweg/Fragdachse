import { describe, expect, it } from 'vitest';
import { getActivityDefinition, getWorldDefinition } from '../src/config/authoring/authoredScenarios';
import { resolveCoopMissionActivityConfiguration } from '../src/activity/CoopMissionActivityConfig';
import type { ActivityDescriptor } from '../src/world/ActivityDescriptor';

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

    const resolved = resolveCoopMissionActivityConfiguration(activity(definition!.id), world);

    expect(resolved.definitionId).toBe(definition!.id);
    expect(resolved.mapConfig.objective).toBe(definition!.objective);
    expect(resolved.mapConfig.mapId).toBe(world!.sourceMapId);
  });

  it('rejects an unknown ActivityDefinition and an Activity from another World', () => {
    const world = getWorldDefinition('world:coop-defense:6');
    expect(() => resolveCoopMissionActivityConfiguration(activity('activity:coop-mission:missing'), world))
      .toThrow('Unknown ActivityDefinition');

    const otherWorld = getWorldDefinition('world:coop-defense:7');
    expect(() => resolveCoopMissionActivityConfiguration(activity('activity:coop-mission:6'), otherWorld))
      .toThrow('belongs to world');
  });
});
