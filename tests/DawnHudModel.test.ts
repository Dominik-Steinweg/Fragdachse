import { describe, expect, it } from 'vitest';
import { buildDawnHudModel, buildDawnSiteMarkers } from '../src/ui/DawnHudModel';
import { getDawnSchedule } from '../src/config/dawn/dawnContent';
import { composeDawnRoundPlans } from '../src/dawn/composition/DawnRoundComposition';
import { resolveDawnScenario, resolveDawnSites } from '../src/dawn/resolution/DawnScenarioResolution';

describe('Dawn HUD projection', () => {
  const plans = composeDawnRoundPlans({ seed: 11, threat: 1, dayNumber: 3 });
  const schedule = getDawnSchedule(plans.activity.scheduleId);
  const world = resolveDawnScenario(plans.world, plans.activity).world;
  const sites = buildDawnSiteMarkers(plans.world, world);
  const input = { schedule, sites, sharedScrap: 72, threat: 1, dayNumber: 3, objectives: null };

  it('takes positions from world clearings and icons from the planned archetype tier', () => {
    expect(sites.length).toBeGreaterThan(0);
    for (const site of resolveDawnSites(plans.world)) {
      const clearing = world.terrain.siteClearings!.find(entry => entry.id === site.siteId)!;
      expect(sites.find(entry => entry.objectiveId === site.objectiveId)).toEqual({
        objectiveId: site.objectiveId, visualKey: site.tier.visualKey, gridX: clearing.gridX, gridY: clearing.gridY,
      });
    }
  });

  it('follows each schedule boundary and clamps the end clock and countdown', () => {
    for (const [index, phase] of schedule.phases.entries()) {
      const model = buildDawnHudModel({ ...input, elapsedMs: phase.startMs });
      expect(model.phase).toBe(phase.id);
      expect(model.clock).toBe(phase.clock);
      expect(model.remainingSeconds).toBe(((schedule.phases[index + 1]?.startMs ?? schedule.durationMs) - phase.startMs) / 1000);
      expect(model.returnToBase).toBe(phase.id === 'dusk');
      expect(model.sites).toEqual(phase.id === 'day' ? sites : []);
      expect(model).toMatchObject({ scrap: input.sharedScrap, threat: input.threat, dayNumber: input.dayNumber });
    }
    expect(buildDawnHudModel({ ...input, elapsedMs: schedule.durationMs + 1000 }))
      .toMatchObject({ clock: schedule.endClock, remainingSeconds: 0, remainingFraction: 0, sites: [] });
    expect(buildDawnHudModel({ ...input, elapsedMs: -1000 }).clock).toBe(schedule.phases[0].clock);
  });

  it('hands activated sites to secondary objective markers, including completed and failed sites', () => {
    for (const state of ['active', 'completed', 'failed'] as const) {
      const model = buildDawnHudModel({ ...input, elapsedMs: 0, objectives: [{ objectiveId: sites[0].objectiveId,
        type: 'destroy', state, focused: false, progressCurrent: 0, progressTotal: 1, stateChangedAtMs: 0 }] });
      expect(model.sites.map(site => site.objectiveId)).not.toContain(sites[0].objectiveId);
      expect(model.sites).toHaveLength(sites.length - 1);
    }
  });

  it('interpolates the night clock forward through midnight', () => {
    const night = schedule.phases.find(entry => entry.id === 'night')!;
    const dawn = schedule.phases.find(entry => entry.id === 'dawn')!;
    const model = buildDawnHudModel({ ...input, elapsedMs: (night.startMs + dawn.startMs) / 2 });
    const toMinutes = (clock: string) => { const [h, m] = clock.split(':').map(Number); return h * 60 + m; };
    const start = toMinutes(night.clock), end = toMinutes(dawn.clock);
    expect(toMinutes(model.clock)).toBe(Math.floor(start + (end - start + 1440) % 1440 / 2) % 1440);
  });
});
