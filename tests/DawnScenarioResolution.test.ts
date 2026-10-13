import { describe, expect, it } from 'vitest';
import { getMapName } from '../src/i18n/contentPresentation';
import { DAWN_CONTENT_HASH, getDawnArenaTemplates, validateTemplates } from '../src/config/dawn/dawnContent';
import { composeDawnRoundPlans } from '../src/dawn/composition/DawnRoundComposition';
import {
  getDawnTemplateIdOfWorld,
  toDawnActivityDefinitionId,
  toDawnWorldDefinitionId,
} from '../src/dawn/contracts/DawnIds';
import { haveSameDawnPlan, parseDawnActivityPlan, parseDawnWorldPlan } from '../src/dawn/contracts/DawnPlans';
import { resolveDawnScenario } from '../src/dawn/resolution/DawnScenarioResolution';
import { isSameActivityInstance, parseActivityDescriptor, type ActivityDescriptor } from '../src/world/ActivityDescriptor';
import { resolveActiveGameMode, toMapId } from '../src/world/arenaDescriptorAdapter';
import { isSameWorldInstance, parseWorldDescriptor, type WorldDescriptor } from '../src/world/WorldDescriptor';
import {
  resolveActivityDefinition,
  resolveCoopDefenseMapConfig,
  resolveWorldDefinition,
} from '../src/world/WorldDefinitionResolution';

function dawnRound(threat = 1) {
  const plans = composeDawnRoundPlans({ threat, dayNumber: 1 });
  const world: WorldDescriptor = {
    worldRevision: 7,
    definitionId: toDawnWorldDefinitionId(plans.world.templateId),
    seed: 99,
    generatorVersion: 1,
    layoutFingerprint: 'dawn',
    parameters: { persistentBaseUnlocked: true, dawn: plans.world },
  };
  const activity: ActivityDescriptor = {
    activityRevision: 7,
    worldRevision: 7,
    kind: 'coop-mission',
    definitionId: toDawnActivityDefinitionId(plans.world.templateId),
    parameters: { dawn: plans.activity },
  };
  return { plans, world, activity };
}

describe('Dawn scenario transport', () => {
  it('round-trips both plans through the descriptor wire boundary', () => {
    const { world, activity } = dawnRound();
    const wireWorld = parseWorldDescriptor(JSON.parse(JSON.stringify(world)));
    const wireActivity = parseActivityDescriptor(JSON.parse(JSON.stringify(activity)));

    expect(wireWorld).toEqual(world);
    expect(wireActivity).toEqual(activity);
    expect(isSameWorldInstance(wireWorld!, world)).toBe(true);
    expect(isSameActivityInstance(wireActivity!, activity)).toBe(true);
  });

  it('rejects a whole descriptor instead of dropping an unreadable plan', () => {
    const { world, activity } = dawnRound();
    const brokenWorld = { ...world, parameters: { ...world.parameters, dawn: { ...world.parameters!.dawn, version: 2 } } };
    const brokenActivity = { ...activity, parameters: { dawn: { ...activity.parameters!.dawn, threat: 0 } } };

    expect(parseWorldDescriptor(brokenWorld)).toBeNull();
    expect(parseActivityDescriptor(brokenActivity)).toBeNull();
    expect(parseDawnActivityPlan({
      ...activity.parameters!.dawn,
      waves: [activity.parameters!.dawn!.waves[0], activity.parameters!.dawn!.waves[0]],
    })).toBeNull();
  });

  it('treats a different plan as a different World and Activity instance', () => {
    const { world, activity } = dawnRound(1);
    const harder = dawnRound(2);

    expect(isSameActivityInstance(activity, harder.activity)).toBe(false);
    expect(isSameWorldInstance(world, {
      ...world,
      parameters: { ...world.parameters, dawn: { ...world.parameters!.dawn!, contentHash: 'ffffffffffffffff' } },
    })).toBe(false);
  });

  it('compares plans independently of key order', () => {
    const { plans } = dawnRound();
    const reordered = JSON.parse(JSON.stringify({
      waves: plans.activity.waves,
      scheduleId: plans.activity.scheduleId,
      dayNumber: plans.activity.dayNumber,
      threat: plans.activity.threat,
      contentHash: plans.activity.contentHash,
      version: plans.activity.version,
    }));
    expect(haveSameDawnPlan(parseDawnActivityPlan(reordered), plans.activity)).toBe(true);
    expect(parseDawnWorldPlan(plans.world)).toEqual(plans.world);
  });
});

