import { describe, expect, it } from 'vitest';
import { composeDawnRoundPlans } from '../src/dawn/composition/DawnRoundComposition';
import { resolveDawnSlotSide } from '../src/dawn/composition/DawnPortalComposition';
import { resolveDawnScenario, toDawnPortalLinkId } from '../src/dawn/resolution/DawnScenarioResolution';
import {
  getDawnArenaTemplate,
  getDawnSalvageSlot,
  getDawnSchedule,
  getDawnSiteArchetype,
  getDawnThreatCurve,
} from '../src/config/dawn/dawnContent';
import { getDawnPhaseStartMs } from '../src/dawn/rules/DawnPhase';
import { MIN_COOP_DEFENSE_PORTAL_ANCHOR_SEPARATION_CELLS, resolveCoopDefensePortalLink } from '../src/config/coopDefensePortalLinks';
import { assignDawnFronts } from '../src/dawn/composition/DawnWaveComposition';
import { createDawnRandom } from '../src/dawn/composition/DawnRandom';

const SEEDS = Array.from({ length: 60 }, (_, index) => 1000 + index * 37);
const portalSitesOf = (plans: ReturnType<typeof composeDawnRoundPlans>) =>
  plans.world.sites.filter((site) => getDawnSiteArchetype(site.archetypeId).portal);

describe('Dawn portal generator composition', () => {
  it('never appears below its threat and appears in some rounds above it', () => {
    for (const seed of SEEDS) {
      expect(portalSitesOf(composeDawnRoundPlans({ seed, threat: 2, dayNumber: 1 }))).toHaveLength(0);
    }
    const withGenerator = SEEDS.filter((seed) => portalSitesOf(composeDawnRoundPlans({ seed, threat: 6, dayNumber: 1 })).length);
    expect(withGenerator.length).toBeGreaterThan(SEEDS.length * 0.25);
    expect(withGenerator.length).toBeLessThan(SEEDS.length * 0.85);
  });

  it('is deterministic per seed and leaves ordinary sites and waves of other rounds untouched', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      expect(composeDawnRoundPlans({ seed, threat: 6, dayNumber: 3 })).toEqual(composeDawnRoundPlans({ seed, threat: 6, dayNumber: 3 }));
      const forced = composeDawnRoundPlans({ seed, threat: 6, dayNumber: 3, forcePortalGenerator: true });
      const ordinary = (plans: ReturnType<typeof composeDawnRoundPlans>) =>
        plans.world.sites.filter((site) => !getDawnSiteArchetype(site.archetypeId).portal);
      expect(ordinary(forced)).toEqual(ordinary(composeDawnRoundPlans({ seed, threat: 6, dayNumber: 3 })));
    }
  });

  it('places the generator out toward the primary front and its exit on a free, separate, preferably unattacked side', () => {
    for (const threat of [3, 6, 10]) {
      for (const seed of SEEDS) {
        const plans = composeDawnRoundPlans({ seed, threat, dayNumber: 1, forcePortalGenerator: true });
        const portals = portalSitesOf(plans);
        expect(portals.length).toBeLessThanOrEqual(1);
        if (!portals.length) continue;
        const template = getDawnArenaTemplate(plans.world.templateId);
        const generator = getDawnSalvageSlot(template, portals[0].slotId);
        const exit = getDawnSalvageSlot(template, portals[0].portalExitSlotId!);
        expect(generator.band).not.toBe('near');
        expect(plans.world.sites.some((site) => site.slotId === exit.id)).toBe(false);
        expect(Math.hypot(generator.anchor.gridX - exit.anchor.gridX, generator.anchor.gridY - exit.anchor.gridY))
          .toBeGreaterThanOrEqual(MIN_COOP_DEFENSE_PORTAL_ANCHOR_SEPARATION_CELLS);
        expect(resolveDawnSlotSide(template, exit)).not.toBe(resolveDawnSlotSide(template, generator));
        const fronts = assignDawnFronts(createDawnRandom(seed, 'fronts'), template, getDawnThreatCurve(threat));
        const attacked = new Set(fronts.map((front) => front.front));
        const freeUnattacked = template.salvageSlots.some((slot) => !plans.world.sites.some((site) => site.slotId === slot.id)
          && !attacked.has(resolveDawnSlotSide(template, slot)) && slot.id !== generator.id
          && resolveDawnSlotSide(template, slot) !== resolveDawnSlotSide(template, generator)
          && Math.hypot(generator.anchor.gridX - slot.anchor.gridX, generator.anchor.gridY - slot.anchor.gridY)
            >= MIN_COOP_DEFENSE_PORTAL_ANCHOR_SEPARATION_CELLS);
        if (freeUnattacked) expect(attacked.has(resolveDawnSlotSide(template, exit))).toBe(false);
      }
    }
  });

  it('brings a guard assault on activation like other guarded sites', () => {
    const seed = SEEDS.find((candidate) => portalSitesOf(composeDawnRoundPlans({ seed: candidate, threat: 6, dayNumber: 1 })).length)!;
    const plans = composeDawnRoundPlans({ seed, threat: 6, dayNumber: 1 });
    const slotId = portalSitesOf(plans)[0].slotId;
    expect(plans.activity.waves.some((wave) => 'siteId' in wave && wave.siteId === slotId)).toBe(true);
  });
});

describe('Dawn portal generator resolution', () => {
  const seed = SEEDS.find((candidate) => portalSitesOf(composeDawnRoundPlans({ seed: candidate, threat: 6, dayNumber: 1 })).length)!;

  it('resolves a destroyable generator that charges for its share of the day and never expires at dusk', () => {
    const plans = composeDawnRoundPlans({ seed, threat: 6, dayNumber: 1 });
    const site = portalSitesOf(plans)[0];
    const { mapConfig } = resolveDawnScenario(plans.world, plans.activity);
    const baseId = `site-${site.slotId}`;
    const link = resolveCoopDefensePortalLink(mapConfig.portalLinks!.find((entry) => entry.id === toDawnPortalLinkId(site.slotId))!);
    const schedule = getDawnSchedule(plans.activity.scheduleId);
    const dayMs = getDawnPhaseStartMs(schedule, 'dusk') - getDawnPhaseStartMs(schedule, 'day');
    expect(link).toMatchObject({ generatorBaseId: baseId, chargeStartMs: 0,
      chargeDurationMs: Math.round(getDawnSiteArchetype('portal-generator').portal!.openAtDayFraction * dayMs) });
    const objective = mapConfig.secondaryObjectives!.find((entry) => entry.targets.includes(baseId))!;
    expect(objective).toMatchObject({ type: 'destroy', start: { type: 'time', atMs: 0 }, concurrent: true });
    expect(objective.expiresAt).toBeUndefined();
    expect(mapConfig.siteClearings!.find((entry) => entry.id === site.slotId)?.structureBaseId).toBe(baseId);
    expect(mapConfig.bases.find((base) => base.id === baseId)).toMatchObject({ faction: 'hostile', role: 'outpost', dormant: true });
    expect(mapConfig.portalAnchors).toHaveLength(2);
  });

  it('rejects a portal exit on any other archetype', () => {
    const plans = composeDawnRoundPlans({ seed, threat: 6, dayNumber: 1 });
    const other = plans.world.sites.find((site) => !getDawnSiteArchetype(site.archetypeId).portal)!;
    const broken = { ...plans.world, sites: plans.world.sites.map((site) => site === other
      ? { ...site, portalExitSlotId: 'unused-slot' } : site.portalExitSlotId ? { ...site, portalExitSlotId: undefined } : site) };
    expect(() => resolveDawnScenario(broken, plans.activity)).toThrow();
  });
});
