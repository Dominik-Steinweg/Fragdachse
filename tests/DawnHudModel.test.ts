import { describe, expect, it } from 'vitest';
import { buildDawnHudModel, buildDawnSiteMarkers, resolveDawnHudWidth } from '../src/ui/DawnHudModel';
import { getDawnSchedule } from '../src/config/dawn/dawnContent';
import { composeDawnRoundPlans } from '../src/dawn/composition/DawnRoundComposition';
import { resolveDawnScenario, resolveDawnSites } from '../src/dawn/resolution/DawnScenarioResolution';

describe('Dawn HUD projection', () => {
  it('reserves enough width for full text plus icons and collapses missing-icon spacing', () => {
    const measured = { minimum: 480, inset: 38, title: 340, value: 120, kicker: 200, valueIcon: 22, kickerIcon: 22 };
    const width = resolveDawnHudWidth(measured);
    expect(width - 2 * measured.inset).toBeGreaterThanOrEqual(measured.title + 12 + measured.value + measured.valueIcon);
    expect(resolveDawnHudWidth({ ...measured, valueIcon: 0 })).toBe(width - measured.valueIcon);
    const longKicker = { ...measured, kicker: 700 };
    expect(resolveDawnHudWidth(longKicker) - 2 * measured.inset).toBeGreaterThanOrEqual(longKicker.kicker + measured.kickerIcon);
    expect(resolveDawnHudWidth({ ...measured, title: 40, value: 20, kicker: 20 })).toBe(measured.minimum);
  });

  const plans = composeDawnRoundPlans({ seed: 11, threat: 1, dayNumber: 3 });
  const schedule = getDawnSchedule(plans.activity.scheduleId);
  const world = resolveDawnScenario(plans.world, plans.activity).world;
  const sites = buildDawnSiteMarkers(plans.world, world);
  const input = { schedule, sites, sharedScrap: 72, threat: 1, dayNumber: 3, objectives: null, clockMinutes: 420 };

  it('takes positions from world clearings and icons from the planned archetype tier', () => {
    expect(sites.length).toBeGreaterThan(0);
    for (const site of resolveDawnSites(plans.world)) {
      const clearing = world.terrain.siteClearings!.find(entry => entry.id === site.siteId)!;
      expect(sites.find(entry => entry.objectiveId === site.objectiveId)).toEqual({
        objectiveId: site.objectiveId, visualKey: site.tier.visualKey, archetypeId: site.archetype.id, tier: site.tier.tier,
        gridX: clearing.gridX, gridY: clearing.gridY, radiusCells: site.archetype.clearingRadiusCells,
        ...(site.archetype.holdDurationMs ? { holdDurationMs: site.archetype.holdDurationMs } : {}),
      });
    }
  });

  it('follows each schedule boundary and clamps the end clock and countdown', () => {
    for (const [index, phase] of schedule.phases.entries()) {
      const [hours, minutes] = phase.clock.split(':').map(Number);
      const model = buildDawnHudModel({ ...input, elapsedMs: phase.startMs, clockMinutes: hours * 60 + minutes });
      expect(model.phase).toBe(phase.id);
      expect(model.clock).toBe(phase.clock);
      expect(model.remainingSeconds).toBe(((schedule.phases[index + 1]?.startMs ?? schedule.durationMs) - phase.startMs) / 1000);
      expect(model.returnToBase).toBe(phase.id === 'dusk');
      expect(model.sites).toEqual(phase.id === 'day' ? sites : []);
      expect(model).toMatchObject({ scrap: input.sharedScrap, threat: input.threat, dayNumber: input.dayNumber });
    }
    expect(buildDawnHudModel({ ...input, elapsedMs: schedule.durationMs + 1000 }))
      .toMatchObject({ remainingSeconds: 0, remainingFraction: 0, sites: [] });
    expect(buildDawnHudModel({ ...input, elapsedMs: 0, clockMinutes: 1439.6 }).clock).toBe('23:59');
  });

  it('hands activated sites to secondary objective markers, including completed and failed sites', () => {
    for (const state of ['active', 'completed', 'failed'] as const) {
      const model = buildDawnHudModel({ ...input, elapsedMs: 0, objectives: [{ objectiveId: sites[0].objectiveId,
        type: 'destroy', state, focused: false, progressCurrent: 0, progressTotal: 1, stateChangedAtMs: 0 }] });
      expect(model.sites.map(site => site.objectiveId)).not.toContain(sites[0].objectiveId);
      expect(model.sites).toHaveLength(sites.length - 1);
    }
  });

});