describe('Dawn scenario resolution', () => {
  it('localizes the resolved clearing map ID in both player languages', () => {
    const { plans } = dawnRound();
    const resolved = resolveDawnScenario({ ...plans.world, templateId: 'clearing' }, plans.activity);
    expect(getMapName(resolved.mapConfig.mapId, 'de')).toBe('Lichtung');
    expect(getMapName(resolved.mapConfig.mapId, 'en')).toBe('Clearing');
  });

  it('rejects salvage slots in the wrong band or inside the base reservation', () => {
    const template = getDawnArenaTemplates().find(entry => entry.salvageSlots.length > 0)!;
    const slot = template.salvageSlots[0];
    const wrongBand = slot.band === 'far' ? 'near' : 'far';
    expect(() => validateTemplates([{ ...template, salvageSlots: [{ ...slot, band: wrongBand }] }]))
      .toThrow('distance band');
    expect(() => validateTemplates([{
      ...template, salvageSlots: [{ ...slot, anchor: template.world.persistentBase.anchor }],
    }])).toThrow('base reservation');
  });

  it('rejects overlapping salvage slots even with distinct ids', () => {
    const template = getDawnArenaTemplates().find(entry => entry.salvageSlots.length > 0)!;
    const slot = template.salvageSlots[0];
    expect(() => validateTemplates([{
      ...template, salvageSlots: [slot, { ...slot, id: 'overlapping-slot' }],
    }])).toThrow('too close to another salvage slot');
    expect(validateTemplates([template]).get(template.id)).toEqual(template);
  });

  it('builds the same Coop config on every peer from the same plans', () => {
    const { plans } = dawnRound();
    const host = resolveDawnScenario(plans.world, plans.activity);
    const peer = resolveDawnScenario(
      parseDawnWorldPlan(JSON.parse(JSON.stringify(plans.world)))!,
      parseDawnActivityPlan(JSON.parse(JSON.stringify(plans.activity)))!,
    );

    expect(peer).toEqual(host);
    expect(host.world.id).toBe(toDawnWorldDefinitionId(plans.world.templateId));
    expect(host.activity.id).toBe(toDawnActivityDefinitionId(plans.world.templateId));
    expect(host.activity.worldDefinitionId).toBe(host.world.id);
    expect(host.world.persistentBaseSite).toBeDefined();
    expect(host.mapConfig.encounters?.map(({ id }) => id)).toEqual(plans.activity.waves.map(({ id }) => id));
  });

  it('fails fast on a plan composed for other Dawn content', () => {
    const { plans } = dawnRound();
    const foreign = { ...plans.world, contentHash: 'ffffffffffffffff' };
    expect(() => resolveDawnScenario(foreign, plans.activity)).toThrow('Dawn content');
    expect(() => resolveDawnScenario(plans.world, { ...plans.activity, contentHash: 'ffffffffffffffff' }))
      .toThrow('Dawn content');
    expect(DAWN_CONTENT_HASH).toMatch(/^[0-9a-f]{16}$/);
  });

  it('resolves every authored template with a wave from each of its fronts', () => {
    const { plans } = dawnRound();
    for (const template of getDawnArenaTemplates()) {
      const resolved = resolveDawnScenario(
        { ...plans.world, templateId: template.id },
        {
          ...plans.activity,
          waves: template.fronts.map((front, index) => ({
            id: `wave-${index}`,
            blockId: plans.activity.waves[0].blockId,
            front,
            atMs: index * 1000,
          })),
        },
      );
      expect(resolved.world.persistentBaseSite?.anchor).toEqual(template.world.persistentBase.anchor);
    }
  });

  it('keeps Dawn identities out of the campaign map namespace', () => {
    const { world, activity, plans } = dawnRound();

    expect(toMapId(world.definitionId)).toBeNull();
    expect(getDawnTemplateIdOfWorld(world.definitionId)).toBe(plans.world.templateId);
    expect(resolveActiveGameMode({ activityKind: activity.kind, roomGameMode: 'deathmatch', worldDefinitionId: world.definitionId }))
      .toBe('coop_defense');
    expect(resolveWorldDefinition(world, activity)?.id).toBe(world.definitionId);
    expect(resolveActivityDefinition(activity, world)?.id).toBe(activity.definitionId);
    expect(resolveCoopDefenseMapConfig(world, activity)?.mapId).not.toMatch(/^\d+$/);
  });

  it('refuses to resolve a Dawn world without its paired plans', () => {
    const { world, activity } = dawnRound();
    expect(() => resolveWorldDefinition(world, null)).toThrow('needs its World and Activity plan');
    expect(() => resolveCoopDefenseMapConfig({ ...world, parameters: {} }, activity))
      .toThrow('needs its World and Activity plan');
    expect(() => resolveActivityDefinition({ ...activity, definitionId: toDawnActivityDefinitionId('other') }, world))
      .toThrow('do not match template');
  });
});
