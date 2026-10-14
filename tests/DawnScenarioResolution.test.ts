import { describe, expect, it } from 'vitest';
import { resolveWorldBases } from '../src/arena/BaseRegistry';
import { resolveCoopDefenseWorldMetrics } from '../src/world/WorldMetrics';
import { getMapName } from '../src/i18n/contentPresentation';
import { getCoopMissionTimeLimitSec } from '../src/config/coopDefenseMapAuthoring';
import {
  DAWN_CONTENT_HASH,
  getDawnArenaTemplates,
  getDawnSchedule,
  getDawnThreatCurve,
  getDawnWaveComposition,
  validateTemplates,
} from '../src/config/dawn/dawnContent';
import { composeDawnRoundPlans } from '../src/dawn/composition/DawnRoundComposition';
import { DAWN_WRECK_VARIANTS } from '../src/dawn/contracts/DawnContentIds';
import {
  getDawnTemplateIdOfWorld,
  toDawnActivityDefinitionId,
  toDawnWorldDefinitionId,
} from '../src/dawn/contracts/DawnIds';
import {
  DAWN_MAX_THREAT,
  haveSameDawnPlan,
  parseDawnActivityPlan,
  parseDawnWorldPlan,
} from '../src/dawn/contracts/DawnPlans';
import { resolveDawnWorldDefinition, resolveDawnScenario, resolveDawnSites } from '../src/dawn/resolution/DawnScenarioResolution';
import { getDawnPhaseStartMs, toDawnDynamicTimeOfDay } from '../src/dawn/rules/DawnPhase';
import { isSameActivityInstance, parseActivityDescriptor, type ActivityDescriptor } from '../src/world/ActivityDescriptor';
import { resolveActiveGameMode, toMapId } from '../src/world/arenaDescriptorAdapter';
import { isSameWorldInstance, parseWorldDescriptor, type WorldDescriptor } from '../src/world/WorldDescriptor';
import {
  resolveActivityDefinition,
  resolveCoopDefenseMapConfig,
  resolveWorldDefinition,
} from '../src/world/WorldDefinitionResolution';

function dawnRound(threat = 1, seed = 11) {
  const plans = composeDawnRoundPlans({ seed, threat, dayNumber: 1 });
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
  it('accepts known wreck variants and the absent drone default without changing gameplay', () => {
    const { plans } = dawnRound();
    const site = { ...plans.world.sites[0], archetypeId: 'wreck', variant: undefined };
    const baseline = { ...plans.world, sites: [site] };
    for (const variant of DAWN_WRECK_VARIANTS) {
      const plan = { ...baseline, sites: [{ ...site, variant }] };
      expect(resolveDawnWorldDefinition(plan)).toEqual(resolveDawnWorldDefinition(baseline));
    }
  });

  it('rejects unknown variants and every variant on a non-wreck site at resolution', () => {
    const { plans } = dawnRound();
    const site = plans.world.sites[0];
    for (const override of [
      { archetypeId: 'wreck', variant: 'unknown' },
      ...DAWN_WRECK_VARIANTS.map(variant => ({ archetypeId: 'extractor', variant })),
    ]) {
      const plan = { ...plans.world, sites: [{ ...site, ...override }] };
      expect(() => resolveDawnSites(plan)).toThrow('variant');
      expect(() => resolveDawnWorldDefinition(plan)).toThrow('variant');
      expect(() => resolveDawnScenario(plan, plans.activity)).toThrow('variant');
    }
  });

  it('announces four night slots at threat 3 and keeps day pressure and site assaults silent', () => {
    const { plans } = dawnRound(3);
    const { mapConfig } = resolveDawnScenario(plans.world, plans.activity);
    const nightStart = getDawnPhaseStartMs(getDawnSchedule(plans.activity.scheduleId), 'night');
    const encounters = mapConfig.encounters!;
    const silent = encounters.filter(encounter => encounter.start.type === 'site-activated'
      || (encounter.start.type === 'time' && encounter.start.atMs < nightStart));
    expect(silent.some(encounter => encounter.start.type === 'site-activated')).toBe(true);
    expect(silent.some(encounter => encounter.start.type === 'time')).toBe(true);
    expect(silent.every(encounter => encounter.announce === false)).toBe(true);
    for (const site of resolveDawnSites(plans.world)) {
      const guards = silent.filter(encounter => encounter.start.type === 'site-activated'
        && encounter.start.siteId === site.siteId);
      // Only archetypes with an assault contract bring guards; nests spawn their own, heaps and camps stay quiet.
      if (site.archetype.assaultDelayMs === undefined) { expect(guards, site.archetype.id).toEqual([]); continue; }
      expect(guards.length, site.archetype.id).toBeGreaterThan(0);
      for (const guard of guards) {
        expect(guard.groups.every(group => group.spawnArea !== undefined)).toBe(true);
      }
    }
    const night = encounters.filter(encounter => !silent.includes(encounter));
    const groups = [...new Set(night.map(encounter => encounter.announce && encounter.announce.group))];
    expect(groups).toEqual(getDawnWaveComposition().night.waves.map(slot => slot.id));
    expect(groups).toHaveLength(4);
    expect(groups.at(-1)).toBe('finale');
    for (const encounter of night) {
      expect(encounter.announce).toEqual({ group: groups.find(group => encounter.id.startsWith(`${group}-`)),
        ...(encounter.id.startsWith('finale-') ? { finale: true } : {}) });
    }
    const unknown = { ...plans.activity, waves: plans.activity.waves.map(wave =>
      !('siteId' in wave) && wave.atMs >= nightStart ? { ...wave, id: `unknown-${wave.id}` } : wave) };
    expect(() => resolveDawnScenario(plans.world, unknown)).toThrow('no matching night slot');
  });

  it.each(['wreck', 'extractor'])('centers the complete 3x3 %s prop footprint on its slot', archetypeId => {
    const { plans } = dawnRound(10, 77);
    const plan = { ...plans.world, sites: plans.world.sites.map(site => ({ ...site, archetypeId, variant: undefined })) };
    const world = resolveDawnWorldDefinition(plan);
    const bases = resolveWorldBases(world, resolveCoopDefenseWorldMetrics(world.metrics.widthCells, world.metrics.heightCells));
    for (const site of resolveDawnSites(plan)) {
      expect(world.bases.find(base => base.id === site.baseId)?.surface).toBe('none');
      const base = bases.find(base => base.id === site.baseId)!;
      expect(base.surface).toBe('none');
      expect(base.cells).toHaveLength(9);
      expect(new Set(base.cells.map(cell => `${cell.gridX - site.slot.anchor.gridX}:${cell.gridY - site.slot.anchor.gridY}`)))
        .toEqual(new Set(['-1:-1', '0:-1', '1:-1', '-1:0', '0:0', '1:0', '-1:1', '0:1', '1:1']));
    }
  });
  it.each(getDawnArenaTemplates())('localizes the resolved $id map ID in both player languages', template => {
    let seed = 1;
    while (composeDawnRoundPlans({ seed, threat: 1, dayNumber: 1 }).world.templateId !== template.id) seed++;
    const { plans } = dawnRound(1, seed);
    const resolved = resolveDawnScenario(plans.world, plans.activity);
    for (const language of ['de', 'en'] as const) {
      const name = getMapName(resolved.mapConfig.mapId, language);
      expect(name).not.toBe(`Map ${resolved.mapConfig.mapId}`);
      expect(name).not.toContain('map.dawn:');
    }
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

  it('validates arena-specific distance bands without relaxing base reservations', () => {
    const template = getDawnArenaTemplates().find(entry => entry.salvageBands)!;
    expect(validateTemplates([template]).get(template.id)).toEqual(template);
    expect(() => validateTemplates([{
      ...template, salvageBands: { ...template.salvageBands!, mid: template.salvageBands!.near },
    }])).toThrow('ordered, non-overlapping');
    expect(() => validateTemplates([{
      ...template, salvageBands: { ...template.salvageBands!, near: { minCells: 0, maxCells: 20 } },
      salvageSlots: [{ ...template.salvageSlots[0], anchor: template.world.persistentBase.anchor }],
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
        // Sites belegen Slots ihres eigenen Templates; fremde Templates laufen ohne Sites.
        { ...plans.world, templateId: template.id, sites: template.id === plans.world.templateId ? plans.world.sites : [] },
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

  it('resolves a normalizable timed defense for every threat over several seeds', () => {
    for (let threat = 1; threat <= DAWN_MAX_THREAT; threat++) {
      for (const seed of [3, 1009, 65_537]) {
        const { plans } = dawnRound(threat, seed);
        const { mapConfig, activity } = resolveDawnScenario(plans.world, plans.activity);
        const schedule = getDawnSchedule(plans.activity.scheduleId);

        expect(mapConfig.objective).toBe('defend-until-dawn');
        expect(getCoopMissionTimeLimitSec(mapConfig)).toBe(schedule.durationMs / 1000);
        expect(mapConfig.dynamicTimeOfDay).toEqual(toDawnDynamicTimeOfDay(schedule));
        expect(activity.respawnDelaySchedule).toEqual(
          schedule.phases.map((phase) => ({ fromMs: phase.startMs, delayMs: phase.respawnDelayMs })),
        );
        expect(activity.itemDrop?.itemLevel).toBe(getDawnThreatCurve(threat).itemLevel);
        expect(mapConfig.encounters?.slice(0, plans.activity.waves.length).map(({ id }) => id))
          .toEqual(plans.activity.waves.map(({ id }) => id));
      }
    }
  });

  it('keeps site structures and clearings in the World and their missions in the Activity', () => {
    const { plans } = dawnRound(10, 77);
    const { world, activity } = resolveDawnScenario(plans.world, plans.activity);
    const sites = resolveDawnSites(plans.world);
    const duskMs = getDawnPhaseStartMs(getDawnSchedule(plans.activity.scheduleId), 'dusk');
    expect(sites.length).toBeGreaterThan(0);

    expect(world.terrain.siteClearings).toEqual(sites.map((site) => ({
      id: site.siteId, gridX: site.slot.anchor.gridX, gridY: site.slot.anchor.gridY,
      radiusCells: site.archetype.clearingRadiusCells,
    })));
    for (const site of sites) {
      const structure = world.bases.find(({ id }) => id === site.baseId);
      expect(structure).toMatchObject({
        hpMax: site.tier.hpMax, faction: site.archetype.structure.faction, role: site.archetype.structure.role,
      });
      expect(structure).not.toHaveProperty('dormant');
      const carry = site.archetype.objectiveType === 'carry';
      // Mission targets wait dormant; the supply capsule is scenery and its crates are the objective.
      expect(activity.baseOverlays?.find(({ baseId }) => baseId === site.baseId)?.dormant ?? false).toBe(!carry);

      const objective = activity.secondaryObjectives?.find(({ id }) => id === site.objectiveId);
      expect(objective).toMatchObject({
        type: site.archetype.objectiveType,
        concurrent: true,
        start: { type: 'site-activated', siteId: site.siteId },
        expiresAt: { type: 'time', atMs: duskMs },
        targets: carry ? [] : [site.baseId],
      });
      if (carry) expect(objective?.carry?.itemCount).toBe(site.tier.carryItemCount);
      const nest = activity.persistentSpawns?.find(({ id }) => id === `nest-${site.slotId}`);
      expect(nest?.source, site.archetype.id).toEqual(site.tier.nestSpawn ? { type: 'base', baseId: site.baseId } : undefined);
      expect(objective?.holdDurationMs).toBe(site.archetype.holdDurationMs);
    }
    expect(activity.secondaryObjectives).toHaveLength(sites.length);
  });

  it('resolves the World definition from the World plan alone, equal to the paired resolution', () => {
    for (const [threat, seed] of [[1, 3], [5, 11], [DAWN_MAX_THREAT, 29]] as const) {
      const { plans } = dawnRound(threat, seed);
      expect(resolveDawnWorldDefinition(plans.world)).toEqual(resolveDawnScenario(plans.world, plans.activity).world);
    }
  });

  it('derives the World only from the World plan', () => {
    const { plans } = dawnRound(1, 5);
    const harder = dawnRound(DAWN_MAX_THREAT, 6);
    const calm = resolveDawnScenario(plans.world, plans.activity);
    // Site-Wellen gehoeren zu den Sites ihres World-Plans; fremde Activity-Plaene tragen nur Frontwellen.
    const stormy = resolveDawnScenario(plans.world, {
      ...harder.plans.activity,
      waves: harder.plans.activity.waves.filter((wave) => 'front' in wave),
    });

    expect(stormy.world).toEqual(calm.world);
    expect(stormy.activity).not.toEqual(calm.activity);
  });

  it('fails fast on unknown slots, archetypes and tiers', () => {
    const { plans } = dawnRound(4, 9);
    const [site] = plans.world.sites;
    const withSite = (override: object) => ({ ...plans.world, sites: [{ ...site, ...override }] });

    expect(() => resolveDawnScenario(withSite({ slotId: 'nowhere' }), plans.activity)).toThrow('salvage slot');
    expect(() => resolveDawnScenario(withSite({ archetypeId: 'unknown' }), plans.activity)).toThrow('site archetype');
    expect(() => resolveDawnScenario(withSite({ tier: 99 }), plans.activity)).toThrow('tier');
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
    // Die World-Definition genuegt mit dem World-Plan; Config und Activity brauchen beide Plaene.
    expect(resolveWorldDefinition(world, null)).toEqual(resolveWorldDefinition(world, activity));
    expect(() => resolveCoopDefenseMapConfig(world, null)).toThrow('needs its World and Activity plan');
    expect(() => resolveCoopDefenseMapConfig({ ...world, parameters: {} }, activity))
      .toThrow('needs its World and Activity plan');
    expect(() => resolveActivityDefinition({ ...activity, definitionId: toDawnActivityDefinitionId('other') }, world))
      .toThrow('do not match template');
  });
});
